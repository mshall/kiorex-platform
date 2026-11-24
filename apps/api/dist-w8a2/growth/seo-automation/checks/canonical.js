"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonical = canonical;
function canonical(p, _c) {
    const issues = [];
    if (!p.canonical)
        issues.push('no canonical');
    else {
        if (p.canonical !== p.expectedCanonical)
            issues.push(`canonical ${p.canonical} differs from ${p.expectedCanonical}`);
        if (/[?#]/.test(p.canonical))
            issues.push('canonical carries a query or fragment');
        if (p.canonical.length > 'https://x'.length && p.canonical.endsWith('/'))
            issues.push('canonical has a trailing slash');
        if (new URL(p.canonical, 'https://x').pathname !== new URL(p.canonical, 'https://x').pathname.toLowerCase())
            issues.push('canonical path is not lower-case');
        if (!p.canonical.includes(`/${p.locale}/`) && !p.canonical.endsWith(`/${p.locale}`) && !new RegExp(`/${p.locale}/[a-z]{2}(/|$)`).test(p.canonical))
            issues.push('canonical is not in the page locale');
    }
    if (/noindex/i.test(p.robots))
        issues.push('page is noindex yet in the candidate set');
    return issues.length ? [{ id: 'canonical', ok: false, severity: 'block', detail: issues.join('; ') }] : [{ id: 'canonical', ok: true, severity: 'block' }];
}
//# sourceMappingURL=canonical.js.map