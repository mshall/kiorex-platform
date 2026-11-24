import { BadgeCheck, CalendarClock, Wallet } from "lucide-react";
import { KiorexLogo } from "@/brand/kiorex-logo";
import { cn } from "@/lib/utils";

/** Hero visual: the brand mark at scale on a soft orb, the pulse drawing itself, three glass proof chips floating around it. Built only from the brand motif. */
export function HeroArt({ labels, className }: { labels: { verified: string; slots: string; fees: string }; className?: string }) {
  const chip = "kx-glass kx-rise absolute flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold shadow-raised";
  return (
    <div className={cn("relative mx-auto aspect-square w-full max-w-md", className)} aria-hidden="true">
      <div className="absolute inset-[6%] rounded-full bg-linear-to-br from-primary/20 via-accent to-ocean/25 blur-[2px]" />
      <div className="absolute inset-[16%] rounded-full border border-primary/15 bg-card/70 shadow-float backdrop-blur-xs" />
      <div className="absolute inset-0 flex items-center justify-center">
        <KiorexLogo variant="mark" height={96} followSystem={false} title="" animated className="h-[34%] w-auto scale-[2.1]" />
      </div>
      <span className={cn(chip, "inset-s-[-2%] top-[18%]")} style={{ ["--i" as string]: 3 }}><BadgeCheck className="h-4 w-4 text-ocean" />{labels.verified}</span>
      <span className={cn(chip, "inset-e-[-2%] top-[46%]")} style={{ ["--i" as string]: 4 }}><CalendarClock className="h-4 w-4 text-primary" />{labels.slots}</span>
      <span className={cn(chip, "inset-s-[6%] bottom-[10%]")} style={{ ["--i" as string]: 5 }}><Wallet className="h-4 w-4 text-pulse" />{labels.fees}</span>
    </div>
  );
}
