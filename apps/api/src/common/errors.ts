import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

/** Structured API error: { code, message, ...extra } */
export class ApiError extends HttpException {
  constructor(status: number, public readonly code: string, message: string, extra: Record<string, unknown> = {}) {
    super({ code, message, ...extra }, status);
  }
}
export const badRequest = (code: string, message: string, extra?: Record<string, unknown>) => new ApiError(400, code, message, extra);
export const notFound = (code: string, message: string) => new ApiError(404, code, message);
export const conflict = (code: string, message: string, extra?: Record<string, unknown>) => new ApiError(409, code, message, extra);
export const forbidden = (code: string, message: string, extra?: Record<string, unknown>) => new ApiError(403, code, message, extra);
export const unprocessable = (code: string, message: string, extra?: Record<string, unknown>) => new ApiError(422, code, message, extra);
export const unavailable = (code: string, message: string, extra?: Record<string, unknown>) => new ApiError(503, code, message, extra);

/**
 * Errors that are the CLIENT's fault but surface as plain Errors from Prisma / Date handling: an unknown id on `update` (P2025), a duplicate (P2002), a foreign key (P2003),
 * a malformed or out-of-range value (P2000/P2006/P2020/P2023/P2033 and PrismaClientValidationError, e.g. `?from=garbage` -> Invalid Date, `?page=-1`), `Invalid time value`.
 * They used to answer 500 INTERNAL_ERROR (found by the EDGE-49 contract sweep); they now answer the 4xx the caller can act on. Duck-typed on purpose: no Prisma import here.
 */
export function clientFaultOf(ex: unknown): { status: number; code: string; message: string } | null {
  const e = ex as { name?: string; code?: unknown; message?: string } | null;
  if (!e || typeof e !== 'object') return null;
  const code = typeof e.code === 'string' ? e.code : '';
  if (e.name === 'PrismaClientKnownRequestError' || /^P\d{4}$/.test(code)) {
    if (code === 'P2025') return { status: 404, code: 'NOT_FOUND', message: 'Record not found' };
    if (code === 'P2002') return { status: 409, code: 'CONFLICT', message: 'A record with these values already exists' };
    if (code === 'P2003' || code === 'P2014') return { status: 409, code: 'CONFLICT', message: 'The record is referenced by, or references, another record' };
    if (['P2000', 'P2005', 'P2006', 'P2007', 'P2008', 'P2009', 'P2010', 'P2011', 'P2012', 'P2013', 'P2019', 'P2020', 'P2023', 'P2033'].includes(code)) return { status: 400, code: 'INVALID_INPUT', message: 'A value is malformed or out of range' };
    return null;
  }
  if (e.name === 'PrismaClientValidationError') return { status: 400, code: 'INVALID_INPUT', message: 'A value is malformed or out of range' };
  if (/^Invalid value for (skip|take) argument/.test(e.message ?? '')) return { status: 400, code: 'INVALID_INPUT', message: 'page or pageSize out of range' }; // Prisma's own assertion for negative skip / take
  if (e.name === 'RangeError' && /invalid time value|invalid date/i.test(e.message ?? '')) return { status: 400, code: 'INVALID_INPUT', message: 'Invalid date or time' };
  return null;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('http');
  catch(ex: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (ex instanceof HttpException) {
      const status = ex.getStatus();
      const body = ex.getResponse();
      if (typeof body === 'string') return res.status(status).json({ code: HttpStatus[status] ?? 'ERROR', message: body });
      const b = body as Record<string, unknown>;
      const code = (b.code as string) ?? (typeof b.error === 'string' ? String(b.error).toUpperCase().replace(/ /g, '_') : 'ERROR');
      const message = Array.isArray(b.message) ? (b.message as string[]).join('; ') : ((b.message as string) ?? ex.message);
      const { error: _e, statusCode: _s, ...rest } = b;
      if (status === 429 && typeof rest.retryAfterSec === 'number') res.setHeader?.('Retry-After', String(rest.retryAfterSec));
      return res.status(status).json({ ...rest, code, message });
    }
    const fault = clientFaultOf(ex);
    if (fault) { this.log.warn(`client fault mapped to ${fault.status}: ${(ex as Error).message?.split('\n').pop()?.slice(0, 160)}`); return res.status(fault.status).json({ code: fault.code, message: fault.message }); }
    this.log.error(ex instanceof Error ? ex.stack : String(ex));
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Unexpected error' });
  }
}
