const versionWords = new Set(["remix", "edit", "extended", "radio", "club", "vip", "mix"]);
const stopwords = new Set([...versionWords, "feat", "ft", "version", "album", "single", "original", "the", "a", "an", "of", "for", "and"]);
export const isrcPattern = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
export const uniqueValues = <T>(values: (T | null | undefined)[]) => [...new Set(values.filter((value): value is T => Boolean(value)))];
export const nameKey = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
export const words = (value: string) => new Set((value.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => !stopwords.has(word)));
export const marked = (title: string) => (title.toLocaleLowerCase().match(/[a-z]+/g) ?? []).some((word) => versionWords.has(word));
export function searchTitle(title: string): string { return title.replace(/\s*[([](?:feat|ft)\.?[^)\]]*[)\]]/gi, "").replace(/\s+/g, " ").trim(); }
export function versionPreference(title: string): number { const terms = new Set(title.toLocaleLowerCase().match(/[a-z]+/g) ?? []); return terms.has("extended") ? 2 : terms.has("radio") || terms.has("edit") ? 0 : 1; }
export interface MusicBrainzRelease { title?: string; status?: string; "release-group"?: { title?: string; "secondary-types"?: string[] } }
/** Match Python's difflib.SequenceMatcher ratio for the short metadata strings used here. */
export function sequenceSimilarity(left: string, right: string): number {
  const pending: [number, number, number, number][] = [[0, left.length, 0, right.length]];
  let matches = 0;
  while (pending.length) {
    const [leftStart, leftEnd, rightStart, rightEnd] = pending.pop()!;
    let bestLeft = leftStart; let bestRight = rightStart; let bestSize = 0;
    for (let leftIndex = leftStart; leftIndex < leftEnd; leftIndex++) {
      for (let rightIndex = rightStart; rightIndex < rightEnd; rightIndex++) {
        let size = 0;
        while (leftIndex + size < leftEnd && rightIndex + size < rightEnd && left[leftIndex + size] === right[rightIndex + size]) size++;
        if (size > bestSize) [bestLeft, bestRight, bestSize] = [leftIndex, rightIndex, size];
      }
    }
    if (!bestSize) continue;
    matches += bestSize;
    if (leftStart < bestLeft && rightStart < bestRight) pending.push([leftStart, bestLeft, rightStart, bestRight]);
    if (bestLeft + bestSize < leftEnd && bestRight + bestSize < rightEnd) pending.push([bestLeft + bestSize, leftEnd, bestRight + bestSize, rightEnd]);
  }
  return left.length + right.length ? (2 * matches) / (left.length + right.length) : 1;
}
export function releaseScore(release: MusicBrainzRelease, sourceAlbum: string): number { const group = release["release-group"] ?? {}; const source = nameKey(sourceAlbum); const titles = [nameKey(release.title ?? ""), nameKey(group.title ?? "")].filter(Boolean); let score = Math.max(0, ...titles.map((title) => sequenceSimilarity(source, title) * 100)); if (source && titles.includes(source)) score += 1000; if ((group["secondary-types"] ?? []).some((type) => type.toLocaleLowerCase() === "compilation") && !titles.includes(source)) score -= 30; if (release.status?.toLocaleLowerCase() === "official") score += 5; return score; }
