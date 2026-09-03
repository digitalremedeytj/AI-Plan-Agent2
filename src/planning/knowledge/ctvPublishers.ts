export interface CtvPublisherSetting {
  id: string;
  name: string;
  channel: string;
  category: "App" | "Network" | "OS";
  notes: string;
  enabled: boolean;
  logoUrl?: string;
  isCustom?: boolean;
}

export const CTV_PUBLISHERS_STORAGE_KEY = "scoutai_ctv_publishers_settings";
export const CTV_PUBLISHERS_VERSION = 1;

export const KNOWN_PUBLISHER_LOGOS: Record<string, string> = {
  "a&e": "/assets/pub-logos/a&e_80x80.png",
  "a&e networks": "/assets/pub-logos/a&e_80x80.png",
  "abc": "/assets/pub-logos/abc_80x80.png",
  "abc news": "/assets/pub-logos/abc_80x80.png",
  "amazon": "/assets/pub-logos/amazon-prime-video_80x80.png",
  "amazon prime": "/assets/pub-logos/amazon-prime-video_80x80.png",
  "amazon prime video": "/assets/pub-logos/amazon-prime-video_80x80.png",
  "prime video": "/assets/pub-logos/amazon-prime-video_80x80.png",
  "amc": "/assets/pub-logos/amc_80x80.png",
  "amc networks": "/assets/pub-logos/amc_80x80.png",
  "apple": "/assets/pub-logos/apple-tv-plus_80x80.png",
  "apple tv": "/assets/pub-logos/apple-tv-plus_80x80.png",
  "apple tv+": "/assets/pub-logos/apple-tv-plus_80x80.png",
  "bloomberg": "/assets/pub-logos/bloomberg_80x80.png",
  "cbs": "/assets/pub-logos/cbs_80x80.png",
  "cheddar": "/assets/pub-logos/cheddar_80x80.png",
  "cnbc": "/assets/pub-logos/cnbc_80x80.png",
  "cnn": "/assets/pub-logos/cnn_80x80.png",
  "crackle": "/assets/pub-logos/crackle_80x80.png",
  "directv": "/assets/pub-logos/directv_80x80.png",
  "directv stream": "/assets/pub-logos/directv_80x80.png",
  "discovery": "/assets/pub-logos/discovery_80x80.png",
  "discovery+": "/assets/pub-logos/discovery+_80x80.png",
  "disney": "/assets/pub-logos/disney_80x80.png",
  "disney+": "/assets/pub-logos/disney_80x80.png",
  "espn": "/assets/pub-logos/espn_80x80.png",
  "fox": "/assets/pub-logos/fox_80x80.png",
  "fox news": "/assets/pub-logos/fox_80x80.png",
  "freeform": "/assets/pub-logos/freeform_80x80.png",
  "fubo": "/assets/pub-logos/fubo_80x80.png",
  "fubo tv": "/assets/pub-logos/fubo_80x80.png",
  "fuse": "/assets/pub-logos/fuse+_80x80.png",
  "fuse+": "/assets/pub-logos/fuse+_80x80.png",
  "fx": "/assets/pub-logos/fx_80x80.png",
  "hallmark": "/assets/pub-logos/hallmark_80x80.png",
  "hallmark network": "/assets/pub-logos/hallmark_80x80.png",
  "hbo max": "/assets/pub-logos/max_80x80.png",
  "max": "/assets/pub-logos/max_80x80.png",
  "hulu": "/assets/pub-logos/hulu_80x80.png",
  "lg": "/assets/pub-logos/lg_80x80.png",
  "lg channels": "/assets/pub-logos/lg_80x80.png",
  "moonbug": "/assets/pub-logos/moonbug_80x80.png",
  "moonbug kids": "/assets/pub-logos/moonbug_80x80.png",
  "nbc": "/assets/pub-logos/nbc_80x80.png",
  "netflix": "/assets/pub-logos/netflix_80x80.png",
  "newson": "/assets/pub-logos/newson_80x80.png",
  "newsy": "/assets/pub-logos/newsy_80x80.png",
  "nfl": "/assets/pub-logos/nfl_80x80.png",
  "nfl network": "/assets/pub-logos/nfl_80x80.png",
  "outside": "/assets/pub-logos/outside_80x80.png",
  "outside tv": "/assets/pub-logos/outside_80x80.png",
  "paramount": "/assets/pub-logos/paramount_80x80.png",
  "paramount+": "/assets/pub-logos/paramount_80x80.png",
  "peacock": "/assets/pub-logos/peacock_80x80.png",
  "philo": "/assets/pub-logos/philo_80x80.png",
  "plex": "/assets/pub-logos/plex_80x80.png",
  "pluto": "/assets/pub-logos/pluto_80x80.png",
  "pluto tv": "/assets/pub-logos/pluto_80x80.png",
  "roku": "/assets/pub-logos/roku_80x80.png",
  "the roku channel": "/assets/pub-logos/roku_80x80.png",
  "samsung": "/assets/pub-logos/samsung_80x80.png",
  "samsung tv plus": "/assets/pub-logos/samsung_80x80.png",
  "sci": "/assets/pub-logos/sci_80x80.png",
  "science channel": "/assets/pub-logos/sci_80x80.png",
  "scripps": "/assets/pub-logos/scripps_80x80.png",
  "scripps networks": "/assets/pub-logos/scripps_80x80.png",
  "showtime": "/assets/pub-logos/showtime_80x80.png",
  "sling": "/assets/pub-logos/sling_80x80.png",
  "sling tv": "/assets/pub-logos/sling_80x80.png",
  "travel": "/assets/pub-logos/travel_80x80.png",
  "travel channel": "/assets/pub-logos/travel_80x80.png",
  "tubi": "/assets/pub-logos/tubi_80x80.png",
  "turner": "/assets/pub-logos/turner_80x80.png",
  "vevo": "/assets/pub-logos/vevo_80x80.png",
  "vizio": "/assets/pub-logos/vizio_80x80.png",
  "vizio watchfree+": "/assets/pub-logos/vizio_80x80.png",
  "xumo": "/assets/pub-logos/xumo_80x80.png",
  "xumo play": "/assets/pub-logos/xumo_80x80.png",
};

