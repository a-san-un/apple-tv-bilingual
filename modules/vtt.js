export function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function normalizeSubtitleText(raw) {
  return String(raw || "")
    .replace(/\r\n?/g, "\n")
    .replace(/<c(\.[^>]+)?>/g, "")
    .replace(/<\/c>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function cleanCueText(cue) {
  if (!cue) return "";
  if (cue.getCueAsHTML) {
    return normalizeSubtitleText(cue.getCueAsHTML().textContent || "");
  }
  return normalizeSubtitleText(cue.text || "");
}
