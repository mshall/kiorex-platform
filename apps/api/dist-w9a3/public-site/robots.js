"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRobots = buildRobots;
const url_policy_1 = require("./url-policy");
function buildRobots(o) {
    if (!o.indexable)
        return ['# Non-production environment: not for indexing.', 'User-agent: *', 'Disallow: /', ''].join('\n');
    const lines = ['User-agent: *'];
    for (const l of o.locales)
        lines.push(`Allow: /${l}/`);
    lines.push('Allow: /_p/', 'Allow: /.well-known/');
    for (const p of url_policy_1.PRIVATE_PATH_PREFIXES)
        lines.push(`Disallow: ${p}`);
    lines.push('', `Sitemap: ${o.canonicalHost.replace(/\/+$/, '')}/sitemap.xml`, '');
    return lines.join('\n');
}
//# sourceMappingURL=robots.js.map