export const GENERIC_PLACEHOLDER_LOGO = "/assets/pub-logos/placeholder_80x80.png";

export function getPublisherLogo(name: string, customLogoUrl?: string): string {
  if (customLogoUrl && customLogoUrl.trim()) {
    return customLogoUrl.trim();
  }
  const clean = (name || "").toLowerCase().trim();
  if (KNOWN_PUBLISHER_LOGOS[clean]) {
    return KNOWN_PUBLISHER_LOGOS[clean];
  }
  for (const [key, logoPath] of Object.entries(KNOWN_PUBLISHER_LOGOS)) {
    if (clean.includes(key) || key.includes(clean)) {
      return logoPath;
    }
  }
  return GENERIC_PLACEHOLDER_LOGO;
}

export const DEFAULT_CTV_PUBLISHERS: CtvPublisherSetting[] = [
  {
    id: "ae-networks",
    name: "A&E Networks",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for Female Focused Audience",
    enabled: true,
    logoUrl: "/assets/pub-logos/a&e_80x80.png",
  },
  {
    id: "abc",
    name: "ABC",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include as often as possible",
    enabled: true,
    logoUrl: "/assets/pub-logos/abc_80x80.png",
  },
  {
    id: "abc-news",
    name: "ABC News",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for news interest and/or B2B targeting campaigns",
    enabled: true,
    logoUrl: "/assets/pub-logos/abc_80x80.png",
  },
  {
    id: "amc-networks",
    name: "AMC Networks",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include often",
    enabled: true,
    logoUrl: "/assets/pub-logos/amc_80x80.png",
  },
  {
    id: "bet",
    name: "BET",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for African American focused audiences",
    enabled: true,
    logoUrl: "",
  },
  {
    id: "bloomberg",
    name: "Bloomberg",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for news interest and/or B2B targeting campaigns",
    enabled: true,
    logoUrl: "/assets/pub-logos/bloomberg_80x80.png",
  },
  {
    id: "bounce",
    name: "Bounce",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for African American focused audiences",
    enabled: true,
    logoUrl: "",
  },
  {
    id: "cbs",
    name: "CBS",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include often",
    enabled: true,
    logoUrl: "/assets/pub-logos/cbs_80x80.png",
  },
  {
    id: "cheddar",
    name: "Cheddar",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for news interest and/or B2B targeting campaigns",
    enabled: true,
    logoUrl: "/assets/pub-logos/cheddar_80x80.png",
  },
  {
    id: "cnbc",
    name: "CNBC",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for news interest and/or B2B targeting campaigns",
    enabled: true,
    logoUrl: "/assets/pub-logos/cnbc_80x80.png",
  },
  {
    id: "cnn",
    name: "CNN",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for news interest and/or B2B targeting campaigns",
    enabled: true,
    logoUrl: "/assets/pub-logos/cnn_80x80.png",
  },
  {
    id: "comedy-central",
    name: "Comedy Central",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for Young Male Audience",
    enabled: true,
    logoUrl: "",
  },
  {
    id: "spectrum",
    name: "Spectrum",
    channel: "CTV / OTT",
    category: "OS",
    notes: "Cable Replacement - include often",
    enabled: true,
    logoUrl: "",
  },
  {
    id: "directv",
    name: "DirecTV",
    channel: "CTV / OTT",
    category: "App",
    notes: "Cable Replacement - include often",
    enabled: true,
    logoUrl: "/assets/pub-logos/directv_80x80.png",
  },
  {
    id: "discovery",
    name: "Discovery",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include as often as possible",
    enabled: true,
    logoUrl: "/assets/pub-logos/discovery_80x80.png",
  },
  {
    id: "discovery-plus",
    name: "Discovery+",
    channel: "CTV / OTT",
    category: "App",
    notes: "Premium, Include as often as possible",
    enabled: true,
    logoUrl: "/assets/pub-logos/discovery+_80x80.png",
  },
  {
    id: "disney-plus",
    name: "Disney+",
    channel: "CTV / OTT",
    category: "App",
    notes: "Premium, Include as often as possible",
    enabled: true,
    logoUrl: "/assets/pub-logos/disney_80x80.png",
  },
  {
    id: "espn",
    name: "ESPN",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include as often as possible",
    enabled: true,
    logoUrl: "/assets/pub-logos/espn_80x80.png",
  },
  {
    id: "food-network",
    name: "Food Network",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include often but low scale",
    enabled: true,
    logoUrl: "",
  },
  {
    id: "fox",
    name: "Fox",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include often",
    enabled: true,
    logoUrl: "/assets/pub-logos/fox_80x80.png",
  },
  {
    id: "fox-news",
    name: "Fox News",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for news interest and/or B2B targeting campaigns",
    enabled: true,
    logoUrl: "/assets/pub-logos/fox_80x80.png",
  },
  {
    id: "freeform",
    name: "Freeform",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for Female or Young Family Focused Audience",
    enabled: true,
    logoUrl: "/assets/pub-logos/freeform_80x80.png",
  },
  {
    id: "fubo",
    name: "Fubo",
    channel: "CTV / OTT",
    category: "App",
    notes: "FAST / ad-supported",
    enabled: true,
    logoUrl: "/assets/pub-logos/fubo_80x80.png",
  },
  {
    id: "fx",
    name: "FX",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include often",
    enabled: true,
    logoUrl: "/assets/pub-logos/fx_80x80.png",
  },
  {
    id: "hallmark-network",
    name: "Hallmark Network",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for Female Focused or Holiday Audience",
    enabled: true,
    logoUrl: "/assets/pub-logos/hallmark_80x80.png",
  },
  {
    id: "hgtv",
    name: "HGTV",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for Female Focused Audience",
    enabled: true,
    logoUrl: "",
  },
  {
    id: "hulu",
    name: "Hulu",
    channel: "CTV / OTT",
    category: "App",
    notes: "Premium, Include as often as possible",
    enabled: true,
    logoUrl: "/assets/pub-logos/hulu_80x80.png",
  },
  {
    id: "lg",
    name: "LG",
    channel: "CTV / OTT",
    category: "OS",
    notes: "FAST / ad-supported - include often",
    enabled: true,
    logoUrl: "/assets/pub-logos/lg_80x80.png",
  },
  {
    id: "lifetime",
    name: "Lifetime",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for Female Focused Audience",
    enabled: true,
    logoUrl: "",
  },
  {
    id: "local-now",
    name: "Local Now",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for news interest and/or B2B targeting campaigns",
    enabled: true,
    logoUrl: "",
  },
  {
    id: "hbo-max",
    name: "HBO Max",
    channel: "CTV / OTT",
    category: "App",
    notes: "Premium Inventory - include for higher HHI audience & large budget opportunities",
    enabled: true,
    logoUrl: "/assets/pub-logos/max_80x80.png",
  },
  {
    id: "nbc",
    name: "NBC",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include as often as possible",
    enabled: true,
    logoUrl: "/assets/pub-logos/nbc_80x80.png",
  },
  {
    id: "newson",
    name: "NewsON",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for news interest and/or B2B targeting campaigns",
    enabled: true,
    logoUrl: "/assets/pub-logos/newson_80x80.png",
  },
  {
    id: "newsy",
    name: "Newsy",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for news interest and/or B2B targeting campaigns",
    enabled: true,
    logoUrl: "/assets/pub-logos/newsy_80x80.png",
  },
  {
    id: "nfl-network",
    name: "NFL Network",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for male or sport focused audience",
    enabled: true,
    logoUrl: "/assets/pub-logos/nfl_80x80.png",
  },
  {
    id: "outside-tv",
    name: "Outside TV",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include of active audience",
    enabled: true,
    logoUrl: "/assets/pub-logos/outside_80x80.png",
  },
  {
    id: "own",
    name: "OWN",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for African American or Female focused audiences",
    enabled: true,
    logoUrl: "",
  },
  {
    id: "paramount",
    name: "Paramount",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include as often as possible",
    enabled: true,
    logoUrl: "/assets/pub-logos/paramount_80x80.png",
  },
  {
    id: "peacock",
    name: "Peacock",
    channel: "CTV / OTT",
    category: "App",
    notes: "Premium Inventory - include for higher HHI audience & large budget opportunities",
    enabled: true,
    logoUrl: "/assets/pub-logos/peacock_80x80.png",
  },
  {
    id: "philo",
    name: "Philo",
    channel: "CTV / OTT",
    category: "App",
    notes: "FAST / ad-supported",
    enabled: true,
    logoUrl: "/assets/pub-logos/philo_80x80.png",
  },
  {
    id: "plex",
    name: "Plex",
    channel: "CTV / OTT",
    category: "App",
    notes: "FAST / ad-supported",
    enabled: true,
    logoUrl: "/assets/pub-logos/plex_80x80.png",
  },
  {
    id: "pluto",
    name: "Pluto",
    channel: "CTV / OTT",
    category: "App",
    notes: "FAST / ad-supported - include often",
    enabled: true,
    logoUrl: "/assets/pub-logos/pluto_80x80.png",
  },
  {
    id: "roku",
    name: "Roku",
    channel: "CTV / OTT",
    category: "OS",
    notes: "Cable Replacement - include often",
    enabled: true,
    logoUrl: "/assets/pub-logos/roku_80x80.png",
  },
  {
    id: "samsung",
    name: "Samsung",
    channel: "CTV / OTT",
    category: "OS",
    notes: "FAST / ad-supported - include often",
    enabled: true,
    logoUrl: "/assets/pub-logos/samsung_80x80.png",
  },
  {
    id: "science-channel",
    name: "Science Channel",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Low Scale",
    enabled: true,
    logoUrl: "/assets/pub-logos/sci_80x80.png",
  },
  {
    id: "sling",
    name: "Sling",
    channel: "CTV / OTT",
    category: "App",
    notes: "FAST / ad-supported",
    enabled: true,
    logoUrl: "/assets/pub-logos/sling_80x80.png",
  },
  {
    id: "the-weather-channel",
    name: "The Weather Channel",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Low Scale",
    enabled: true,
    logoUrl: "",
  },
  {
    id: "travel-channel",
    name: "Travel Channel",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include for travel interests",
    enabled: true,
    logoUrl: "/assets/pub-logos/travel_80x80.png",
  },
  {
    id: "tubi",
    name: "Tubi",
    channel: "CTV / OTT",
    category: "App",
    notes: "FAST / ad-supported- include often",
    enabled: true,
    logoUrl: "/assets/pub-logos/tubi_80x80.png",
  },
  {
    id: "turner",
    name: "Turner",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include as often as possible",
    enabled: true,
    logoUrl: "/assets/pub-logos/turner_80x80.png",
  },
  {
    id: "usa",
    name: "USA",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Low Scale",
    enabled: true,
    logoUrl: "",
  },
  {
    id: "vh1",
    name: "VH1",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Low Scale",
    enabled: true,
    logoUrl: "",
  },
  {
    id: "warner-brothers-discovery",
    name: "Warner Brothers Discovery",
    channel: "CTV / OTT",
    category: "Network",
    notes: "Include as often as possible",
    enabled: true,
    logoUrl: "",
  },
  {
    id: "vizio",
    name: "Vizio",
    channel: "CTV / OTT",
    category: "OS",
    notes: "FAST / ad-supported - include often",
    enabled: true,
    logoUrl: "/assets/pub-logos/vizio_80x80.png",
  },
  {
    id: "xumo",
    name: "Xumo",
    channel: "CTV / OTT",
    category: "App",
    notes: "FAST / ad-supported",
    enabled: true,
    logoUrl: "/assets/pub-logos/xumo_80x80.png",
  },
  {
    id: "amazon-prime",
    name: "Amazon Prime",
    channel: "CTV / OTT",
    category: "App",
    notes: "Advanced Performance not supported",
    enabled: true,
    logoUrl: "/assets/pub-logos/amazon-prime-video_80x80.png",
  },
  {
    id: "netflix",
    name: "Netflix",
    channel: "CTV / OTT",
    category: "App",
    notes: "Advanced Performance not supported",
    enabled: true,
    logoUrl: "/assets/pub-logos/netflix_80x80.png",
  },
  {
    id: "youtube-tv",
    name: "YouTube TV",
    channel: "CTV / OTT",
    category: "App",
    notes: "Advanced Performance not supported",
    enabled: true,
    logoUrl: "",
  },
];

