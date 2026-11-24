import { KiorexLogo } from "@/brand/kiorex-logo";
import { cn } from "@/lib/utils";

/** KIOREX logo (founder spec 25 Nov 2026: 8-channel waveform + coral pulse). Theme follows the app's `.dark` class automatically; heights below 32px switch to the 4-channel micro mark.
 *  The master viewBox carries clear space around the artwork (ink = x 24..314, y 26..104 of 440 x 130), so `trim` pulls the box in to the ink and the logo aligns with the page gutter. */
const INK = { top: 26 / 130, left: 24 / 130, right: (440 - 314.5) / 130 };

export function LogoMark({ className, title, height = 32, theme }: { className?: string; title?: string; height?: number; theme?: "light" | "dark" | "auto" }) {
  return <KiorexLogo variant="mark" height={height} theme={theme} followSystem={false} title={title ?? "KIOREX"} className={className} />;
}

/** Full lockup (mark | coral divider | KIOREX), trimmed to its ink box. `height` is the viewBox height (ink is 60% of it): 64 = header, 56 = footer / compact. */
export function Logo({ className, height = 64, wordmark = true, title }: { className?: string; height?: number; wordmark?: boolean; title?: string }) {
  if (!wordmark) return <span className={cn("inline-flex items-center", className)} dir="ltr"><LogoMark height={Math.min(height, 40)} title={title} /></span>;
  return (
    <span className={cn("inline-flex items-center", className)} dir="ltr">
      <KiorexLogo variant="full" height={height} followSystem={false} title={title ?? "KIOREX"} style={{ margin: `${-INK.top * height}px ${-INK.right * height}px ${-INK.top * height}px ${-INK.left * height}px`, maxWidth: "none" }} />
    </span>
  );
}
