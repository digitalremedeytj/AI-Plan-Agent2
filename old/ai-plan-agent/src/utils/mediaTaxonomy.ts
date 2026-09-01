import { CanonicalMediaType, MediaTaxonomyItem, TaxonomyMapping } from '../types';

export const CANONICAL_MEDIA_TAXONOMY: MediaTaxonomyItem[] = [
  {
    id: 'ctv',
    displayName: 'CTV / OTT',
    category: 'Video/TV',
    aliases: ['ctv', 'connected tv', 'ott', 'streaming tv', 'smart tv', 'pluto', 'tubi', 'roku', 'vizio', 'hulu', 'paramount+', 'max', 'peacock'],
    description: 'Connected TV premium long-form video inventory on television screens.',
  },
  {
    id: 'youtube_tv',
    displayName: 'YouTube TV',
    category: 'Video/TV',
    aliases: ['youtube tv', 'yt tv', 'vmpg'],
    description: 'Live television streaming ads on YouTube TV service.',
  },
  {
    id: 'sports_ott',
    displayName: 'Sports OTT',
    category: 'Video/TV',
    aliases: ['sports ott', 'sports streaming', 'espn+', 'nfl+', 'live sports ott'],
    description: 'Live or on-demand sports video inventory delivered via OTT.',
  },
  {
    id: 'performance_tv',
    displayName: 'Performance TV',
    category: 'Video/TV',
    aliases: ['performance tv', 'attributable ctv', 'direct response ctv', 'mountain', 'tatari'],
    description: 'TV inventory optimized for direct-response performance and conversions.',
  },
  {
    id: 'digital_video_blend',
    displayName: 'Digital Video Blend',
    category: 'Video/TV',
    aliases: ['digital video blend', 'video blend', 'cross-screen video', 'olv / ctv blend', 'olv'],
    description: 'Managed mix of online video (OLV) across mobile, desktop, and web.',
  },
  {
    id: 'digital_audio',
    displayName: 'Digital Audio',
    category: 'Audio',
    aliases: ['digital audio', 'audio', 'streaming audio', 'spotify', 'iheart', 'pandora', 'podcast', 'podcasts'],
    description: 'Streaming music, podcasts, and digital radio ads.',
  },
  {
    id: 'geofence_video',
    displayName: 'Geofence Video',
    category: 'Video/TV',
    aliases: ['geofence video', 'location video', 'location-based video'],
    description: 'Mobile video targeted based on physical location presence.',
  },
  {
    id: 'social_advertising',
    displayName: 'Social Advertising',
    category: 'Social',
    aliases: ['social', 'paid social', 'social advertising', 'facebook', 'instagram', 'meta', 'tiktok', 'linkedin', 'x', 'twitter', 'pinterest', 'snapchat'],
    description: 'Targeted ad placements across top social media platforms.',
  },
  {
    id: 'amazon_ott',
    displayName: 'Amazon OTT / Freevee',
    category: 'Video/TV',
    aliases: ['amazon ott', 'amazon prime video', 'freevee', 'fire tv', 'amazon dsp video'],
    description: 'Streaming video ads within Amazon Prime Video and Freevee ecosystem.',
  },
  {
    id: 'programmatic_display',
    displayName: 'Programmatic Display',
    category: 'Display/Native',
    aliases: ['programmatic display', 'display', 'banner ads', 'web display', 'desktop display', 'mobile display'],
    description: 'Banner and rich media ads bought programmatically across web/apps.',
  },
  {
    id: 'programmatic_video',
    displayName: 'Programmatic Video',
    category: 'Video/TV',
    aliases: ['programmatic video', 'in-stream video', 'out-stream video', 'pre-roll', 'mid-roll'],
    description: 'Auction-based web and app video inventory.',
  },
  {
    id: 'youtube',
    displayName: 'YouTube',
    category: 'Video/TV',
    aliases: ['youtube', 'youtube video', 'google video', 'yt shorts', 'trueview'],
    description: 'Video placements across standard YouTube and YouTube Shorts.',
  },
  {
    id: 'email_marketing',
    displayName: 'Email Marketing',
    category: 'Other',
    aliases: ['email marketing', 'email', 'newsletter', 'crm email', 'dedicated email blast'],
    description: 'Direct-to-inbox sponsored newsletters or permissioned list emails.',
  },
  {
    id: 'linear_tv',
    displayName: 'Linear TV',
    category: 'Video/TV',
    aliases: ['linear tv', 'broadcast tv', 'cable tv', 'traditional tv', 'local broadcast', 'national cable'],
    description: 'Traditional broadcast and cable television ad spots.',
  },
  {
    id: 'google_search',
    displayName: 'Google Search',
    category: 'Search',
    aliases: ['google search', 'paid search', 'search', 'sem', 'google ads search', 'bing search', 'microsoft search'],
    description: 'Intent-driven keyword search engine advertising.',
  },
  {
    id: 'geofence_display',
    displayName: 'Geofence Display',
    category: 'Display/Native',
    aliases: ['geofence display', 'location display', 'geofencing', 'location-based display'],
    description: 'Mobile display banner ads targeted to physical location boundaries.',
  },
  {
    id: 'digital_out_of_home',
    displayName: 'Digital Out Of Home (DOOH)',
    category: 'Out of Home',
    aliases: ['digital out of home', 'dooh', 'ooh', 'billboards', 'place-based media', 'transit screens', 'elevator screens'],
    description: 'Digital public screens in high-traffic venues, transit, and billboards.',
  },
  {
    id: 'native',
    displayName: 'Native Advertising',
    category: 'Display/Native',
    aliases: ['native', 'native advertising', 'native display', 'taboola', 'outbrain', 'sponsored content', 'content recommendation'],
    description: 'Editorial-style sponsored content feeds matching publisher environments.',
  },
  {
    id: 'display_retargeting',
    displayName: 'Display Retargeting',
    category: 'Display/Native',
    aliases: ['display retargeting', 'retargeting', 'remarketing', 'site retargeting', 'crm retargeting'],
    description: 'Targeted display ads re-engaging warm visitors and prior leads.',
  },
  {
    id: 'advanced_measurement',
    displayName: 'Advanced Measurement',
    category: 'Other',
    aliases: [
      'advanced measurement',
      'measurement',
      'halo effect study',
      'halo effect',
      'incrementality',
      'incrementality study',
      'attribution study',
      'lift study'
    ],
    description: 'Add-on measurement & analytics studies including Halo Effect Studies and Incrementality testing. Added value / measurement item (not scored).',
  },
  {
    id: 'ad_serving',
    displayName: 'Ad Serving',
    category: 'Other',
    aliases: [
      'ad serving',
      'ad server',
      'ad serving fee',
      'ad serving fees',
      '3rd party ad serving',
      'third party ad serving',
      'ad-serving',
      'dcm',
      'flashtalking',
      'sizmek'
    ],
    description: 'Added value or technical ad serving line item. Non-media item (not scored).',
  },
];

