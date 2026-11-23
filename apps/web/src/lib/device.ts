/** "Mozilla/5.0 (Macintosh; ...) Chrome/159 Safari/537" is not something a patient can recognise: reduce a user agent to "Chrome on macOS". */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua || ua === "—") return "—";
  if (/^kiorex-(mobile|app)/i.test(ua) || /expo|okhttp|cfnetwork/i.test(ua)) return /android|okhttp/i.test(ua) ? "Kiorex app · Android" : /cfnetwork|ios|iphone/i.test(ua) ? "Kiorex app · iOS" : "Kiorex app";
  const os = /Windows/i.test(ua) ? "Windows" : /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iOS" : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : null;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  if (browser && os) return `${browser} · ${os}`;
  return browser ?? os ?? (ua.length > 40 ? `${ua.slice(0, 40)}…` : ua);
}
