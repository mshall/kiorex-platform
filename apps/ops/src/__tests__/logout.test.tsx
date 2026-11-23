import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const unloaded: Array<() => void> = [];
const signoutRedirect = vi.fn(async () => { unloaded.forEach((f) => f()); }); // oidc-client-ts removes the user first, firing userUnloaded
vi.mock("@/auth/oidc", () => ({
  getManager: () => ({
    getUser: async () => ({ expired: false, profile: { sub: "ops-1", name: "Ops" }, access_token: "t" }),
    signoutRedirect,
    removeUser: async () => {},
    events: { addUserLoaded: () => {}, addUserUnloaded: (f: () => void) => { unloaded.push(f); } },
  }),
  toAuthUser: () => ({ sub: "ops-1", name: "Ops", token: "t", roles: ["ops_admin"] }),
}));

import { AuthProvider, useAuth } from "@/auth/AuthProvider";

function Probe() {
  const { status, logout } = useAuth();
  return <div><span data-testid="status">{status}</span><button onClick={() => void logout()}>out</button></div>;
}

describe("ops sign-out", () => {
  beforeEach(() => { unloaded.length = 0; signoutRedirect.mockClear(); });

  it("never reports signedOut while the Passport logout redirect is in flight (that would start a new sign-in and cancel /session/end)", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signedIn"));
    const seen: string[] = [];
    const obs = new MutationObserver(() => seen.push(screen.getByTestId("status").textContent ?? ""));
    obs.observe(screen.getByTestId("status"), { childList: true, characterData: true, subtree: true });
    await act(async () => { await userEvent.click(screen.getByText("out")); });
    obs.disconnect();
    expect(signoutRedirect).toHaveBeenCalledTimes(1);
    expect(seen).not.toContain("signedOut");
    expect(screen.getByTestId("status").textContent).toBe("loading");
  });
});
