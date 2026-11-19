import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/auth/AuthProvider";
import i18n from "@/i18n";
import { Toaster } from "@/components/ui/sonner";

export function renderOps(ui: ReactElement, { route = "/", lang = "en" }: { route?: string; lang?: "ar" | "en" } = {}) {
  void i18n.changeLanguage(lang);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AuthProvider><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter><Toaster /></AuthProvider></QueryClientProvider>);
}
