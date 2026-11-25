"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.capabilitiesOf = exports.can = exports.rolesFor = exports.GROWTH_ACCESS = exports.GROWTH_CAPABILITIES = void 0;
exports.GROWTH_CAPABILITIES = ['read', 'readFinance', 'writeConfig', 'approveConfig', 'reviewFraud', 'manage', 'manageCampaigns', 'manageExperiments', 'reviewPromotions', 'manageCorporate'];
exports.GROWTH_ACCESS = {
    read: ['super_admin', 'ops_admin', 'finance', 'support', 'growth_admin'],
    readFinance: ['super_admin', 'finance'],
    writeConfig: ['super_admin'],
    approveConfig: ['super_admin'],
    reviewFraud: ['super_admin', 'support'],
    manage: ['super_admin'],
    manageCampaigns: ['super_admin'],
    reviewPromotions: ['super_admin', 'growth_admin'],
    manageCorporate: ['super_admin'],
    manageExperiments: ['super_admin'],
};
const rolesFor = (cap) => [...exports.GROWTH_ACCESS[cap]];
exports.rolesFor = rolesFor;
const can = (roles, cap) => roles.some((r) => exports.GROWTH_ACCESS[cap].includes(r));
exports.can = can;
const capabilitiesOf = (roles) => Object.fromEntries(exports.GROWTH_CAPABILITIES.map((c) => [c, (0, exports.can)(roles, c)]));
exports.capabilitiesOf = capabilitiesOf;
//# sourceMappingURL=growth-access.js.map