/**
 * Helper to identify added value or technical non-media items (Ad Serving, Advanced Measurement)
 * which should be excluded from media channel performance scoring.
 */
export function isNonMediaItem(canonicalId: string): boolean {
  if (!canonicalId) return false;
  const clean = canonicalId.trim().toLowerCase();
  return (
    clean === 'ad_serving' ||
    clean === 'advanced_measurement' ||
    clean.includes('ad serving') ||
    clean.includes('advanced measurement') ||
    clean.includes('ad server')
  );
}

/**
 * Normalizes a raw string channel label from an RFP into a canonical media taxonomy item.
 */
export function normalizeRawChannel(rawLabel: string): TaxonomyMapping {
  if (!rawLabel || typeof rawLabel !== 'string') {
    return {
      rawLabel: rawLabel || 'Unknown Channel',
      canonicalId: 'programmatic_display',
      confidence: 0.5,
      isUserVerified: false,
    };
  }

  const clean = rawLabel.trim().toLowerCase();

  // 1. Direct match on display names or IDs
  for (const item of CANONICAL_MEDIA_TAXONOMY) {
    if (item.displayName.toLowerCase() === clean || item.id === clean) {
      return {
        rawLabel,
        canonicalId: item.id,
        confidence: 1.0,
        isUserVerified: true,
      };
    }
  }

  // 2. Exact match in alias array
  for (const item of CANONICAL_MEDIA_TAXONOMY) {
    for (const alias of item.aliases) {
      if (alias === clean) {
        return {
          rawLabel,
          canonicalId: item.id,
          confidence: 0.95,
          isUserVerified: false,
        };
      }
    }
  }

  // 3. Substring match
  for (const item of CANONICAL_MEDIA_TAXONOMY) {
    for (const alias of item.aliases) {
      if (clean.includes(alias) || alias.includes(clean)) {
        return {
          rawLabel,
          canonicalId: item.id,
          confidence: 0.8,
          isUserVerified: false,
        };
      }
    }
  }

  // Fallback heuristic based on generic keywords
  if (clean.includes('search')) return { rawLabel, canonicalId: 'google_search', confidence: 0.7, isUserVerified: false };
  if (clean.includes('social') || clean.includes('meta') || clean.includes('insta')) return { rawLabel, canonicalId: 'social_advertising', confidence: 0.7, isUserVerified: false };
  if (clean.includes('tv') || clean.includes('ott') || clean.includes('ctv')) return { rawLabel, canonicalId: 'ctv', confidence: 0.7, isUserVerified: false };
  if (clean.includes('audio') || clean.includes('radio') || clean.includes('podcast')) return { rawLabel, canonicalId: 'digital_audio', confidence: 0.7, isUserVerified: false };
  if (clean.includes('video') || clean.includes('olv')) return { rawLabel, canonicalId: 'programmatic_video', confidence: 0.7, isUserVerified: false };
  if (clean.includes('ooh') || clean.includes('dooh') || clean.includes('billboard')) return { rawLabel, canonicalId: 'digital_out_of_home', confidence: 0.7, isUserVerified: false };
  if (clean.includes('retarget')) return { rawLabel, canonicalId: 'display_retargeting', confidence: 0.85, isUserVerified: false };
  if (clean.includes('measurement') || clean.includes('halo') || clean.includes('incrementality')) return { rawLabel, canonicalId: 'advanced_measurement', confidence: 0.9, isUserVerified: false };
  if (clean.includes('ad serving') || clean.includes('ad server') || clean.includes('serving fee')) return { rawLabel, canonicalId: 'ad_serving', confidence: 0.9, isUserVerified: false };

  // Absolute fallback
  return {
    rawLabel,
    canonicalId: 'programmatic_display',
    confidence: 0.5,
    isUserVerified: false,
  };
}

export function getCanonicalItem(id: CanonicalMediaType): MediaTaxonomyItem {
  return CANONICAL_MEDIA_TAXONOMY.find((item) => item.id === id) || CANONICAL_MEDIA_TAXONOMY[0];
}