export function cloneCtvPublishers(publishers: CtvPublisherSetting[]): CtvPublisherSetting[] {
  return publishers.map((p) => ({ ...p }));
}

export function validateCtvPublishers(input: unknown): { valid: boolean; publishers: CtvPublisherSetting[]; errors: string[] } {
  if (!Array.isArray(input)) {
    return { valid: false, publishers: cloneCtvPublishers(DEFAULT_CTV_PUBLISHERS), errors: ["Publishers list must be an array"] };
  }
  const errors: string[] = [];
  const cleanList: CtvPublisherSetting[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (!item || typeof item !== "object") {
      errors.push(`Publisher at index ${i} is invalid.`);
      continue;
    }
    const name = String(item.name || "").trim();
    if (!name) {
      errors.push(`Publisher at index ${i} is missing a name.`);
      continue;
    }
    let id = String(item.id || "").trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (seenIds.has(id)) {
      id = `${id}-${i + 1}`;
    }
    seenIds.add(id);

    const categoryRaw = String(item.category || "Network").trim();
    const category = (categoryRaw === "App" || categoryRaw === "OS" || categoryRaw === "Network") ? categoryRaw : "Network";
    const channel = String(item.channel || "CTV / OTT").trim();
    const notes = String(item.notes || "").trim();
    const enabled = item.enabled !== false;
    const logoUrl = typeof item.logoUrl === "string" ? item.logoUrl.trim() : "";
    const isCustom = Boolean(item.isCustom);

    cleanList.push({
      id,
      name,
      channel,
      category,
      notes,
      enabled,
      logoUrl,
      isCustom,
    });
  }

  if (cleanList.length === 0) {
    return { valid: false, publishers: cloneCtvPublishers(DEFAULT_CTV_PUBLISHERS), errors: ["Publisher list cannot be empty"] };
  }

  return {
    valid: errors.length === 0,
    publishers: cleanList,
    errors,
  };
}

