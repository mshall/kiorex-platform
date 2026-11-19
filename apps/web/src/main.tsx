import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/i18n";
import "@/styles/index.css";
import App from "./App";
import { MOCK_MODE } from "@/auth/oidc";

async function boot() {
  if (MOCK_MODE) {
    const { worker } = await import("@/mocks/browser");
    try { await worker.start({ onUnhandledRequest: "bypass", quiet: true }); } catch (e) { console.error("MSW failed to start", e); }
  }
  createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
}
void boot();
