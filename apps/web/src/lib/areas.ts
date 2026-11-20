/** Search areas offered in the hero search and the filters sheet (free-text `area` on the search API). */
export const AREAS = ["Nasr City", "Mohandessin", "Fifth Settlement", "Maadi", "Heliopolis", "Dokki"];
export const areaAr: Record<string, string> = { "Nasr City": "مدينة نصر", Mohandessin: "المهندسين", "Fifth Settlement": "التجمع الخامس", Maadi: "المعادي", Heliopolis: "مصر الجديدة", Dokki: "الدقي" };
export const areaLabel = (a: string, lang: string) => (lang.startsWith("ar") ? areaAr[a] ?? a : a);
