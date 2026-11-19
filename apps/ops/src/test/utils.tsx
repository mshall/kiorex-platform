import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext, type AuthCtx } from "@/auth/AuthProvider";
import { configureApi } from "@/api/client";
import i18n from "@/i18n";
import { Toaster } from "@/components/ui/sonner";

const testAuth: AuthCtx = { status: "signedIn", user: { sub: "test-ops-1", name: "Ops Admin", token: "test-token", roles: ["ops_admin", "super_admin"] }, login: async () => {}, logout: async () => {}, completeLogin: async () => "/" };
const AuthProvider = ({ children }: { children: ReactNode }) => { configureApi({ getToken: async () => "test-token" }); return <AuthContext.Provider value={testAuth}>{children}</AuthContext.Provider>; };

export function renderOps(ui: ReactElement, { route = "/", lang = "en" }: { route?: string; lang?: "ar" | "en" } = {}) {
  void i18n.changeLanguage(lang);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AuthProvider><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter><Toaster /></AuthProvider></QueryClientProvider>);
}
