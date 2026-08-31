import { ExtractedPlacement, ParsedPlanOption } from '../types';

/**
 * Utility to compress large sets of locations (e.g. hundreds of ZIP codes or cities)
 * into a brief, human-readable summary that won't overflow LLM context tokens.
 */
export function compressLocations(locations: string[]): string {
  if (!locations || locations.length === 0) return 'Nationwide / Unspecified';
  
  const cleanLocs = locations.map(l => l.trim()).filter(Boolean);
  if (cleanLocs.length <= 10) {
    return cleanLocs.join(', ');
  }

  // Count ZIP-like tokens
  const zipCount = cleanLocs.filter(l => /^\d{5}(-\d{4})?$/.test(l)).length;
  if (zipCount > 10) {
    const samples = cleanLocs.slice(0, 8).join(', ');
    return `${cleanLocs.length} Targeted ZIP Codes (Sample: ${samples}, ...)`;
  }

  const samples = cleanLocs.slice(0, 10).join(', ');
  return `${cleanLocs.length} Targeted Locations (Sample: ${samples}, ...)`;
}

/**
 * Group and aggregate placements into option scenarios when parsed from spreadsheet.
 */
export function groupPlacementsIntoPlanOptions(placements: ExtractedPlacement[]): ParsedPlanOption[] {
  if (!placements || placements.length === 0) return [];

  const optionGroups: Record<string, ExtractedPlacement[]> = {};

  placements.forEach(p => {
    const planKey = (p.planName || 'Main Media Plan').trim();
    if (!optionGroups[planKey]) {
      optionGroups[planKey] = [];
    }
    optionGroups[planKey].push(p);
  });

  const keys = Object.keys(optionGroups);
  return keys.map((key, index) => {
    const items = optionGroups[key];
    const totalBudget = items.reduce((sum, item) => sum + (Number(item.budget) || 0), 0);
    
    // Extract unique channels
    const rawChannels = Array.from(new Set(
      items
        .map(i => i.mediaType || i.productType || i.publisher || 'Programmatic Display')
        .filter(Boolean)
    ));

    // Flight dates range
    const startDates = items.map(i => i.startDate).filter(Boolean) as string[];
    const endDates = items.map(i => i.endDate).filter(Boolean) as string[];

    // Geos
    const geos = Array.from(new Set(
      items.map(i => i.locationDetails || i.locationType).filter(Boolean) as string[]
    ));

    return {
      id: `plan_opt_${index + 1}_${Date.now()}`,
      name: key.length > 50 ? key.slice(0, 47) + '...' : key,
      selected: index === 0, // Only preselect the first plan option if there are multiple
      budget: totalBudget,
      flightDates: startDates.length > 0 ? { start: startDates[0], end: endDates[endDates.length - 1] || startDates[0] } : undefined,
      rawChannels,
      geosSummary: compressLocations(geos),
      lineItemsCount: items.length,
      placements: items,
    };
  });
}

/**
 * Creates a clean, token-efficient summary JSON string of selected plan options for LLM prompts.
 */
export function summarizeSelectedPlansForPrompt(selectedOptions: ParsedPlanOption[]): string {
  if (!selectedOptions || selectedOptions.length === 0) {
    return "No media plan uploaded.";
  }

  const totalBudget = selectedOptions.reduce((acc, opt) => acc + opt.budget, 0);
  const combinedChannels = Array.from(new Set(selectedOptions.flatMap(opt => opt.rawChannels)));
  const combinedLineItems = selectedOptions.reduce((acc, opt) => acc + opt.lineItemsCount, 0);

  const optionsBrief = selectedOptions.map(opt => {
    const samplePlacements = opt.placements.slice(0, 8).map(p => ({
      publisher: p.publisher || 'N/A',
      mediaType: p.mediaType || p.productType || 'N/A',
      budget: p.budget ? `$${p.budget.toLocaleString()}` : 'N/A',
      audience: (p.audience || 'N/A').slice(0, 50),
      location: (p.locationDetails || 'N/A').slice(0, 50)
    }));

    return {
      planName: opt.name,
      spend: `$${opt.budget.toLocaleString()}`,
      channelCount: opt.rawChannels.length,
      channels: opt.rawChannels,
      geoSummary: opt.geosSummary,
      lineItemsTotal: opt.lineItemsCount,
      placementsSample: samplePlacements,
    };
  });

  return JSON.stringify({
    aggregateTotalBudget: `$${totalBudget.toLocaleString()}`,
    aggregateChannelList: combinedChannels,
    totalLineItems: combinedLineItems,
    selectedPlanCount: selectedOptions.length,
    planOptions: optionsBrief,
  }, null, 2);
}
