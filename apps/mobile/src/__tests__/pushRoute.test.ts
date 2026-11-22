import { makeTapDeduper, pushPayload, routeForPush } from "@/lib/pushRoute";
import { installNotificationTapHandler } from "@/lib/pushTap";

const mockListeners: ((r: unknown) => void)[] = [];
let mockLast: unknown = null;
const mockRemove = jest.fn();
jest.mock("expo-notifications", () => ({
  getLastNotificationResponse: () => mockLast,
  addNotificationResponseReceivedListener: (fn: (r: unknown) => void) => { mockListeners.push(fn); return { remove: mockRemove }; },
}));
const resp = (id: string, data: unknown) => ({ actionIdentifier: "default", notification: { date: 1, request: { identifier: id, content: { data } } } });

describe("routeForPush", () => {
  it.each([
    [{ template: "booking.reminder", bookingId: "b_1" }, "/appointment/b_1"],
    [{ template: "result.released", resultId: "r1" }, "/results"],
    [{ template: "pharmacy.order.ready", pharmacyOrderId: "po-9" }, "/pharmacy/order/po-9"],
    [{ template: "pharmacy.order.ready" }, "/pharmacy/orders"],
    [{ template: "lab.booking.confirmed", labBookingId: "lb1" }, "/lab/booking/lb1"],
    [{ template: "telemedicine.waiting", sessionId: "s1" }, "/telemedicine"],
  ])("%j -> %s", (data, path) => { expect(routeForPush(data)).toBe(path); });
  it("reads the payload under the `body` key (object or JSON string)", () => {
    expect(routeForPush({ body: { bookingId: "b2" } })).toBe("/appointment/b2");
    expect(routeForPush({ body: JSON.stringify({ labBookingId: "x9" }) })).toBe("/lab/booking/x9");
    expect(pushPayload({ body: "not json" })).toEqual({ body: "not json" });
  });
  it("returns null for unknown or hostile payloads (ids never become arbitrary paths)", () => {
    expect(routeForPush(null)).toBeNull();
    expect(routeForPush({})).toBeNull();
    expect(routeForPush({ bookingId: "../../settings/delete" })).toBeNull();
    expect(routeForPush({ pharmacyOrderId: "a/b" })).toBeNull();
    expect(routeForPush("string")).toBeNull();
  });
});

describe("tap handler (foreground, background, cold start)", () => {
  beforeEach(() => { mockListeners.length = 0; mockLast = null; mockRemove.mockReset(); });
  it("routes a live tap and unsubscribes", () => {
    const go = jest.fn();
    const off = installNotificationTapHandler(go);
    mockListeners[0](resp("n1", { bookingId: "b1" }));
    expect(go).toHaveBeenCalledWith({ bookingId: "b1" });
    off(); expect(mockRemove).toHaveBeenCalled();
  });
  it("routes a cold-start tap once, even if the listener reports it too", async () => {
    mockLast = resp("n2", { labBookingId: "l1" });
    const go = jest.fn();
    installNotificationTapHandler(go);
    await Promise.resolve(); await Promise.resolve();
    mockListeners[0](mockLast);
    expect(go).toHaveBeenCalledTimes(1);
  });
  it("deduper ignores repeats and empty ids", () => {
    const f = makeTapDeduper();
    expect([f("a"), f("a"), f("b"), f(null)]).toEqual([true, false, true, false]);
  });
});