export function loadCtvPublishersFromStorage(storage: Storage | null): CtvPublisherSetting[] {
  if (!storage) return cloneCtvPublishers(DEFAULT_CTV_PUBLISHERS);
  try {
    const raw = storage.getItem(CTV_PUBLISHERS_STORAGE_KEY);
    if (!raw) return cloneCtvPublishers(DEFAULT_CTV_PUBLISHERS);
    const parsed = JSON.parse(raw);
    const result = validateCtvPublishers(parsed);
    return result.publishers;
  } catch {
    return cloneCtvPublishers(DEFAULT_CTV_PUBLISHERS);
  }
}

export function saveCtvPublishersToStorage(storage: Storage | null, publishers: CtvPublisherSetting[]): { valid: boolean; publishers: CtvPublisherSetting[]; errors: string[] } {
  const result = validateCtvPublishers(publishers);
  if (result.valid && storage) {
    try {
      storage.setItem(CTV_PUBLISHERS_STORAGE_KEY, JSON.stringify(result.publishers));
    } catch (e) {
      console.warn("Failed to write CTV publishers to localStorage:", e);
    }
  }
  return result;
}

export function resolvePublisherLogo(publisherName: string, customPublishers?: CtvPublisherSetting[]): string {
  if (!publisherName) return "/assets/pub-logos/placeholder_80x80.png";
  const normalized = publisherName.toLowerCase().trim();

  // 1. Check custom publishers list if provided
  if (customPublishers && Array.isArray(customPublishers)) {
    const customMatch = customPublishers.find(
      (p) => p.name.toLowerCase().trim() === normalized || normalized.includes(p.name.toLowerCase().trim())
    );
    if (customMatch && customMatch.logoUrl) {
      return customMatch.logoUrl;
    }
  }

  // 2. Check exact known publisher logos map
  if (KNOWN_PUBLISHER_LOGOS[normalized]) {
    return KNOWN_PUBLISHER_LOGOS[normalized];
  }

  // 3. Partial / substring match
  for (const [key, logoPath] of Object.entries(KNOWN_PUBLISHER_LOGOS)) {
    if (normalized === key || normalized.includes(key) || (key.length > 3 && key.includes(normalized))) {
      return logoPath;
    }
  }

  return "/assets/pub-logos/placeholder_80x80.png";
}
