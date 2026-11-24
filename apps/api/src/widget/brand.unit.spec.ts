import { contrast, DEFAULT_ACCENT, DEFAULT_RADIUS, MAX_RADIUS, parseHexColor, resolveBrand } from './brand';

describe('widget branding within safe bounds (GRW-P1-G)', () => {
  it('accepts only #rrggbb (with or without #), falls back to the Kiorex indigo for anything else', () => {
    expect(parseHexColor('#ABCDEF')).toBe('#abcdef');
    expect(parseHexColor('abcdef')).toBe('#abcdef');
    for (const bad of ['#fff', 'red', 'rgb(1,2,3)', 'url(x)', '#12345g', '', 5, null, 'expression(alert(1))']) expect(parseHexColor(bad)).toBeNull();
    expect(resolveBrand({ color: 'javascript:1' }).accent).toBe(DEFAULT_ACCENT);
  });
  it('radius is an integer 0..16', () => {
    expect(resolveBrand({ radius: '0' }).radius).toBe(0);
    expect(resolveBrand({ radius: '16' }).radius).toBe(MAX_RADIUS);
    for (const bad of ['17', '-1', '3.5', 'x', undefined]) expect(resolveBrand({ radius: bad }).radius).toBe(DEFAULT_RADIUS);
  });
  it('text on the accent and the accent as text on white always reach WCAG AA 4.5:1, for every colour of a coarse RGB sweep', () => {
    for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) {
      const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      const br = resolveBrand({ color: hex });
      expect(contrast(br.onAccent, br.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(br.accentText, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('the logo shows unless explicitly switched off; the logo is never a URL taken from the page', () => {
    expect(resolveBrand({}).logo).toBe(true);
    expect(resolveBrand({ logo: 'off' }).logo).toBe(false);
    expect(Object.keys(resolveBrand({ logo: 'https://evil.example/x.png' }))).not.toContain('logoUrl');
  });
});
