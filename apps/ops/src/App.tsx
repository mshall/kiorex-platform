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

const FlagsPage = lazy(() => import("@/pages/FlagsPage"));

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
          <Route path="flags" element={<FlagsPage />} />
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
