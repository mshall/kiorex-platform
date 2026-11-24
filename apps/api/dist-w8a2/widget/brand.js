"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_RADIUS = exports.DEFAULT_RADIUS = exports.DEFAULT_ACCENT = void 0;
exports.parseHexColor = parseHexColor;
exports.luminance = luminance;
exports.contrast = contrast;
exports.resolveBrand = resolveBrand;
exports.DEFAULT_ACCENT = '#3730a3';
exports.DEFAULT_RADIUS = 10;
exports.MAX_RADIUS = 16;
const HEX = /^#[0-9a-f]{6}$/;
function parseHexColor(v) {
    if (typeof v !== 'string')
        return null;
    const s = v.trim().toLowerCase();
    const full = /^[0-9a-f]{6}$/.test(s) ? `#${s}` : s;
    return HEX.test(full) ? full : null;
}
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
}
const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
function darken(hex, f) { const n = parseInt(hex.slice(1), 16); return toHex(((n >> 16) & 255) * f, ((n >> 8) & 255) * f, (n & 255) * f); }
function resolveBrand(input) {
    let accent = parseHexColor(input.color) ?? exports.DEFAULT_ACCENT;
    let fit = 0;
    while (Math.max(contrast('#ffffff', accent), contrast('#0f172a', accent)) < 4.5 && fit++ < 40)
        accent = darken(accent, 0.94);
    const r = Number(input.radius);
    const radius = Number.isInteger(r) && r >= 0 && r <= exports.MAX_RADIUS ? r : exports.DEFAULT_RADIUS;
    const onAccent = contrast('#ffffff', accent) >= contrast('#0f172a', accent) ? '#ffffff' : '#0f172a';
    let accentText = accent;
    let guard = 0;
    while (contrast(accentText, '#ffffff') < 4.5 && guard++ < 40)
        accentText = darken(accentText, 0.92);
    return { accent, onAccent, accentText, radius, logo: !(input.logo === 'off' || input.logo === false || input.logo === '0') };
}
//# sourceMappingURL=brand.js.map