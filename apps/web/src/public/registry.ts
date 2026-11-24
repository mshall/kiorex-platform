import type { ComponentType } from "react";
import type { PageData, PageMeta, PublicPageType, TemplateCtx } from "./types";

/**
 * Template registry (GRW-P1-E hook, GRW-P1-F fills it). A template is the React body, the metadata and the JSON-LD of one page type. E ships working
 * default templates for every type; F replaces them with `registerTemplate` (or by editing the files) without touching the server or the client entry.
 */
export interface PublicTemplate<D extends PageData = PageData> {
  /** Page types this template renders. */
  types: readonly PublicPageType[];
  Component: ComponentType<{ data: D; ctx: TemplateCtx }>;
  meta(data: D, ctx: TemplateCtx): PageMeta;
  /** One block per page, from the same data as the visible content. */
  jsonLd?(data: D, ctx: TemplateCtx): unknown[];
}

const templates = new Map<PublicPageType, PublicTemplate>();

export function registerTemplate<D extends PageData>(t: PublicTemplate<D>): void {
  for (const type of t.types) templates.set(type, t as unknown as PublicTemplate);
}
export const getTemplate = (type: PublicPageType): PublicTemplate | undefined => templates.get(type);
export const registeredTypes = (): PublicPageType[] => [...templates.keys()];
