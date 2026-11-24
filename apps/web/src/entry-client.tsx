import { hydrateRoot } from "react-dom/client";
import { createElement } from "react";
import "./public/public.css";
import { PublicApp } from "./public/PublicApp";
import type { PublicState } from "./public/types";

/** Hydrates the server-rendered public page from the JSON state the server embedded (type application/json: CSP-safe, no inline script). */
const el = document.getElementById("kx-public-state");
const root = document.getElementById("root");
if (el?.textContent && root) {
  const state = JSON.parse(el.textContent) as PublicState;
  hydrateRoot(root, createElement(PublicApp, { state }));
}
