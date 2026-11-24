import { formatDayLong, formatMinor } from "@/lib/format";
import type { Locale } from "./types";

/** Money (integer minor units) and dates for public pages. The Intl output can differ by ICU build, so the elements that use it carry suppressHydrationWarning. */
export const money = (minor: number, locale: Locale, currency = "EGP"): string => formatMinor(minor, locale, currency);
export const day = (iso: string, locale: Locale): string => formatDayLong(iso, locale);
