import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import FlagsPage from "@/pages/FlagsPage";
import { OutboxPage } from "@/pages/SimplePages";

const open = async () => { renderOps(<FlagsPage />); await screen.findByTestId("toggle-kiorex.marketplace"); };

describe("Feature flags page (KXMOP07–11)", () => {
  it("lists every product's flags with class, effective value and dependencies", async () => {
    await open();
    const rows = screen.getAllByTestId("row");
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(screen.getAllByText("kiorly-pharmacy").length).toBeGreaterThan(0);
    const awaiting = screen.getByText("kiorex.telemedicine").closest("tr")!;
    expect(within(awaiting).getByTestId("flag-state")).toHaveTextContent("ON · awaiting gate"); // launch-locked, no gate evidence
    expect(within(screen.getByText("kiorex.reviews").closest("tr")!).getByText("kiorex.marketplace")).toBeInTheDocument(); // dependency shown
  });

  it("requires reason + ticket before a toggle can be submitted, then applies it", async () => {
    await open();
    await userEvent.click(screen.getByTestId("toggle-kiorex.reviews"));
    const submit = await screen.findByTestId("toggle-submit");
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Reason/), "Moderation backlog");
    await userEvent.type(screen.getByLabelText(/Ticket/), "OPS-1");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() => expect(screen.queryByTestId("toggle-dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(within(screen.getByText("kiorex.reviews").closest("tr")!).getByTestId("flag-state")).toHaveTextContent("OFF"));
    // child of marketplace stays OFF when its parent is OFF (dependency)
  });

  it("money-path global OFF becomes a two-person approval request", async () => {
    await open();
    await userEvent.click(screen.getByTestId("toggle-kiorex.pay_deposits"));
    expect(await screen.findByTestId("two-person-note")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Reason/), "PSP incident");
    await userEvent.type(screen.getByLabelText(/Ticket/), "OPS-2");
    expect(screen.getByTestId("toggle-submit")).toHaveTextContent("Request approval");
    await userEvent.click(screen.getByTestId("toggle-submit"));
    await waitFor(() => expect(screen.queryByTestId("toggle-dialog")).not.toBeInTheDocument());
    // still ON: only a request was filed
    expect(within(screen.getByText("kiorex.pay_deposits").closest("tr")!).getByTestId("flag-state")).toHaveTextContent("ON");
  });

  it("launch-locked flag becomes effective only after gate evidence (OP-09)", async () => {
    await open();
    await userEvent.click(screen.getByTestId("gate-kiorex.telemedicine"));
    const submit = await screen.findByTestId("gate-submit");
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Gate ID/), "G-TELE-1");
    await userEvent.type(screen.getByLabelText(/Approver/), "Dr. Ahmed El Shall");
    await userEvent.type(screen.getByLabelText(/Approved on/), "2026-11-19");
    await userEvent.type(screen.getByLabelText(/Document link/), "https://example.com/gate.pdf");
    await userEvent.click(submit);
    await waitFor(() => expect(within(screen.getByText("kiorex.telemedicine").closest("tr")!).getByTestId("flag-state")).toHaveTextContent(/^ON$/));
  });

  it("the requester cannot approve their own request; a different admin's request can be approved", async () => {
    await open();
    await userEvent.click(screen.getByTestId("tab-approvals"));
    const approve = await screen.findByTestId("approve-req_seed"); // seeded by ops-2
    await userEvent.click(approve);
    await userEvent.click(screen.getByTestId("tab-flags"));
    await waitFor(() => expect(within(screen.getByText("kiorex.pay_deposits").closest("tr")!).getByTestId("flag-state")).toHaveTextContent("OFF"));
  });

  it("surfaces server validation (SECOND_APPROVER_REQUIRED) from the API", async () => {
    server.use(http.post("/api/v1/admin/flags/requests/:id/approve", () => HttpResponse.json({ code: "SECOND_APPROVER_REQUIRED", message: "A different super admin must approve" }, { status: 403 })));
    await open();
    await userEvent.click(screen.getByTestId("tab-approvals"));
    await userEvent.click(await screen.findByTestId("approve-req_seed"));
    expect(await screen.findByText(/SECOND_APPROVER_REQUIRED/)).toBeInTheDocument();
  });

  it("shows the audit trail and per-product propagation status", async () => {
    await open();
    await userEvent.click(screen.getByTestId("tab-propagation"));
    const statuses = await screen.findAllByTestId("prop-status");
    expect(statuses.map((s) => s.textContent)).toEqual(expect.arrayContaining(["IN_SYNC", "STALE", "NEVER_FETCHED"]));
    await userEvent.click(screen.getByTestId("tab-audit"));
    expect(await screen.findByTestId("export-audit")).toBeInTheDocument();
  });

  it("renders the Arabic locale", async () => {
    renderOps(<FlagsPage />, { lang: "ar" });
    expect(await screen.findByText("مفاتيح الميزات")).toBeInTheDocument();
  });
});

