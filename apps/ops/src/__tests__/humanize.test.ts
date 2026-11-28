import { describe, expect, it } from "vitest";
import { humanizeCode } from "@/lib/format";

describe("humanizeCode", () => {
  it("turns machine codes into words", () => {
    expect(humanizeCode("internal_medicine")).toBe("Internal medicine");
    expect(humanizeCode("ent")).toBe("ENT");
    expect(humanizeCode("obgyn")).toBe("Obgyn");
  });
  it("keeps prose, empty and non-code values", () => {
    expect(humanizeCode("Cardiology")).toBe("Cardiology");
    expect(humanizeCode("طب الأطفال")).toBe("طب الأطفال");
    expect(humanizeCode(null)).toBe("—");
  });
});
