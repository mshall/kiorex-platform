"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_QUERY_PARAMS = exports.API_PREFIX = void 0;
exports.setupApp = setupApp;
exports.buildOpenApi = buildOpenApi;
const common_1 = require("@nestjs/common");
const reject_nul_bytes_pipe_1 = require("./common/reject-nul-bytes.pipe");
const swagger_1 = require("@nestjs/swagger");
const contracts_1 = require("@kiorex/contracts");
const errors_1 = require("./common/errors");
exports.API_PREFIX = 'api/v1';
function setupApp(app) {
    app.setGlobalPrefix(exports.API_PREFIX, { exclude: ['.well-known/apple-app-site-association', '.well-known/assetlinks.json', 'r/:code', 'q/:code', 'a/:id', 'appointment/:id'] });
    app.use?.(`/${exports.API_PREFIX}/partners/v1/connection-requests`, (req, res, next) => {
        const len = Number(req.headers?.['content-length'] ?? 0);
        if (req.method === 'POST' && len > contracts_1.INTAKE_MAX_BODY_BYTES) {
            res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' });
            return;
        }
        next();
    });
    app.useBodyParser?.('json', { limit: '8mb' });
    app.useBodyParser?.('raw', { type: 'application/octet-stream', limit: '52mb' });
    app.useGlobalPipes(new reject_nul_bytes_pipe_1.RejectNulBytesPipe(), new common_1.ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    app.useGlobalFilters(new errors_1.AllExceptionsFilter());
    return app;
}
exports.REQUIRED_QUERY_PARAMS = {
    'get /api/v1/rx/verify': ['t'],
    'get /api/v1/control/v1/flags/snapshot': ['product'],
    'get /api/v1/dev/channels/whatsapp/conversation': ['phone'],
    'get /api/v1/providers/{id}/slots': ['typeId'],
    'get /api/v1/lab/slots': ['labId'],
};
function buildOpenApi(app) {
    const cfgDoc = new swagger_1.DocumentBuilder()
        .setTitle('Kiorex API').setDescription('Kiorex marketplace API. Identity: Kiorex Passport (OIDC). Errors: { code, message, ...extra }. Flag OFF => 403 FEATURE_DISABLED {key, scope}.')
        .setVersion('1.0.0').addBearerAuth().build();
    const doc = swagger_1.SwaggerModule.createDocument(app, cfgDoc);
    for (const [path, item] of Object.entries(doc.paths)) {
        for (const [method, op] of Object.entries(item)) {
            const required = exports.REQUIRED_QUERY_PARAMS[`${method} ${path}`] ?? [];
            for (const prm of op?.parameters ?? [])
                if (prm.in === 'query')
                    prm.required = required.includes(prm.name);
        }
    }
    return doc;
}
//# sourceMappingURL=app.setup.js.map