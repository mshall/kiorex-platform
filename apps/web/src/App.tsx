import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RequireAuth } from "@/auth/RequireAuth";
import { MOCK_MODE } from "@/auth/oidc";
import { PatientProvider } from "@/hooks/usePatient";
import { AppLayout } from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LoadingState } from "@/components/states";
import { ApiError } from "@/api/errors";
import LandingPage from "@/pages/LandingPage";
import HomePage from "@/pages/HomePage";
import ResultsPage from "@/pages/ResultsPage";
import DoctorProfilePage from "@/pages/DoctorProfilePage";
import NotFoundPage from "@/pages/NotFoundPage";
import AuthCallbackPage from "@/pages/AuthCallbackPage";

const CheckoutPage = lazy(() => import("@/pages/CheckoutPage"));
const AppointmentsPage = lazy(() => import("@/pages/AppointmentsPage"));
const AppointmentPage = lazy(() => import("@/pages/AppointmentPage"));
const ReviewPage = lazy(() => import("@/pages/ReviewPage"));
const AccountPage = lazy(() => import("@/pages/AccountPage"));
const MockCheckoutPage = lazy(() => import("@/pages/MockCheckoutPage"));

export const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      },
    },
  });

function Root() {
  const { status } = useAuth();
  if (status === "loading") return <LoadingState />;
  return status === "signedIn" ? <HomePage /> : <LandingPage />;
}

const guard = (el: JSX.Element) => <RequireAuth>{el}</RequireAuth>;

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route element={<AppLayout />}>
          <Route index element={<Root />} />
          <Route path="search" element={<ResultsPage />} />
          <Route path="doctors/:id" element={<DoctorProfilePage />} />
          <Route path="checkout/:bookingId" element={guard(<CheckoutPage />)} />
          <Route path="appointments" element={guard(<AppointmentsPage />)} />
          <Route path="appointments/:id" element={guard(<AppointmentPage />)} />
          <Route path="appointments/:id/review" element={guard(<ReviewPage />)} />
          <Route path="account" element={guard(<AccountPage />)} />
          {MOCK_MODE && <Route path="mock-checkout" element={<MockCheckoutPage />} />}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

const client = makeQueryClient();

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <PatientProvider>
            <TooltipProvider>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
              <Toaster position="top-center" dir="auto" />
            </TooltipProvider>
          </PatientProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
