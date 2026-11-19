import { CLIENT_EVENTS, flushAnalytics, mapKeywordToSpecialty, sanitize, setAnalyticsSink, track } from "@/lib/analytics";

describe("privacy-safe analytics (KX-03 §07) — mirrors the API whitelist", () => {
  it("drops non-whitelisted keys (no symptoms / free text / ids of people)", () => {
    expect(sanitize({ specialtyCode: "cardiology", symptom: "chest pain", query: "my diagnosis", bookingId: "b1", rating: 5 })).toEqual({ specialtyCode: "cardiology" });
  });
  it("drops values the API would reject (whole batch is all-or-nothing server-side)", () => {
    expect(sanitize({ code: "x".repeat(80), providerId: "has space", market: "egypt", specialtyCode: "other" })).toEqual({});
    expect(sanitize({ code: "SLOT_TAKEN", providerId: "kx_prov-1", market: "EG" })).toEqual({ code: "SLOT_TAKEN", providerId: "kx_prov-1", market: "EG" });
  });
  it("maps keywords to specialty codes and never returns raw text", () => {
    expect(mapKeywordToSpecialty("طبيب أسنان")).toBe("dentistry");
    expect(mapKeywordToSpecialty("باطنة")).toBe("internal_medicine");
    expect(mapKeywordToSpecialty("my knee hurts after a fall")).toBeNull();
  });
  it("only the server's event names exist", () => expect(CLIENT_EVENTS).toContain("waitlist_joined"));
  it("batches events with sanitized props and drops unknown event names", () => {
    const sink = jest.fn();
    setAnalyticsSink(sink);
    track("search_started", { specialtyCode: "dentistry", note: "free text" } as never);
    track("hold_created" as never);
    flushAnalytics();
    const [batch] = sink.mock.calls[0];
    expect(batch).toEqual([{ name: "search_started", props: { specialtyCode: "dentistry" } }]);
    setAnalyticsSink(null);
  });
  it("never throws if the sink does", () => {
    setAnalyticsSink(() => { throw new Error("boom"); });
    track("results_viewed");
    expect(() => flushAnalytics()).not.toThrow();
    setAnalyticsSink(null);
  });
});
