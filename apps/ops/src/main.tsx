import "@/lib/western-digits"; // Western digits 0-9 by default in Arabic (founder decision 28 Nov 2026)
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/i18n";
import "@/styles/index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
