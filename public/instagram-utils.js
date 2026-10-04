// Shared by the Worker and the Instagram-only browser player.
export function parseInstagramUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!["instagram.com", "www.instagram.com", "m.instagram.com"].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)(?:\/embed)?\/?$/);
    if (!match) return null;
    const kind = match[1] === "reels" ? "reel" : match[1];
    const sourceUrl = `https://www.instagram.com/${kind}/${match[2]}/`;
    return { id: match[2], sourceUrl, embedUrl: `${sourceUrl}embed/` };
  } catch {
    return null;
  }
}
