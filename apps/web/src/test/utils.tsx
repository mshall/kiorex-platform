import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/auth/AuthProvider";
import { PatientProvider } from "@/hooks/usePatient";
import i18n from "@/i18n";

export function renderApp(ui: ReactElement, { route = "/", lang = "ar" }: { route?: string; lang?: "ar" | "en" } = {}) {
  void i18n.changeLanguage(lang);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider><PatientProvider><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></PatientProvider></AuthProvider>
    </QueryClientProvider>,
  );
}
