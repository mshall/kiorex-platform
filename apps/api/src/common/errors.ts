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
      return res.status(status).json({ ...rest, code, message });
    }
    this.log.error(ex instanceof Error ? ex.stack : String(ex));
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Unexpected error' });
  }
}
