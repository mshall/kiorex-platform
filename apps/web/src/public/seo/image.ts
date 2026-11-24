/**
 * Image optimisation helper (GRW-P1-F). Provider photos are external https URLs. With an image CDN configured (`SITE_IMAGE_CDN`, a resizer that
 * answers `GET {cdn}/image?url=<https url>&w=<px>&f=<avif|webp|jpeg>`; go-live task) the `<picture>` offers AVIF and WebP sources at three widths; without
 * one the original is used with explicit width and height (no layout shift). Always: meaningful alt text, `decoding="async"`, lazy loading for everything
 * below the fold and `fetchpriority="high"` + eager for the single LCP image of a page. Only https URLs are ever emitted.
 */
export interface ImageSpec { url: string | null; alt: string; width: number; height: number; priority?: boolean; widths?: number[]; sizes?: string; cdn?: string | null }
export interface ImageSource { type: string; srcSet: string }
export interface ImageModel { img: { src: string; srcSet?: string; sizes?: string; width: number; height: number; alt: string; loading: "lazy" | "eager"; decoding: "async"; fetchPriority?: "high" }; sources: ImageSource[] }

const isHttps = (u: string | null | undefined): u is string => !!u && /^https:\/\/[^\s"'<>]+$/.test(u);

export function cdnUrl(cdn: string, url: string, w: number, fmt: "avif" | "webp" | "jpeg"): string {
  return `${cdn.replace(/\/+$/, "")}/image?url=${encodeURIComponent(url)}&w=${w}&f=${fmt}`;
}

export function imageModel(s: ImageSpec): ImageModel | null {
  if (!isHttps(s.url)) return null;
  const widths = (s.widths ?? [s.width, s.width * 2, s.width * 3]).filter((w, i, a) => w > 0 && a.indexOf(w) === i);
  const cdn = s.cdn && /^https:\/\//.test(s.cdn) ? s.cdn : null;
  const base = { width: s.width, height: s.height, alt: s.alt, decoding: "async" as const, loading: s.priority ? ("eager" as const) : ("lazy" as const), ...(s.priority ? { fetchPriority: "high" as const } : {}) };
  if (!cdn) return { img: { src: s.url, ...base }, sources: [] };
  const set = (fmt: "avif" | "webp" | "jpeg") => widths.map((w) => `${cdnUrl(cdn, s.url!, w, fmt)} ${w}w`).join(", ");
  return {
    sources: [{ type: "image/avif", srcSet: set("avif") }, { type: "image/webp", srcSet: set("webp") }],
    img: { src: cdnUrl(cdn, s.url, s.width * 2, "jpeg"), srcSet: set("jpeg"), sizes: s.sizes ?? `${s.width}px`, ...base },
  };
}
