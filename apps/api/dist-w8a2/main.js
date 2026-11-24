"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const swagger_1 = require("@nestjs/swagger");
const app_module_1 = require("./app.module");
const app_setup_1 = require("./app.setup");
const config_1 = require("./common/config");
const outbound_http_1 = require("./common/outbound-http");
const startup_1 = require("./common/providers/startup");
const partner_leads_public_1 = require("./partner-leads/partner-leads-public");
const security_1 = require("./common/security");
async function bootstrap() {
    (0, outbound_http_1.installProcessSafetyNet)();
    (0, startup_1.logProviderStartup)();
    (0, security_1.assertProductionSecrets)();
    const lead = (0, partner_leads_public_1.verifyLeadSigningStartup)();
    console.log(`lead signing: ${lead.status}`);
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { rawBody: true });
    (0, app_setup_1.setupApp)(app);
    (0, security_1.applyHttpHardening)(app);
    app.enableCors((0, security_1.corsOptions)());
    if ((0, security_1.swaggerEnabled)())
        swagger_1.SwaggerModule.setup('api/docs', app, (0, app_setup_1.buildOpenApi)(app));
    await app.listen((0, config_1.cfg)().port);
    app.getHttpServer().on('clientError', (err, socket) => {
        if (socket.writable && !socket.destroyed)
            socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        else
            socket.destroy();
    });
    console.log(`Kiorex API listening on :${(0, config_1.cfg)().port}/api/v1`);
}
void bootstrap();
//# sourceMappingURL=main.js.map