/**
 * Utilities for plan naming, cloning suffix generation, and sequence management.
 */

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generates an intuitive cloned plan title from an original title and the current list of titles.
 * Examples:
 *   - "Nike Q4" -> "Nike Q4 (Copy)"
 *   - "Nike Q4 (Copy)" -> "Nike Q4 (Copy 2)"
 *   - "Nike Q4" (when "Nike Q4 (Copy)" and "Nike Q4 (Copy 2)" exist) -> "Nike Q4 (Copy 3)"
 */
export function generateClonedPlanTitle(originalTitle: string, existingTitles: string[]): string {
  const trimmed = originalTitle.trim() || "Untitled Plan";
  // Extract base title by removing trailing (Copy) or (Copy N)
  const copySuffixRegex = /^(.*?)(?:\s+\(Copy(?:\s+(\d+))?\))?$/i;
  const match = trimmed.match(copySuffixRegex);
  const baseTitle = (match && match[1] ? match[1] : trimmed).trim() || "Untitled Plan";

  const siblingPattern = new RegExp(`^${escapeRegExp(baseTitle)}(?:\\s+\\(Copy(?:\\s+(\\d+))?\\))?$`, "i");

  let hasFirstCopy = false;
  let maxCopyNum = 0;

  for (const title of existingTitles) {
    if (!title) continue;
    const cleanTitle = title.trim();
    const m = cleanTitle.match(siblingPattern);
    if (m) {
      if (cleanTitle.toLowerCase() === `${baseTitle.toLowerCase()} (copy)`) {
        hasFirstCopy = true;
        maxCopyNum = Math.max(maxCopyNum, 1);
      } else if (m[1] !== undefined) {
        const parsed = parseInt(m[1], 10);
        if (!isNaN(parsed) && parsed > 0) {
          maxCopyNum = Math.max(maxCopyNum, parsed);
        }
      }
    }
  }

  if (!hasFirstCopy && maxCopyNum === 0) {
    return `${baseTitle} (Copy)`;
  }

  const nextNum = Math.max(maxCopyNum + 1, 2);
  return `${baseTitle} (Copy ${nextNum})`;
}
