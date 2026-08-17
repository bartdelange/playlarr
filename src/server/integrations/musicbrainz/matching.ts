const versionWords = new Set(["remix", "edit", "extended", "radio", "club", "vip", "mix"]);
const stopwords = new Set([...versionWords, "feat", "ft", "version", "album", "single", "original", "the", "a", "an", "of", "for", "and"]);
export const isrcPattern = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
export const uniqueValues = <T>(values: (T | null | undefined)[]) => [...new Set(values.filter((value): value is T => Boolean(value)))];
export const nameKey = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
export const words = (value: string) => new Set((value.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => !stopwords.has(word)));
export const marked = (title: string) => (title.toLocaleLowerCase().match(/[a-z]+/g) ?? []).some((word) => versionWords.has(word));
export function searchTitle(title: string): string { return title.replace(/\s*[([](?:feat|ft)\.?[^)\]]*[)\]]/gi, "").replace(/\s+/g, " ").trim(); }
export function versionPreference(title: string): number { const terms = new Set(title.toLocaleLowerCase().match(/[a-z]+/g) ?? []); return terms.has("extended") ? 2 : terms.has("radio") || terms.has("edit") ? 0 : 1; }
