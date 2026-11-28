import "@/lib/western-digits"; // Western digits 0-9 by default in Arabic (founder decision 28 Nov 2026)
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
