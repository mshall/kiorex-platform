import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/i18n";
import "@/styles/index.css";
import App from "./App";
import { flushAnalytics, setAnalyticsSink } from "@/lib/analytics";
import { postAnalytics } from "@/api/services";
import { getMarket } from "@/lib/market";

// Client analytics: whitelisted, PHI-free batches to POST /analytics/events (KX-03 §07). Failures are swallowed on purpose.
setAnalyticsSink((batch) => { void postAnalytics(batch.map((e) => ({ name: e.name, props: { ...e.props, market: getMarket() } }))).catch(() => {}); });
window.addEventListener("pagehide", flushAnalytics);

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
