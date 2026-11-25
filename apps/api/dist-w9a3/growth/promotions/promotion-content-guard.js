"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bothLanguages = exports.GUARD_LIST_VERSION = void 0;
exports.normalise = normalise;
exports.guardTexts = guardTexts;
exports.GUARD_LIST_VERSION = "PLACEHOLDER-2026-11";
function normalise(s) {
    return s.normalize("NFKC").toLowerCase()
        .replace(/[ً-ٰٟـ]/g, "")
        .replace(/[آأإ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
        .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(/\s+/g, " ").trim();
}
const n = normalise;
const CLINICAL_EN = ["treatment", "treat ", "cure", "heal", "therapy", "diagnos", "surgery", "surgical", "operation", "procedure", "prescription", "medicine", "medication", "drug", "vaccine", "injection", "x-ray", "xray", "mri", "ct scan", "ultrasound", "blood test", "lab test", "analysis", "cancer", "diabetes", "pregnan", "ivf", "fertility", "implant", "botox", "filler", "laser", "weight loss", "slimming", "symptom", "disease", "infection", "pain relief", "chemo", "dialysis"];
const CLINICAL_AR = ["علاج", "يعالج", "شفاء", "نشفي", "تشخيص", "عمليه", "عمليات", "جراحه", "جراحي", "اجراء", "روشته", "دواء", "ادويه", "تطعيم", "حقن", "اشعه", "رنين", "اشعة", "سونار", "تحليل", "تحاليل", "سرطان", "سكر", "حمل", "تلقيح", "عقم", "زراعه", "بوتوكس", "فيلر", "ليزر", "تخسيس", "نحافه", "اعراض", "مرض", "عدوي", "غسيل كلي"];
const SUPERLATIVE_EN = ["best doctor", "best clinic", "number one", "no. 1", "#1", "guaranteed", "100%", "100 percent", "miracle", "perfect result", "risk free", "risk-free", "no side effect", "painless", "instant result", "permanent result", "proven"];
const SUPERLATIVE_AR = ["افضل دكتور", "افضل طبيب", "افضل عياده", "الاول في", "رقم واحد", "رقم 1", "مضمون", "ضمان", "نتيجه مضمونه", "معجزه", "بدون الم", "بدون اعراض جانبيه", "نتيجه فوريه", "نتيجه دائمه", "مثبت"];
const FREE_EN = ["free"];
const FREE_AR = ["مجان", "ببلاش", "بلا مقابل"];
const URGENCY_EN = ["last chance", "hurry", "act now", "today only", "limited time"];
const URGENCY_AR = ["اخر فرصه", "اسرع", "لفتره محدوده", "اليوم فقط"];
const has = (hay, term) => { const t = n(term); if (t.length > 4)
    return hay.includes(t); return new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "u").test(hay); };
const find = (hay, terms) => terms.filter((t) => has(hay, t));
function guardTexts(texts) {
    const hits = [];
    const add = (hay, lang, terms, rule, severity) => { for (const term of find(hay, terms))
        hits.push({ rule, term: term.trim(), severity, lang }); };
    const en = n(`${texts.nameEn} ${texts.patientCopyEn}`);
    const ar = n(`${texts.nameAr} ${texts.patientCopyAr}`);
    add(en, "en", CLINICAL_EN, "CLINICAL_CLAIM", "BLOCK");
    add(ar, "ar", CLINICAL_AR, "CLINICAL_CLAIM", "BLOCK");
    add(en, "en", SUPERLATIVE_EN, "OUTCOME_SUPERLATIVE", "BLOCK");
    add(ar, "ar", SUPERLATIVE_AR, "OUTCOME_SUPERLATIVE", "BLOCK");
    const freeEn = find(en, FREE_EN).length > 0, freeAr = find(ar, FREE_AR).length > 0;
    if (freeEn && hits.some((h) => h.lang === "en" && h.rule === "CLINICAL_CLAIM"))
        hits.push({ rule: "FREE_TREATMENT", term: "free + clinical wording", severity: "BLOCK", lang: "en" });
    else if (freeEn)
        hits.push({ rule: "WARN_FREE", term: "free", severity: "WARN", lang: "en" });
    if (freeAr && hits.some((h) => h.lang === "ar" && h.rule === "CLINICAL_CLAIM"))
        hits.push({ rule: "FREE_TREATMENT", term: "مجاني + كلمات علاجية", severity: "BLOCK", lang: "ar" });
    else if (freeAr)
        hits.push({ rule: "WARN_FREE", term: "مجاني", severity: "WARN", lang: "ar" });
    add(en, "en", URGENCY_EN, "WARN_URGENCY", "WARN");
    add(ar, "ar", URGENCY_AR, "WARN_URGENCY", "WARN");
    const blocked = hits.some((h) => h.severity === "BLOCK");
    const inducement = hits.some((h) => h.rule === "CLINICAL_CLAIM" || h.rule === "FREE_TREATMENT");
    return { ok: !blocked, hits, signal: inducement ? "PF_CLINICAL_INDUCEMENT" : null, listVersion: exports.GUARD_LIST_VERSION };
}
const bothLanguages = (t) => [t.nameEn, t.nameAr, t.patientCopyEn, t.patientCopyAr].every((x) => x.trim().length > 0);
exports.bothLanguages = bothLanguages;
//# sourceMappingURL=promotion-content-guard.js.map