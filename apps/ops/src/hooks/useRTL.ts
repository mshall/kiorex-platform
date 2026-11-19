import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";

export const useRTL = () => {
  const { i18n } = useTranslation();
  const rtl = isRTL(i18n.language);
  return { isRTL: rtl, dir: rtl ? ("rtl" as const) : ("ltr" as const), lang: rtl ? ("ar" as const) : ("en" as const) };
};
