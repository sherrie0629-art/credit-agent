/** Client-safe helpers for creative image URLs (no server imports). */

/** Append width query for the public image route's on-the-fly thumbnail. */
export function creativeThumbUrl(url: string, width = 256): string {
  if (!url || url.startsWith("data:")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}w=${width}`;
}
