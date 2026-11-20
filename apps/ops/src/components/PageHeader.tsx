import type { ReactNode } from "react";
import { PageHeader as KitPageHeader, StatCard } from "./kit";

/** Ops page header (shared kit PageHeader). */
export function PageHeader({ title, hint, actions }: { title: string; hint?: string; actions?: ReactNode }) {
  return <KitPageHeader title={title} hint={hint} actions={actions} />;
}
export function StatTile({ label, value, tone }: { label: string; value: ReactNode; tone?: "warn" | "ok" }) {
  return <StatCard label={label} value={value} tone={tone} />;
}
