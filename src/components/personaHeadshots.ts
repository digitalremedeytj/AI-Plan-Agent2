import type { PersonaAvatarVersion } from "../types";

// The live headshot is drawn up to 176 CSS px (the edit modal), so 384px stays sharp on a 2x
// screen and gives the slide generator a usable reference face. ~24KB as a JPEG data URL.
export const HEADSHOT_PX = 384;
export const HEADSHOT_QUALITY = 0.75;
// History versions are only shown as small thumbnails. Every image is stored inside the plan's
// one Firestore document (1MB, and plans already run ~500KB), so up to 8 versions x 4 personas
// cannot all be full size. ~4KB each.
export const THUMBNAIL_PX = 120;
export const THUMBNAIL_QUALITY = 0.65;

/**
 * Full-size copies of versions whose saved entry is now a thumbnail, keyed by version id, so
 * switching back to a version generated earlier in this session stays sharp. Lost on reload,
 * which only means an older version picked later comes back at thumbnail size.
 */
export const sessionFullHeadshots = new Map<string, string>();

/**
 * Keeps the active headshot full size, and its own history entry too (the modal finds the
 * current version by comparing URLs), while every other version is reduced to a thumbnail.
 */
export async function settleAvatarHistory(
  activeUrl: string,
  history: PersonaAvatarVersion[],
  toThumbnail: (url: string) => Promise<string>,
  fullById: Map<string, string> = sessionFullHeadshots,
): Promise<{ avatarUrl: string; avatarHistory: PersonaAvatarVersion[] }> {
  for (const version of history) {
    // Longer is the larger image: a thumbnail must never replace the full copy.
    if (version.url.length > (fullById.get(version.id)?.length ?? 0)) fullById.set(version.id, version.url);
  }
  const active = history.find((version) => version.url === activeUrl);
  const avatarUrl = (active && fullById.get(active.id)) || activeUrl;
  const avatarHistory = await Promise.all(
    history.map(async (version) => ({ ...version, url: version === active ? avatarUrl : await toThumbnail(version.url) })),
  );
  return { avatarUrl, avatarHistory };
}
