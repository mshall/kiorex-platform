import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/auth/AuthProvider";
import { RequireOps } from "@/auth/RequireOps";
import { OpsLayout } from "@/components/OpsLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LoadingState } from "@/components/states";
import { ApiError } from "@/api/errors";
import { BookingTimelinePage, FinancePage, LiquidityPage, ModerationPage, OutboxPage, ProvidersPage } from "@/pages/SimplePages";
import AuthCallbackPage from "@/pages/AuthCallbackPage";

const MessagingPage = lazy(() => import("@/pages/MessagingPage"));
const FeesPage = lazy(() => import("@/pages/FeesPage"));
const PolicyPage = lazy(() => import("@/pages/PolicyPage"));
const OrdersPage = lazy(() => import("@/pages/OrdersPage"));
const OperationsPage = lazy(() => import("@/pages/OperationsPage"));
const SafetyPage = lazy(() => import("@/pages/SafetyPage"));
const HeldDepositsPage = lazy(() => import("@/pages/HeldDepositsPage"));
const HomeGatePage = lazy(() => import("@/pages/HomeGatePage"));
const FlagsPage = lazy(() => import("@/pages/FlagsPage"));
const OnboardingPage = lazy(() => import("@/pages/OnboardingPage"));
const OnboardingBatchPage = lazy(() => import("@/pages/OnboardingBatchPage"));
const PartnerOnboardingPage = lazy(() => import("@/pages/PartnerOnboardingPage"));
const PartnerLeadsPage = lazy(() => import("@/pages/PartnerLeadsPage"));
const PartnerOnboardingDetailPage = lazy(() => import("@/pages/PartnerOnboardingDetailPage"));
const GrowthAnalyticsV1Page = lazy(() => import("@/pages/growth-analytics/GrowthAnalyticsPage"));
const AcquisitionPage = lazy(() => import("@/pages/growth-analytics/AcquisitionPage"));
// Growth & Patient Acquisition (GRW-P1-K)
const GrowthExecutivePage = lazy(() => import("@/pages/growth/GrowthExecutivePage"));
const GrowthChannelsPage = lazy(() => import("@/pages/growth/GrowthChannelsPage"));
const GrowthProvidersPage = lazy(() => import("@/pages/growth/GrowthProvidersPage"));
const GrowthPatientsPage = lazy(() => import("@/pages/growth/GrowthPatientsPage"));
const GrowthAttributionPage = lazy(() => import("@/pages/growth/GrowthAttributionPage"));
const GrowthSeoPage = lazy(() => import("@/pages/growth/GrowthSeoPage"));
const GrowthLandingPage = lazy(() => import("@/pages/growth/GrowthLandingPage"));
const GrowthWidgetsPage = lazy(() => import("@/pages/growth/GrowthWidgetsPage"));
const GrowthTemplatesPage = lazy(() => import("@/pages/growth/GrowthTemplatesPage"));
const GrowthFraudPage = lazy(() => import("@/pages/growth/GrowthFraudPage"));
const GrowthAnalyticsPage = lazy(() => import("@/pages/growth/GrowthAnalyticsPage"));
const GrowthFinancePage = lazy(() => import("@/pages/growth/GrowthFinancePage"));
const GrowthMarketsPage = lazy(() => import("@/pages/growth/GrowthMarketsPage"));
const GrowthIntegrationsPage = lazy(() => import("@/pages/growth/GrowthIntegrationsPage"));
const GrowthAuditPage = lazy(() => import("@/pages/growth/GrowthAuditPage"));
const GrowthConfigPage = lazy(() => import("@/pages/growth/GrowthConfigPage"));
const GrowthPlannedPage = lazy(() => import("@/pages/growth/GrowthPlannedPage"));

export const makeQueryClient = () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 } } });
const client = makeQueryClient();

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route element={<RequireOps><OpsLayout /></RequireOps>}>
          <Route index element={<Navigate to="/flags" replace />} />
          <Route path="providers" element={<ProvidersPage />} />
          <Route path="bookings" element={<BookingTimelinePage />} />
          <Route path="outbox" element={<OutboxPage />} />
          <Route path="finance" element={<FinancePage />} />
          <Route path="moderation" element={<ModerationPage />} />
          <Route path="liquidity" element={<LiquidityPage />} />
          <Route path="messaging" element={<MessagingPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="fees" element={<FeesPage />} />
          <Route path="policy" element={<PolicyPage />} />
          <Route path="operations" element={<OperationsPage />} />
          <Route path="safety" element={<SafetyPage />} />
          <Route path="held-deposits" element={<HeldDepositsPage />} />
          <Route path="home-gate" element={<HomeGatePage />} />
          <Route path="flags" element={<FlagsPage />} />
          <Route path="onboarding" element={<OnboardingPage />} />
          <Route path="onboarding/:id" element={<OnboardingBatchPage />} />
          <Route path="partner-onboarding" element={<PartnerOnboardingPage />} />
          <Route path="partner-onboarding/:id" element={<PartnerOnboardingDetailPage />} />
          <Route path="partner-leads" element={<PartnerLeadsPage />} />
          <Route path="growth-analytics" element={<GrowthAnalyticsV1Page />} />
          <Route path="acquisition" element={<AcquisitionPage />} />
          <Route path="growth" element={<GrowthExecutivePage />} />
          <Route path="growth/channels" element={<GrowthChannelsPage />} />
          <Route path="growth/providers" element={<GrowthProvidersPage />} />
          <Route path="growth/patients" element={<GrowthPatientsPage />} />
          <Route path="growth/attribution" element={<GrowthAttributionPage />} />
          <Route path="growth/seo" element={<GrowthSeoPage />} />
          <Route path="growth/landing-pages" element={<GrowthLandingPage />} />
          <Route path="growth/widgets" element={<GrowthWidgetsPage />} />
          <Route path="growth/templates" element={<GrowthTemplatesPage />} />
          <Route path="growth/fraud" element={<GrowthFraudPage />} />
          <Route path="growth/analytics" element={<GrowthAnalyticsPage />} />
          <Route path="growth/finance" element={<GrowthFinancePage />} />
          <Route path="growth/markets" element={<GrowthMarketsPage />} />
          <Route path="growth/integrations" element={<GrowthIntegrationsPage />} />
          <Route path="growth/audit" element={<GrowthAuditPage />} />
          <Route path="growth/config" element={<GrowthConfigPage />} />
          {(["campaigns", "referrals", "rewards", "promotions", "whatsapp", "lifecycle", "experiments"] as const).map((k) => <Route key={k} path={`growth/${k}`} element={<GrowthPlannedPage section={k} />} />)}
          <Route path="*" element={<Navigate to="/flags" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <AuthProvider><TooltipProvider><BrowserRouter><AppRoutes /></BrowserRouter><Toaster position="top-center" /></TooltipProvider></AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
