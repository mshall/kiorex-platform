import { act, renderHook } from "@testing-library/react-native";
import { useCountdown } from "@/hooks/useCountdown";
import { formatCountdown } from "@/lib/format";

describe("hold countdown (5-minute hold, KXMBK02)", () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2030-01-01T10:00:00Z")); });
  afterEach(() => jest.useRealTimers());

  it("counts down every second and flags expiry", async () => {
    const hold = new Date(Date.now() + 5 * 60_000).toISOString();
    const { result } = await renderHook(() => useCountdown(hold));
    expect(result.current.remainingMs).toBe(300_000);
    expect(formatCountdown(result.current.remainingMs!)).toBe("05:00");
    await act(async () => { jest.advanceTimersByTime(1000 * 61); });
    expect(formatCountdown(result.current.remainingMs!)).toBe("03:59");
    expect(result.current.expired).toBe(false);
    await act(async () => { jest.advanceTimersByTime(1000 * 240); });
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.expired).toBe(true);
  });
  it("is inert without a deadline", async () => {
    const { result } = await renderHook(() => useCountdown(null));
    expect(result.current).toEqual({ remainingMs: null, expired: false });
  });
  it("never goes negative for a past deadline", async () => {
    const { result } = await renderHook(() => useCountdown(new Date(Date.now() - 10_000).toISOString()));
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.expired).toBe(true);
  });
  it("formats mm:ss", () => { expect(formatCountdown(9_000)).toBe("00:09"); expect(formatCountdown(-5)).toBe("00:00"); });
});
