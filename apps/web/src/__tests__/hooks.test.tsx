import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePagination } from "@/hooks/usePagination";
import { useCountdown } from "@/hooks/useCountdown";

describe("usePagination", () => {
  it("pages and clamps", () => {
    const { result } = renderHook(() => usePagination({ data: [1, 2, 3, 4, 5, 6, 7], initialItemsPerPage: 3 }));
    expect(result.current.paginatedData).toEqual([1, 2, 3]); expect(result.current.totalPages).toBe(3);
    act(() => result.current.nextPage()); expect(result.current.paginatedData).toEqual([4, 5, 6]);
    act(() => result.current.goToPage(99)); expect(result.current.currentPage).toBe(3); expect(result.current.canGoNext).toBe(false);
  });
});

describe("useCountdown (5-min hold)", () => {
  it("counts down and expires", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-12-01T10:00:00Z"));
    const { result } = renderHook(() => useCountdown("2026-12-01T10:05:00Z"));
    expect(result.current.remainingMs).toBe(300_000);
    act(() => { vi.advanceTimersByTime(299_000); }); expect(result.current.expired).toBe(false);
    act(() => { vi.advanceTimersByTime(2_000); }); expect(result.current.expired).toBe(true); expect(result.current.remainingMs).toBe(0);
    vi.useRealTimers();
  });
  it("is inert without a deadline", () => { const { result } = renderHook(() => useCountdown(null)); expect(result.current.remainingMs).toBeNull(); });
});
