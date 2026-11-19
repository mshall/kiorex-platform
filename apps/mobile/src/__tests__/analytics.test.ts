import { flushAnalytics, mapKeywordToSpecialty, sanitize, setAnalyticsSink, track } from "@/lib/analytics";

describe("privacy-safe analytics (KX-03 §07)", () => {
  it("drops non-whitelisted keys (no symptoms / free text)", () => {
    expect(sanitize({ specialty: "cardiology", symptom: "chest pain", query: "my diagnosis", resultCount: 3 })).toEqual({ specialty: "cardiology", resultCount: 3 });
  });
  it("drops long strings even under an allowed key", () => expect(sanitize({ code: "x".repeat(80) })).toEqual({}));
  it("maps keywords to specialty codes and never returns raw text", () => {
    expect(mapKeywordToSpecialty("طبيب أسنان")).toBe("dentistry");
    expect(mapKeywordToSpecialty("my knee hurts after a fall")).toBe("other");
  });
  it("batches events with a mobile platform tag and sanitized props", () => {
    const sink = jest.fn();
    setAnalyticsSink(sink);
    track("search_started", { specialty: "dentistry", note: "free text" } as never);
    flushAnalytics();
    expect(sink).toHaveBeenCalledTimes(1);
    const [batch] = sink.mock.calls[0];
    expect(batch[0].name).toBe("search_started");
    expect(batch[0].props).toEqual({ platform: "mobile", specialty: "dentistry" });
    setAnalyticsSink(null);
  });
  it("never throws if the sink does", () => {
    setAnalyticsSink(() => { throw new Error("boom"); });
    track("results_viewed", { resultCount: 1 });
    expect(() => flushAnalytics()).not.toThrow();
    setAnalyticsSink(null);
  });
});
