import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthContext, type AuthCtx } from "@/auth/AuthProvider";
import { RequireOps, isOps, OPS_ROLES } from "@/auth/RequireOps";
import "@/i18n";

const ctx = (roles: string[]): AuthCtx => ({ status: "signedIn", user: { sub: "u1", token: "t", roles }, login: async () => {}, logout: async () => {}, completeLogin: async () => "/" });
const show = (roles: string[]) => render(<AuthContext.Provider value={ctx(roles)}><RequireOps><p>console</p></RequireOps></AuthContext.Provider>);

describe("console role gate (GRW-P2-S)", () => {
  it("admits ops_admin, super_admin and growth_admin; refuses patient and support-only roles", () => {
    expect(OPS_ROLES).toContain("growth_admin");
    expect(isOps(["growth_admin"])).toBe(true); expect(isOps(["ops_admin"])).toBe(true); expect(isOps(["patient"])).toBe(false); expect(isOps([])).toBe(false);
  });
  it("renders the console for a growth_admin and the no-access alert for a patient", () => {
    const a = show(["growth_admin"]); expect(screen.getByText("console")).toBeInTheDocument(); a.unmount();
    show(["patient"]); expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
