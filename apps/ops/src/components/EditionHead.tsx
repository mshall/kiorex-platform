import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { isKiorly } from "@/lib/edition";

/** Kiorly admin: tab title, description, icon and non-indexing. (The Kiorex edition keeps the static tags of index.html.) The console is behind sign-in and never indexable in either edition. */
export function EditionHead() {
  const { t } = useTranslation();
  useEffect(() => {
    if (!isKiorly) return;
    document.title = t("edition.kiorlyTitle");
    const set = (sel: string, make: () => HTMLElement, attr: string, value: string) => { let el = document.head.querySelector<HTMLElement>(sel); if (!el) { el = make(); document.head.appendChild(el); } el.setAttribute(attr, value); };
    document.head.querySelector('meta[name="description"]')?.setAttribute("content", t("edition.kiorlyDescription"));
    document.head.querySelectorAll('link[rel="icon"], link[rel="alternate icon"], link[rel="apple-touch-icon"], link[rel="manifest"]').forEach((l) => l.remove());
    set('link[rel="icon"]', () => Object.assign(document.createElement("link"), { rel: "icon", type: "image/svg+xml" }), "href", "/kiorly/favicon.svg");
    set('meta[name="robots"]', () => Object.assign(document.createElement("meta"), { name: "robots" }), "content", "noindex,nofollow");
    document.head.querySelector('meta[property="og:site_name"]')?.setAttribute("content", "Kiorly");
  }, [t]);
  return null;
}
