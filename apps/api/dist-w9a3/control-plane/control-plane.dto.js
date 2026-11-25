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
exports.GateRecordedDto = exports.GateBoardDto = exports.GateEntryDto = exports.GateFlagDto = exports.RequestDecisionDto = exports.SweepResultDto = exports.ProductRegistrationDto = exports.PropagationDto = exports.PropagationProductDto = exports.FlagAuditDto = exports.FlagChangeRequestDto = exports.FlagDefinitionDto = exports.VersionDto = exports.SetFlagResultDto = exports.AdminFlagDto = exports.FlagLastChangeDto = exports.FlagGateDto = exports.FlagOverrideDto = exports.FlagSourceDto = exports.FlagEffectiveMapDto = exports.FlagSnapshotDto = exports.SnapshotFlagDto = exports.SnapshotFlagValuesDto = exports.EffectiveFlagsDto = exports.FlagEffectiveDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const OBJ = { type: 'object', additionalProperties: true };
class FlagEffectiveDto {
    enabled;
    reason;
    scope;
}
exports.FlagEffectiveDto = FlagEffectiveDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['ON', 'OFF_GLOBAL', 'OFF_MARKET', 'OFF_ORG', 'AWAITING_GATE', 'DEPENDENCY_OFF', 'UNKNOWN_FLAG'] }),
    __metadata("design:type", String)
], FlagEffectiveDto.prototype, "reason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, enum: ['GLOBAL', 'MARKET', 'ORG', 'GATE', 'DEPENDENCY'] }),
    __metadata("design:type", String)
], FlagEffectiveDto.prototype, "scope", void 0);
class EffectiveFlagsDto {
    market;
    version;
    flags;
}
exports.EffectiveFlagsDto = EffectiveFlagsDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'EG' }),
    __metadata("design:type", String)
], EffectiveFlagsDto.prototype, "market", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: { type: 'object', required: ['enabled', 'reason'], properties: { enabled: { type: 'boolean' }, reason: { type: 'string' }, scope: { type: 'string' } } }, description: 'Map of Kiorex flag key -> effective state (hide entry points when enabled=false)' }),
    __metadata("design:type", Object)
], EffectiveFlagsDto.prototype, "flags", void 0);
class SnapshotFlagValuesDto {
    global;
    markets;
    orgs;
}
exports.SnapshotFlagValuesDto = SnapshotFlagValuesDto;
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, enum: ['OFF'] }),
    __metadata("design:type", String)
], SnapshotFlagValuesDto.prototype, "global", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: { type: 'string' } }),
    __metadata("design:type", Object)
], SnapshotFlagValuesDto.prototype, "markets", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: { type: 'string' } }),
    __metadata("design:type", Object)
], SnapshotFlagValuesDto.prototype, "orgs", void 0);
class SnapshotFlagDto {
    key;
    class;
    scopes;
    dependsOn;
    launchLocked;
    gateSatisfied;
    values;
    expiresAt;
}
exports.SnapshotFlagDto = SnapshotFlagDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], SnapshotFlagDto.prototype, "scopes", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], SnapshotFlagDto.prototype, "dependsOn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: SnapshotFlagValuesDto }),
    __metadata("design:type", SnapshotFlagValuesDto)
], SnapshotFlagDto.prototype, "values", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, format: 'date-time' }),
    __metadata("design:type", String)
], SnapshotFlagDto.prototype, "expiresAt", void 0);
class FlagSnapshotDto {
    product;
    version;
    generatedAt;
    flags;
    signature;
}
exports.FlagSnapshotDto = FlagSnapshotDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], FlagSnapshotDto.prototype, "generatedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [SnapshotFlagDto] }),
    __metadata("design:type", Array)
], FlagSnapshotDto.prototype, "flags", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'base64url HMAC-SHA256 over the sorted-key JSON of the snapshot without this field' }),
    __metadata("design:type", String)
], FlagSnapshotDto.prototype, "signature", void 0);
class FlagEffectiveMapDto {
    global;
    market;
}
exports.FlagEffectiveMapDto = FlagEffectiveMapDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], FlagEffectiveMapDto.prototype, "global", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: { type: 'boolean' }, description: 'market code -> effective' }),
    __metadata("design:type", Object)
], FlagEffectiveMapDto.prototype, "market", void 0);
class FlagSourceDto {
    scope;
    scopeId;
    reason;
    ticket;
    setBy;
    expiresAt;
    at;
    blockedBy;
}
exports.FlagSourceDto = FlagSourceDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['GLOBAL', 'MARKET', 'ORG', 'GATE', 'DEPENDENCY', 'DEFAULT'] }),
    __metadata("design:type", String)
], FlagSourceDto.prototype, "scope", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], FlagSourceDto.prototype, "scopeId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], FlagSourceDto.prototype, "reason", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], FlagSourceDto.prototype, "ticket", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], FlagSourceDto.prototype, "setBy", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], FlagSourceDto.prototype, "expiresAt", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ format: 'date-time' }),
    __metadata("design:type", String)
], FlagSourceDto.prototype, "at", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'DEPENDENCY: the flag that is OFF' }),
    __metadata("design:type", String)
], FlagSourceDto.prototype, "blockedBy", void 0);
class FlagOverrideDto {
    scope;
    scopeId;
    reason;
    ticket;
    expiresAt;
    startsAt;
}
exports.FlagOverrideDto = FlagOverrideDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], FlagOverrideDto.prototype, "scope", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], FlagOverrideDto.prototype, "scopeId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], FlagOverrideDto.prototype, "reason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], FlagOverrideDto.prototype, "ticket", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], FlagOverrideDto.prototype, "expiresAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], FlagOverrideDto.prototype, "startsAt", void 0);
class FlagGateDto {
    gateId;
    approver;
    approvedOn;
    documentUrl;
}
exports.FlagGateDto = FlagGateDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], FlagGateDto.prototype, "gateId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], FlagGateDto.prototype, "approver", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], FlagGateDto.prototype, "approvedOn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], FlagGateDto.prototype, "documentUrl", void 0);
class FlagLastChangeDto {
    at;
    actor;
    event;
    newValue;
    reason;
}
exports.FlagLastChangeDto = FlagLastChangeDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], FlagLastChangeDto.prototype, "at", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], FlagLastChangeDto.prototype, "actor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['TOGGLE', 'GATE', 'EXPIRY', 'REQUEST', 'APPROVE', 'REVIEW'] }),
    __metadata("design:type", String)
], FlagLastChangeDto.prototype, "event", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], FlagLastChangeDto.prototype, "newValue", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], FlagLastChangeDto.prototype, "reason", void 0);
class AdminFlagDto {
    key;
    product;
    class;
    scopes;
    dependsOn;
    moneyPath;
    launchLocked;
    whenOff;
    gateHint;
    effective;
    state;
    reason;
    source;
    overrides;
    gate;
    gateIds;
    edition;
    gates;
    missingGates;
    lastChange;
}
exports.AdminFlagDto = AdminFlagDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], AdminFlagDto.prototype, "scopes", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], AdminFlagDto.prototype, "dependsOn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], AdminFlagDto.prototype, "whenOff", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], AdminFlagDto.prototype, "gateHint", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: FlagEffectiveMapDto }),
    __metadata("design:type", FlagEffectiveMapDto)
], AdminFlagDto.prototype, "effective", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['ON', 'ON_AWAITING_GATE', 'OFF'] }),
    __metadata("design:type", String)
], AdminFlagDto.prototype, "state", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: FlagSourceDto }),
    __metadata("design:type", FlagSourceDto)
], AdminFlagDto.prototype, "source", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [FlagOverrideDto] }),
    __metadata("design:type", Array)
], AdminFlagDto.prototype, "overrides", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: FlagGateDto, nullable: true, description: 'Launch-gate evidence recorded by a human; null until then (first row when several gates are required)' }),
    __metadata("design:type", Object)
], AdminFlagDto.prototype, "gate", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String], description: 'Gate ids that must ALL have evidence (e.g. GHV1, GHV2); empty = any single evidence row' }),
    __metadata("design:type", Array)
], AdminFlagDto.prototype, "gateIds", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'NURSE for nurse.* keys (served in the kiorly-clinic snapshot)' }),
    __metadata("design:type", Object)
], AdminFlagDto.prototype, "edition", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [FlagGateDto], description: 'Every gate evidence row recorded for this flag' }),
    __metadata("design:type", Array)
], AdminFlagDto.prototype, "gates", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String], description: 'Launch-locked flags: gate ids still without evidence (ANY when no gate id is listed and none recorded)' }),
    __metadata("design:type", Array)
], AdminFlagDto.prototype, "missingGates", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: FlagLastChangeDto, nullable: true }),
    __metadata("design:type", Object)
], AdminFlagDto.prototype, "lastChange", void 0);
class SetFlagResultDto {
    status;
    requestId;
    version;
}
exports.SetFlagResultDto = SetFlagResultDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['APPLIED', 'PENDING_APPROVAL'] }),
    __metadata("design:type", String)
], SetFlagResultDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    __metadata("design:type", String)
], SetFlagResultDto.prototype, "requestId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    __metadata("design:type", Number)
], SetFlagResultDto.prototype, "version", void 0);
class VersionDto {
    version;
}
exports.VersionDto = VersionDto;
class FlagDefinitionDto {
    key;
    product;
    class;
    scopes;
    dependsOn;
    launchLocked;
    moneyPath;
    description;
}
exports.FlagDefinitionDto = FlagDefinitionDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], FlagDefinitionDto.prototype, "scopes", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], FlagDefinitionDto.prototype, "dependsOn", void 0);
class FlagChangeRequestDto {
    id;
    flagKey;
    scope;
    scopeId;
    value;
    reason;
    ticket;
    requestedBy;
    status;
    emergency;
    reviewDueAt;
    expiresAt;
    approvedBy;
    reviewedBy;
    reviewedAt;
    decidedAt;
    createdAt;
}
exports.FlagChangeRequestDto = FlagChangeRequestDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['ON', 'OFF'] }),
    __metadata("design:type", String)
], FlagChangeRequestDto.prototype, "value", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['PENDING', 'APPROVED', 'REJECTED'] }),
    __metadata("design:type", String)
], FlagChangeRequestDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], FlagChangeRequestDto.prototype, "reviewDueAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], FlagChangeRequestDto.prototype, "expiresAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], FlagChangeRequestDto.prototype, "approvedBy", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], FlagChangeRequestDto.prototype, "reviewedBy", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], FlagChangeRequestDto.prototype, "reviewedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], FlagChangeRequestDto.prototype, "decidedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], FlagChangeRequestDto.prototype, "createdAt", void 0);
class FlagAuditDto {
    id;
    flagKey;
    scope;
    scopeId;
    oldValue;
    newValue;
    actor;
    reason;
    ticket;
    expiresAt;
    emergency;
    event;
    createdAt;
}
exports.FlagAuditDto = FlagAuditDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], FlagAuditDto.prototype, "oldValue", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], FlagAuditDto.prototype, "reason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], FlagAuditDto.prototype, "ticket", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], FlagAuditDto.prototype, "expiresAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['TOGGLE', 'GATE', 'EXPIRY', 'REQUEST', 'APPROVE', 'REVIEW'] }),
    __metadata("design:type", String)
], FlagAuditDto.prototype, "event", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], FlagAuditDto.prototype, "createdAt", void 0);
class PropagationProductDto {
    product;
    snapshotVersion;
    lastFetchedAt;
    ageSeconds;
    versionsBehind;
    status;
    lastPush;
    webhookConfigured;
}
exports.PropagationProductDto = PropagationProductDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], PropagationProductDto.prototype, "lastFetchedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], PropagationProductDto.prototype, "ageSeconds", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['NEVER_FETCHED', 'IN_SYNC', 'STALE', 'PROPAGATING'] }),
    __metadata("design:type", String)
], PropagationProductDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(OBJ),
    __metadata("design:type", Object)
], PropagationProductDto.prototype, "lastPush", void 0);
class PropagationDto {
    currentVersion;
    products;
}
exports.PropagationDto = PropagationDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [PropagationProductDto] }),
    __metadata("design:type", Array)
], PropagationDto.prototype, "products", void 0);
class ProductRegistrationDto {
    product;
    webhookUrl;
    active;
}
exports.ProductRegistrationDto = ProductRegistrationDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], ProductRegistrationDto.prototype, "webhookUrl", void 0);
class SweepResultDto {
    expired;
    started;
}
exports.SweepResultDto = SweepResultDto;
class RequestDecisionDto {
    status;
    version;
}
exports.RequestDecisionDto = RequestDecisionDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['APPROVED', 'REJECTED', 'REVIEWED'] }),
    __metadata("design:type", String)
], RequestDecisionDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    __metadata("design:type", Number)
], RequestDecisionDto.prototype, "version", void 0);
class GateFlagDto {
    key;
    requiredGates;
    evidence;
}
exports.GateFlagDto = GateFlagDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], GateFlagDto.prototype, "requiredGates", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', nullable: true, additionalProperties: true, description: 'Evidence recorded by a human for this flag + gate; null until then' }),
    __metadata("design:type", Object)
], GateFlagDto.prototype, "evidence", void 0);
class GateEntryDto {
    gateId;
    flags;
}
exports.GateEntryDto = GateEntryDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [GateFlagDto] }),
    __metadata("design:type", Array)
], GateEntryDto.prototype, "flags", void 0);
class GateBoardDto {
    gates;
}
exports.GateBoardDto = GateBoardDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [GateEntryDto] }),
    __metadata("design:type", Array)
], GateBoardDto.prototype, "gates", void 0);
class GateRecordedDto {
    gateId;
    flags;
    version;
}
exports.GateRecordedDto = GateRecordedDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], GateRecordedDto.prototype, "flags", void 0);
//# sourceMappingURL=control-plane.dto.js.map