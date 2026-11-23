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
