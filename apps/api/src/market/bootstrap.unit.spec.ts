import { parseEndpointBindings } from './bootstrap.service';

describe('regional endpoint bindings', () => {
  it('accepts clean https endpoints and drops everything else', () => {
    const r = parseEndpointBindings(JSON.stringify({ eg: 'https://api.example.com/api/v1/', SA: 'https://api.sa.example.com', XX: 'ftp://x', AE: 'https://u:p@api.ae.example.com', QA: 'https://q.example.com/api?x=1', KW: 'http://insecure.example.com', 'EGY': 'https://x.example.com', BH: 7 }), true);
    expect(r).toEqual({ EG: 'https://api.example.com/api/v1', SA: 'https://api.sa.example.com' });
  });
  it('allows http outside production only; garbage yields nothing', () => {
    expect(parseEndpointBindings('{"EG":"http://localhost:4000/api/v1"}', false)).toEqual({ EG: 'http://localhost:4000/api/v1' });
    expect(parseEndpointBindings('{"EG":"http://localhost:4000/api/v1"}', true)).toEqual({});
    for (const g of ['', 'not json', '[]', 'null', undefined]) expect(parseEndpointBindings(g as string | undefined, false)).toEqual({});
  });
});
