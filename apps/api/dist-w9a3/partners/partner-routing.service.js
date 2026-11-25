"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PartnerRouting = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const partners_service_1 = require("./partners.service");
const LOCATION_TTL_MS = 60_000;
let PartnerRouting = class PartnerRouting {
    registry;
    flags;
    cache = new Map();
    constructor(registry, flags) {
        this.registry = registry;
        this.flags = flags;
    }
    async orgAllows(registrationId, flagKey) {
        const orgRef = await this.registry.orgRefOf(registrationId);
        if (!orgRef)
            return true;
        const e = await this.flags.evaluate(flagKey, { market: (0, config_1.cfg)().defaultMarket, orgId: orgRef });
        return e.effective;
    }
    async assertOrgAllows(registrationId, flagKey) {
        if (!(await this.orgAllows(registrationId, flagKey)))
            throw (0, errors_1.forbidden)('FEATURE_DISABLED', 'This capability is switched off for this partner', { key: flagKey, scope: 'ORG' });
    }
    async hasAny(kind) { return (await this.registry.activeRegistrations(kind)).length > 0; }
    async live(kind, flagKey) {
        const regs = await this.registry.activeRegistrations(kind);
        const ok = [];
        for (const r of regs)
            if (await this.orgAllows(r.id, flagKey))
                ok.push({ id: r.id, name: r.name });
        return ok;
    }
    async byPartnerId(kind, flagKey, partnerId) {
        const reg = (await this.registry.activeRegistrations(kind)).find((r) => r.id === partnerId);
        if (!reg)
            throw (0, errors_1.notFound)('PARTNER_NOT_FOUND', 'Unknown or inactive partner');
        await this.assertOrgAllows(reg.id, flagKey);
        return { id: reg.id, name: reg.name };
    }
    async resolve(kind, flagKey, locationId, partnerId, lister) {
        if (partnerId)
            return this.byPartnerId(kind, flagKey, partnerId);
        const live = await this.live(kind, flagKey);
        if (!live.length) {
            if ((await this.registry.activeRegistrations(kind)).length)
                throw (0, errors_1.forbidden)('FEATURE_DISABLED', 'This capability is switched off for this partner', { key: flagKey, scope: 'ORG' });
            return null;
        }
        if (live.length === 1 || !locationId)
            return live.length === 1 ? live[0] : null;
        for (const refresh of [false, true]) {
            const owners = [];
            let failed = 0;
            for (const r of live) {
                try {
                    if ((await this.ids(kind, r.id, lister, refresh)).has(locationId))
                        owners.push(r);
                }
                catch {
                    failed++;
                }
            }
            if (owners.length === 1)
                return owners[0];
            if (owners.length > 1)
                throw (0, errors_1.conflict)('AMBIGUOUS_LOCATION', 'More than one partner offers this id: say which partner (partnerId)', { partners: owners.map((o) => ({ partnerId: o.id, name: o.name })) });
            if (refresh) {
                if (failed)
                    throw (0, errors_1.unavailable)('PARTNER_SYSTEM_BUSY', 'A partner system is busy, try again shortly', { retryable: true });
                throw (0, errors_1.notFound)('LOCATION_NOT_FOUND', 'No partner offers this pharmacy or lab');
            }
        }
        return null;
    }
    async ids(kind, registrationId, lister, refresh) {
        const key = `${kind}:${registrationId}`;
        const hit = this.cache.get(key);
        if (hit && !refresh && Date.now() - hit.at < LOCATION_TTL_MS)
            return hit.ids;
        const ids = new Set(await lister(registrationId));
        this.cache.set(key, { at: Date.now(), ids });
        return ids;
    }
    forget() { this.cache.clear(); }
};
exports.PartnerRouting = PartnerRouting;
exports.PartnerRouting = PartnerRouting = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [partners_service_1.PartnerRegistry, control_plane_public_1.FlagsService])
], PartnerRouting);
//# sourceMappingURL=partner-routing.service.js.map