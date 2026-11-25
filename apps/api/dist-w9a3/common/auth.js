"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentUser = exports.SuperAdminOnly = exports.OpsOnly = exports.OPS_ROLES = exports.Roles = exports.Public = exports.ROLES_KEY = exports.IS_PUBLIC = void 0;
const common_1 = require("@nestjs/common");
exports.IS_PUBLIC = 'kx:public';
exports.ROLES_KEY = 'kx:roles';
const Public = () => (0, common_1.SetMetadata)(exports.IS_PUBLIC, true);
exports.Public = Public;
const Roles = (...roles) => (0, common_1.SetMetadata)(exports.ROLES_KEY, roles);
exports.Roles = Roles;
exports.OPS_ROLES = ['ops_admin', 'super_admin'];
const OpsOnly = () => (0, exports.Roles)(...exports.OPS_ROLES);
exports.OpsOnly = OpsOnly;
const SuperAdminOnly = () => (0, exports.Roles)('super_admin');
exports.SuperAdminOnly = SuperAdminOnly;
exports.CurrentUser = (0, common_1.createParamDecorator)((_d, ctx) => ctx.switchToHttp().getRequest().user);
//# sourceMappingURL=auth.js.map