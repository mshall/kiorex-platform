"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AllExceptionsFilter = exports.unavailable = exports.unprocessable = exports.forbidden = exports.conflict = exports.notFound = exports.badRequest = exports.ApiError = void 0;
exports.clientFaultOf = clientFaultOf;
const common_1 = require("@nestjs/common");
class ApiError extends common_1.HttpException {
    code;
    constructor(status, code, message, extra = {}) {
        super({ code, message, ...extra }, status);
        this.code = code;
    }
}
exports.ApiError = ApiError;
const badRequest = (code, message, extra) => new ApiError(400, code, message, extra);
exports.badRequest = badRequest;
const notFound = (code, message) => new ApiError(404, code, message);
exports.notFound = notFound;
const conflict = (code, message, extra) => new ApiError(409, code, message, extra);
exports.conflict = conflict;
const forbidden = (code, message, extra) => new ApiError(403, code, message, extra);
exports.forbidden = forbidden;
const unprocessable = (code, message, extra) => new ApiError(422, code, message, extra);
exports.unprocessable = unprocessable;
const unavailable = (code, message, extra) => new ApiError(503, code, message, extra);
exports.unavailable = unavailable;
function clientFaultOf(ex) {
    const e = ex;
    if (!e || typeof e !== 'object')
        return null;
    const code = typeof e.code === 'string' ? e.code : '';
    if (e.name === 'PrismaClientKnownRequestError' || /^P\d{4}$/.test(code)) {
        if (code === 'P2025')
            return { status: 404, code: 'NOT_FOUND', message: 'Record not found' };
        if (code === 'P2002')
            return { status: 409, code: 'CONFLICT', message: 'A record with these values already exists' };
        if (code === 'P2003' || code === 'P2014')
            return { status: 409, code: 'CONFLICT', message: 'The record is referenced by, or references, another record' };
        if (['P2000', 'P2005', 'P2006', 'P2007', 'P2008', 'P2009', 'P2010', 'P2011', 'P2012', 'P2013', 'P2019', 'P2020', 'P2023', 'P2033'].includes(code))
            return { status: 400, code: 'INVALID_INPUT', message: 'A value is malformed or out of range' };
        return null;
    }
    if (e.name === 'PrismaClientValidationError')
        return { status: 400, code: 'INVALID_INPUT', message: 'A value is malformed or out of range' };
    if (/^Invalid value for (skip|take) argument/.test(e.message ?? ''))
        return { status: 400, code: 'INVALID_INPUT', message: 'page or pageSize out of range' };
    if (e.name === 'RangeError' && /invalid time value|invalid date/i.test(e.message ?? ''))
        return { status: 400, code: 'INVALID_INPUT', message: 'Invalid date or time' };
    return null;
}
let AllExceptionsFilter = class AllExceptionsFilter {
    log = new common_1.Logger('http');
    catch(ex, host) {
        const res = host.switchToHttp().getResponse();
        if (ex instanceof common_1.HttpException) {
            const status = ex.getStatus();
            const body = ex.getResponse();
            if (typeof body === 'string')
                return res.status(status).json({ code: common_1.HttpStatus[status] ?? 'ERROR', message: body });
            const b = body;
            const code = b.code ?? (typeof b.error === 'string' ? String(b.error).toUpperCase().replace(/ /g, '_') : 'ERROR');
            const message = Array.isArray(b.message) ? b.message.join('; ') : (b.message ?? ex.message);
            const { error: _e, statusCode: _s, ...rest } = b;
            if (status === 429 && typeof rest.retryAfterSec === 'number')
                res.setHeader?.('Retry-After', String(rest.retryAfterSec));
            return res.status(status).json({ ...rest, code, message });
        }
        const fault = clientFaultOf(ex);
        if (fault) {
            this.log.warn(`client fault mapped to ${fault.status}: ${ex.message?.split('\n').pop()?.slice(0, 160)}`);
            return res.status(fault.status).json({ code: fault.code, message: fault.message });
        }
        this.log.error(ex instanceof Error ? ex.stack : String(ex));
        return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Unexpected error' });
    }
};
exports.AllExceptionsFilter = AllExceptionsFilter;
exports.AllExceptionsFilter = AllExceptionsFilter = __decorate([
    (0, common_1.Catch)()
], AllExceptionsFilter);
//# sourceMappingURL=errors.js.map