import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import MessagingChannelsPage from "@/pages/MessagingChannelsPage";
import channelsI18n from "@/i18n/messaging.channels.json";

const C = "/api/v1/admin/messaging/channels";
const row = (o: Record<string, unknown> = {}) => ({ channel: "WHATSAPP", mode: "real", enabled: true, senderId: "106540352242922", providers: [{ provider: "meta", problems: [], secretRef: "/kiorex/prod/whatsapp_token", secretRefPresent: true }], ready: true, webhook: "https://api.kiorex.test/api/v1/messaging/webhooks/whatsapp", ...o });
const status = (channels: unknown[]) => HttpResponse.json({ market: "EG", publicBaseUrl: "https://api.kiorex.test", failoverOrder: { TRANSACTIONAL: ["WHATSAPP", "SMS", "EMAIL"], MARKETING: [] }, channels, testAllowListSize: 2 });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);

describe("messaging channels i18n", () => {
  it("English and Arabic carry the same keys", () => {
    expect(flat(channelsI18n.en).sort()).toEqual(flat(channelsI18n.ar).sort());
  });
});

describe("Messaging channels page (MSG-REAL)", () => {
  const base = () => [http.get(`${C}/whatsapp/templates`, () => HttpResponse.json([{ key: "BOOKING_CONFIRMED", language: "ar", metaName: "kx_booking_confirmed_v1", category: "UTILITY", status: "APPROVED", quality: null, reason: null, enabled: true }]))];
  it("shows readiness with the missing VARIABLE NAMES, and never a secret value", async () => {
    server.use(...base(), http.get(C, () => status([row(), row({ channel: "SMS", ready: false, senderId: null, providers: [{ provider: "twilio", problems: ["SMS_API_URL is required when SMS_MODE=real"], secretRef: null, secretRefPresent: null }] })])));
    renderOps(<MessagingChannelsPage />, { route: "/messaging/channels" });
    expect(await screen.findByTestId("channel-WHATSAPP")).toBeInTheDocument();
    expect(await screen.findByText("SMS_API_URL is required when SMS_MODE=real")).toBeInTheDocument();
    expect(screen.getByTestId("channels-order")).toHaveTextContent("TRANSACTIONAL: WHATSAPP > SMS > EMAIL");
    expect(document.body.textContent).not.toMatch(/EAAG|secret_value/);
  });
  it("opens a channel: masked verify token until reveal, test send reports the result, connection check lists each check", async () => {
    let revealed = false;
    server.use(...base(),
      http.get(C, () => status([row()])),
      http.get(`${C}/whatsapp/webhook`, () => HttpResponse.json({ channel: "WHATSAPP", callbackUrl: "https://api.kiorex.test/api/v1/messaging/webhooks/whatsapp", verifyToken: "ve****23", verifyTokenSet: true, subscribeFields: ["messages"], steps: ["Paste the URL"] })),
      http.post(`${C}/whatsapp/webhook/reveal`, () => { revealed = true; return HttpResponse.json({ channel: "WHATSAPP", callbackUrl: "https://api.kiorex.test/api/v1/messaging/webhooks/whatsapp", verifyToken: "verify_me_123", verifyTokenSet: true, steps: [] }); }),
      http.post(`${C}/whatsapp/test-send`, async ({ request }) => { expect(await request.json()).toEqual({ to: "+201112223334" }); return HttpResponse.json({ ok: true, status: "SENT", mode: "real", error: null }); }),
      http.post(`${C}/whatsapp/connection-check`, () => HttpResponse.json({ channel: "WHATSAPP", mode: "real", ok: false, checks: [{ name: "phone number", ok: true, detail: "+1 555 (Kiorex), quality GREEN" }, { name: "webhook subscription", ok: false, detail: "no app is subscribed" }] })));
    renderOps(<MessagingChannelsPage />, { route: "/messaging/channels" });
    await userEvent.click(await screen.findByTestId("channel-WHATSAPP"));
    expect(await screen.findByTestId("verify-token")).toHaveTextContent("ve****23");
    await userEvent.click(screen.getByTestId("reveal")); await waitFor(() => expect(screen.getByTestId("verify-token")).toHaveTextContent("verify_me_123")); expect(revealed).toBe(true);
    await userEvent.type(screen.getByTestId("test-to"), "+201112223334"); await userEvent.click(screen.getByTestId("test-send"));
    await userEvent.click(screen.getByTestId("connection-check"));
    const res = await screen.findByTestId("check-results"); expect(res).toHaveTextContent("phone number"); expect(res).toHaveTextContent("no app is subscribed");
  });
});
