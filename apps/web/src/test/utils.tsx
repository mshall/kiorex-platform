import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext, type AuthCtx } from "@/auth/AuthProvider";
import { configureApi } from "@/api/client";
import { PatientProvider } from "@/hooks/usePatient";
import i18n from "@/i18n";

const testAuth: AuthCtx = { status: "signedIn", user: { sub: "test-patient-1", name: "Amira", token: "test-token", roles: ["patient"] }, login: async () => {}, logout: async () => {}, completeLogin: async () => "/" };
const AuthProvider = ({ children }: { children: ReactNode }) => { configureApi({ getToken: async () => "test-token" }); return <AuthContext.Provider value={testAuth}>{children}</AuthContext.Provider>; };

export function renderApp(ui: ReactElement, { route = "/", lang = "ar" }: { route?: string; lang?: "ar" | "en" } = {}) {
  void i18n.changeLanguage(lang);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider><PatientProvider><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></PatientProvider></AuthProvider>
    </QueryClientProvider>,
  );
}
