import type { LucideIcon } from "lucide-react";

/** Harvested from kiorex-web-app FeatureCard, restyled to the Kiorex system. */
export function FeatureCard({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="kx-card h-full p-6">
      <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-primary"><Icon className="h-6 w-6" aria-hidden="true" /></span>
      <h3 className="mb-2 text-lg">{title}</h3>
      <p className="text-muted-foreground">{body}</p>
    </div>
  );
}
