import { cn } from "@/lib/utils";

/** Shimmer placeholder (brand skeleton). Static under prefers-reduced-motion (tokens.css collapses the animation). */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("kx-skeleton", className)} {...props} />;
}

export { Skeleton };
