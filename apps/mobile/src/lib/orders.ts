/** Shared status → badge tone for pharmacy orders and lab bookings. */
export const orderTone = (s: string): "success" | "warning" | "danger" | "muted" | "ink" =>
  s === "DISPENSED" || s === "READY" || s === "RESULT_RELEASED" ? "success"
    : s === "REJECTED" || s === "PARTIAL_REVIEW" ? "danger"
      : s === "PARTIALLY_FULFILLED" ? "warning"
      : s === "CANCELLED" ? "muted"
        : s === "PENDING_PAYMENT" ? "warning" : "ink";

export const PAYABLE = "PENDING_PAYMENT";
export const isTerminalOrder = (s: string) => ["READY", "OUT_FOR_DELIVERY", "DISPENSED", "PARTIALLY_FULFILLED", "REJECTED", "CANCELLED", "RESULT_RELEASED"].includes(s);
/** Pharmacy orders can be cancelled until the pharmacy marks them ready. */
export const pharmacyCancellable = (s: string) => ["PENDING_PAYMENT", "PAID", "SUBMITTED", "PARTIAL_REVIEW"].includes(s);
export const labCancellable = (s: string) => ["PENDING_PAYMENT", "PAID", "SUBMITTED"].includes(s);
