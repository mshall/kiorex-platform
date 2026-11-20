import * as http from 'http';
import { isBenignSocketError, outboundFetch } from './outbound-http';

describe('outbound-http', () => {
  it('sends connection: close so no pooled keep-alive socket is reused (Node 24 setTypeOfService EINVAL)', async () => {
    const seen: (string | undefined)[] = [];
    const s = http.createServer((q, r) => { seen.push(q.headers.connection); r.end('ok'); });
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(s.address() as any).port}/`;
    try {
      for (let i = 0; i < 3; i++) expect(await (await outboundFetch(url, { headers: { 'x-a': '1' } })).text()).toBe('ok');
      // server resets sockets between calls: must not throw an uncaught exception
      s.closeAllConnections();
      expect(await (await outboundFetch(url)).text()).toBe('ok');
    } finally { s.close(); }
    expect(seen.every((c) => c === 'close')).toBe(true);
  });

  it('classifies only the known benign socket errors', () => {
    expect(isBenignSocketError(Object.assign(new Error('setTypeOfService EINVAL'), { code: 'EINVAL', syscall: 'setTypeOfService' }))).toBe(true);
    expect(isBenignSocketError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', syscall: 'read' }))).toBe(true);
    expect(isBenignSocketError(Object.assign(new Error('EINVAL'), { code: 'EINVAL', syscall: 'open' }))).toBe(false);
    expect(isBenignSocketError(new TypeError('x is undefined'))).toBe(false);
    expect(isBenignSocketError(undefined)).toBe(false);
  });
});