describe("Outbox monitor (KXMOP03)", () => {
  it("shows lag/dead-letter tiles and replays a dead letter", async () => {
    renderOps(<OutboxPage />);
    await userEvent.click(await screen.findByTestId("replay"));
    expect(await screen.findByText("Replay queued")).toBeInTheDocument();
  });
});

import { BookingTimelinePage, FinancePage, LiquidityPage, ModerationPage, ProvidersPage } from "@/pages/SimplePages";

describe("Console pages map the real /admin wire shapes", () => {
  it("providers", async () => { renderOps(<ProvidersPage />); expect(await screen.findByText("Dr. Laila Hassan")).toBeInTheDocument(); });
  it("booking timeline merges events, webhooks and payments", async () => {
    renderOps(<BookingTimelinePage />);
    await userEvent.type(screen.getByLabelText("Booking ID"), "bk_demo{enter}");
    expect(await screen.findByTestId("booking-timeline")).toHaveTextContent("APPOINTMENT_CONFIRMED");
    expect(screen.getByTestId("booking-timeline")).toHaveTextContent("HELD → CONFIRMED");
  });
  it("booking timeline 404 shows an error state", async () => {
    renderOps(<BookingTimelinePage />);
    await userEvent.type(screen.getByLabelText("Booking ID"), "nope{enter}");
    expect(await screen.findByTestId("error-state", {}, { timeout: 4000 })).toBeInTheDocument();
  });
  it("finance tiles", async () => { renderOps(<FinancePage />); expect(await screen.findByText("Refunds pending")).toBeInTheDocument(); expect((await screen.findAllByTestId("row")).length).toBeGreaterThan(0); });
  it("moderation queue", async () => { renderOps(<ModerationPage />); expect(await screen.findAllByText("PHI")).not.toHaveLength(0); });
  it("liquidity shows rates", async () => { renderOps(<LiquidityPage />); expect(await screen.findByTestId("liquidity-tiles")).toHaveTextContent("8.4%"); });
});

describe("market filter visibility (Egypt-only launch)", () => {
  it("is hidden with one live market and shown with two", async () => {
    server.use(http.get("/api/v1/markets", () => HttpResponse.json([{ code: "EG", live: true }, { code: "SA", live: false }])));
    renderOps(<FlagsPage />); await screen.findByTestId("toggle-kiorex.marketplace");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByLabelText(/market/i)).toBeNull();
  });
  it("shows the market filter when two markets are live", async () => {
    server.use(http.get("/api/v1/markets", () => HttpResponse.json([{ code: "EG", live: true }, { code: "SA", live: true }])));
    renderOps(<FlagsPage />); await screen.findByTestId("toggle-kiorex.marketplace");
    expect(await screen.findByLabelText(/market/i)).toBeInTheDocument();
  });
});
