import { parseRxToken, rxToken, rxTokenValid } from './rx';

describe('prescription verification token', () => {
  const at = new Date('2026-10-21T09:00:00.000Z');
  it.each(['kx_rec_abc123XYZ', 'demo_rec_mk01_rx'])('round-trips for record id %s (vault ids and seed ids)', (id) => {
    const p = parseRxToken(rxToken(id, at));
    expect(p?.recordId).toBe(id);
    expect(rxTokenValid(id, at, p!.mac)).toBe(true);
  });
  it('rejects a tampered MAC, another signing time and malformed tokens', () => {
    const t = rxToken('demo_rec_mk01_rx', at);
    const p = parseRxToken(t)!;
    expect(rxTokenValid(p.recordId, at, 'A'.repeat(24))).toBe(false);
    expect(rxTokenValid(p.recordId, new Date('2026-10-22T09:00:00.000Z'), p.mac)).toBe(false);
    for (const bad of ['', 'kxrx1.x.y', 'kxrx2.demo_rec_mk01_rx.' + p.mac, 'kxrx1.a b.' + p.mac, 'kxrx1..' + p.mac]) expect(parseRxToken(bad)).toBeNull();
  });
});
