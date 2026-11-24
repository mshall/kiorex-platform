import { BarChart3, Building2, Code2, FileText, FlaskConical, Gift, Globe, HeartHandshake, LayoutDashboard, Mail, Megaphone, MessageCircle, Percent, Plug, Radio, Scale, ScrollText, Search, ShieldAlert, Users, Wallet, Award, GitBranch, ClipboardCheck, Bot, Lightbulb, Briefcase, Crown, LineChart, Layers, ListChecks, Rocket, type LucideIcon } from "lucide-react";

/** The Growth & Patient Acquisition navigation (founder's order). `live` pages work in Phase 1; `planned` pages show an honest Planned: Phase N state and nothing else. */
export interface GrowthSection { key: string; to: string; icon: LucideIcon; status: "live" | "planned"; phase?: 2 | 3 | 4; pkg?: string }
export const GROWTH_SECTIONS: readonly GrowthSection[] = [
  { key: "overview", to: "/growth", icon: LayoutDashboard, status: "live" },
  { key: "campaigns", to: "/growth/campaigns", icon: Megaphone, status: "live", phase: 2, pkg: "GRW-P2-A" },
  { key: "approvals", to: "/growth/approvals", icon: ClipboardCheck, status: "live", phase: 2, pkg: "GRW-P2-A" },
  { key: "channels", to: "/growth/channels", icon: Radio, status: "live" },
  { key: "providers", to: "/growth/providers", icon: Building2, status: "live" },
  { key: "patients", to: "/growth/patients", icon: Users, status: "live" },
  { key: "referrals", to: "/growth/referrals", icon: Gift, status: "live", phase: 2, pkg: "GRW-P2-B1" },
  { key: "rewards", to: "/growth/rewards", icon: Award, status: "live", phase: 2, pkg: "GRW-P2-B2" },
  { key: "promotions", to: "/growth/promotions", icon: Percent, status: "live", phase: 2, pkg: "GRW-P2-A" },
  { key: "seo", to: "/growth/seo", icon: Search, status: "live" },
  { key: "landing", to: "/growth/landing-pages", icon: FileText, status: "live" },
  { key: "widgets", to: "/growth/widgets", icon: Code2, status: "live" },
  { key: "whatsapp", to: "/growth/whatsapp", icon: MessageCircle, status: "live", phase: 2, pkg: "GRW-P2-D" },
  { key: "assistant", to: "/growth/assistant", icon: Bot, status: "live", phase: 2, pkg: "GRW-P2-D" },
  { key: "lifecycle", to: "/growth/lifecycle", icon: HeartHandshake, status: "live", phase: 2, pkg: "GRW-P2-E" },
  { key: "templates", to: "/growth/templates", icon: Mail, status: "live" },
  { key: "experiments", to: "/growth/experiments", icon: FlaskConical, status: "planned", phase: 3, pkg: "GRW-P3-A" },
  { key: "attribution", to: "/growth/attribution", icon: Scale, status: "live" },
  { key: "attribution-models", to: "/growth/attribution-models", icon: Layers, status: "live", phase: 3, pkg: "GRW-P3-B" },
  { key: "cohorts", to: "/growth/cohorts", icon: LineChart, status: "planned", phase: 3, pkg: "GRW-P3-C" },
  { key: "fraud", to: "/growth/fraud", icon: ShieldAlert, status: "live" },
  { key: "review-queue", to: "/growth/review-queue", icon: ListChecks, status: "planned", phase: 3, pkg: "GRW-P3-D" },
  { key: "analytics", to: "/growth/analytics", icon: BarChart3, status: "live" },
  { key: "finance", to: "/growth/finance", icon: Wallet, status: "live" },
  { key: "markets", to: "/growth/markets", icon: Globe, status: "live" },
  { key: "onboarding", to: "/growth/onboarding", icon: Rocket, status: "planned", phase: 3, pkg: "GRW-P3-G" },
  { key: "recommendations", to: "/growth/recommendations", icon: Lightbulb, status: "planned", phase: 3, pkg: "GRW-P3-E" },
  { key: "corporate", to: "/growth/corporate", icon: Briefcase, status: "planned", phase: 4, pkg: "GRW-P4-C" },
  { key: "loyalty", to: "/growth/loyalty", icon: Crown, status: "planned", phase: 4, pkg: "GRW-P4-D" },
  { key: "integrations", to: "/growth/integrations", icon: Plug, status: "live" },
  { key: "audit", to: "/growth/audit", icon: ScrollText, status: "live" },
  { key: "config", to: "/growth/config", icon: GitBranch, status: "live" },
] as const;
export const sectionOf = (key: string) => GROWTH_SECTIONS.find((s) => s.key === key);
export const PLANNED_SECTIONS = GROWTH_SECTIONS.filter((s) => s.status === "planned");
