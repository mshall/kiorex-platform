import { BadgeCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** Photo (or initial on a brand gradient) with an optional verified seal. Decorative: the name is always next to it. */
export function DoctorAvatar({ name, photoUrl, verified, size = "md", className }: { name: string; photoUrl?: string | null; verified?: boolean; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  const dim = size === "sm" ? "h-11 w-11 text-base" : size === "xl" ? "h-28 w-28 text-4xl md:h-32 md:w-32" : size === "lg" ? "h-20 w-20 text-2xl" : "h-16 w-16 text-xl";
  const initial = name.replace(/^(د\.|Dr\.?)\s*/i, "").trim().slice(0, 1);
  return (
    <div className={cn("relative shrink-0", className)}>
      <Avatar className={cn(dim, "ring-2 ring-card shadow-raised")}>
        {photoUrl && <AvatarImage src={photoUrl} alt="" className="object-cover" />}
        <AvatarFallback className="bg-linear-to-br from-primary/15 via-accent to-ocean/20 font-semibold text-primary">{initial}</AvatarFallback>
      </Avatar>
      {verified && (
        <span className="absolute -bottom-0.5 -inset-e-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-card text-ocean shadow-raised" aria-hidden="true"><BadgeCheck className="h-5 w-5" /></span>
      )}
    </div>
  );
}
