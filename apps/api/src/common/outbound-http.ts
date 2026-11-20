import { Logger } from '@nestjs/common';

/**
 * Outbound HTTP for server-to-server calls (partners, webhooks, AI providers).
 *
 * Why `connection: close`: on Node 24 (bundled undici) every request on a pooled keep-alive socket calls
 * `socket.setTypeOfService()`. When the peer has just reset/closed that idle socket (restart of a sibling service, keep-alive
 * race) macOS answers EINVAL and undici throws it from inside a socket event handler, i.e. as an *uncaught exception* that
 * killed the whole API process. These calls are low-volume, so a fresh connection per request removes the stale-socket race.
 */
export function outboundFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('connection', 'close');
  return fetch(input, { ...init, headers });
}

/** The known benign undici/macOS failure: a socket option set on an already-reset socket. Not an application fault. */
export function isBenignSocketError(e: unknown): boolean {
  const err = e as NodeJS.ErrnoException | undefined;
  if (!err || typeof err !== 'object') return false;
  if (err.syscall === 'setTypeOfService' && err.code === 'EINVAL') return true;
  return ['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(String(err.code)) && /socket|read|write/.test(String(err.syscall ?? 'socket'));
}

/** Process-level safety net: benign socket errors are logged and the API keeps serving; anything else is a real fault and exits. */
export function installProcessSafetyNet(log = new Logger('process')): void {
  process.on('uncaughtException', (e) => {
    if (isBenignSocketError(e)) { log.warn(`ignored non-fatal socket error: ${(e as Error).message} (${(e as any).code})`); return; }
    log.error(`uncaught exception, exiting: ${(e as Error)?.stack ?? e}`);
    process.exit(1);
  });
  process.on('unhandledRejection', (e) => {
    if (isBenignSocketError(e)) { log.warn(`ignored non-fatal socket rejection: ${(e as Error).message}`); return; }
    log.error(`unhandled rejection: ${(e as Error)?.stack ?? e}`);
  });
}
