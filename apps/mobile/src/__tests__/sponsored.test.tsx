import type { ReactElement } from "react";
import { act, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import i18n from "@/i18n";
import { ThemeProvider } from "@/theme";
import { SponsoredDiscountLine } from "@/modules/sponsored/SponsoredDiscountLine";
import { depositAfterSponsored, type SponsoredQuote } from "@/modules/sponsored/api";
import en from "@/i18n/locales/en.json";
import ar from "@/i18n/locales/ar.json";

/** GRW-P2-S on the patient app: the sponsored line says "sponsored by <clinic> until <date>", never a Kiorex discount; AR and EN; one accessible group. */
const setLang = (l: string) => act(async () => { await i18n.changeLanguage(l); });
const wrap = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 320, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><ThemeProvider>{ui}</ThemeProvider></SafeAreaProvider>);
const quote: SponsoredQuote = { promotionId: "prm_1", amountMinor: 10_000, currency: "EGP", endsAt: "2027-02-10T21:59:00.000Z", label: { ar: "خصم برعاية عيادة النيل حتى 2027-02-10", en: "Discount sponsored by Nile Clinic until 2027-02-10" }, sponsor: { ar: "عيادة النيل", en: "Nile Clinic" } };
afterEach(async () => { await setLang("ar"); });

describe("sponsored discount line", () => {
  it("English: label with clinic and date, the minus amount as a left-to-right island, a note that it is not a Kiorex discount, one accessible element", async () => {
    await setLang("en"); await wrap(<SponsoredDiscountLine quote={quote} />);
    expect(screen.getByTestId("sponsored-label").props.children).toBe("Discount sponsored by Nile Clinic until 2027-02-10");
    expect(screen.getByTestId("sponsored-amount").props.style).toEqual(expect.arrayContaining([expect.objectContaining({ writingDirection: "ltr" })]));
    expect(String(screen.getByTestId("sponsored-amount").props.children)).toMatch(/^−/);
    expect(String(screen.getByTestId("sponsored-note").props.children)).toMatch(/not a Kiorex discount/);
    const g = screen.getByTestId("sponsored-line"); expect(g.props.accessible).toBe(true); expect(g.props.accessibilityLabel).toMatch(/Nile Clinic.*minus/s);
  });
  it("Arabic: the Arabic label and note", async () => {
    await setLang("ar"); await wrap(<SponsoredDiscountLine quote={quote} />);
    expect(screen.getByTestId("sponsored-label").props.children).toBe("خصم برعاية عيادة النيل حتى 2027-02-10");
    expect(String(screen.getByTestId("sponsored-note").props.children)).toContain("ليس خصمًا من كيوركس");
  });
  it("falls back to the built label when the server label is empty", async () => {
    await setLang("en"); await wrap(<SponsoredDiscountLine quote={{ ...quote, label: { ar: "", en: "" } }} />);
    expect(screen.getByTestId("sponsored-label").props.children).toBe("Discount sponsored by Nile Clinic until 2027-02-10");
  });
  it("English and Arabic carry the same keys; the deposit never goes below one minor unit", () => {
    expect(Object.keys((en as any).sponsored).sort()).toEqual(Object.keys((ar as any).sponsored).sort());
    expect(depositAfterSponsored(15_000, 5_000)).toBe(100); expect(depositAfterSponsored(5_000, 9_000)).toBe(0.01); expect(depositAfterSponsored(15_000, 0)).toBe(150);
  });
});
