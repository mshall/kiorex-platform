/** The API error envelope is `{ code, message, ...extra }` (e.g. SLOT_TAKEN carries `alternatives`, FEATURE_DISABLED carries `key`, `scope`). */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
  }
  get isFeatureDisabled() { return this.status === 403 && this.code === "FEATURE_DISABLED"; }
  get featureKey(): string | undefined { return this.details?.key as string | undefined; }
  get retryable() { return this.details?.retryable === true || this.status >= 502; }
}

export function toApiError(status: number, body: unknown): ApiError {
  const { code, message, details, ...rest } = (body ?? {}) as { code?: string; message?: string; details?: Record<string, unknown> } & Record<string, unknown>;
  const extra = details ?? (Object.keys(rest).length ? rest : undefined);
  return new ApiError(status, typeof code === "string" ? code : `HTTP_${status}`, typeof message === "string" ? message : `Request failed (${status})`, extra);
}
