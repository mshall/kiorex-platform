import type { ReactElement } from "react";
import fs from "fs";
import path from "path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n";
import { ThemeProvider } from "@/theme";
import { ToastProvider } from "@/components/ui";

const mockReplace = jest.fn(); const mockLogout = jest.fn(async () => {}); const mockDisable = jest.fn(async (_id: unknown) => true);
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: mockReplace }) }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ logout: mockLogout }) }));
jest.mock("@/lib/push", () => ({ disablePush: (id: unknown) => mockDisable(id), pushEnabledLocally: async () => "dev_1" }));

import { SignOutSheet } from "@/components/SignOutSheet";

const wrap = (ui: ReactElement) => render(
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
    <QueryClientProvider client={new QueryClient()}><ThemeProvider><ToastProvider>{ui}</ToastProvider></ThemeProvider></QueryClientProvider></SafeAreaProvider>);

beforeEach(async () => { jest.clearAllMocks(); await act(async () => { await i18n.changeLanguage("en"); }); });

describe("sign-out sheet", () => {
  it("asks first, then removes the push registration, clears the session and returns to /sign-in", async () => {
    await wrap(<SignOutSheet visible onClose={jest.fn()} />);
    expect(mockLogout).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("signout-confirm-btn"));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/sign-in"));
    expect(mockDisable).toHaveBeenCalledWith("dev_1");
    expect(mockLogout).toHaveBeenCalled();
  });
  it("cancel signs nothing out; Arabic strings exist", async () => {
    const onClose = jest.fn();
    await wrap(<SignOutSheet visible onClose={onClose} />);
    await fireEvent.press(screen.getByTestId("signout-cancel"));
    expect(onClose).toHaveBeenCalled(); expect(mockLogout).not.toHaveBeenCalled();
    await act(async () => { await i18n.changeLanguage("ar"); });
    expect(i18n.t("signOutDlg.action")).toBe("تسجيل الخروج");
  });
});

describe("navigation structure", () => {
  const app = path.join(__dirname, "../../app");
  it("pushed screens live inside (tabs)/(more) so the tab bar persists; checkout and the call stay full-screen", () => {
    for (const f of ["appointment", "care-plans", "doctor", "lab", "pharmacy", "records", "safety", "settings", "results.tsx", "waitlist.tsx", "review", "family-share", "telemedicine/index.tsx"]) {
      expect(fs.existsSync(path.join(app, "(tabs)/(more)", f))).toBe(true);
    }
    expect(fs.existsSync(path.join(app, "checkout/[id].tsx"))).toBe(true);
    expect(fs.existsSync(path.join(app, "telemedicine/room/[id].tsx"))).toBe(true);
    expect(fs.readFileSync(path.join(app, "(tabs)/_layout.tsx"), "utf8")).toMatch(/name="\(more\)" options=\{\{[^}]*tabBarButton: \(\) => null/);
  });
});
