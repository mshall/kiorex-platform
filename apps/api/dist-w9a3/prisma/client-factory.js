"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DB_URL = exports.DEFAULT_POOL_MAX = void 0;
exports.resolvePoolMax = resolvePoolMax;
exports.resolveSsl = resolveSsl;
exports.adapterFromUrl = adapterFromUrl;
exports.createPrismaClient = createPrismaClient;
const adapter_pg_1 = require("@prisma/adapter-pg");
const node_fs_1 = require("node:fs");
const client_1 = require("./generated/client");
exports.DEFAULT_POOL_MAX = 10;
function resolvePoolMax(connectionLimit) {
    if (Number.isInteger(connectionLimit) && connectionLimit > 0)
        return connectionLimit;
    const env = Number(process.env.DB_POOL_MAX);
    return Number.isInteger(env) && env > 0 ? env : exports.DEFAULT_POOL_MAX;
}
exports.DEFAULT_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/kiorex_platform?schema=public';
function resolveSsl(sslmode, rootCertPath, env = process.env) {
    if (sslmode === 'no-verify')
        return { rejectUnauthorized: false };
    if (sslmode !== 'require' && sslmode !== 'verify-full' && sslmode !== 'verify-ca')
        return undefined;
    const caPath = (rootCertPath || env.DATABASE_SSL_CA || env.PGSSLROOTCERT || '').trim();
    const verifyCaOnly = sslmode === 'verify-ca';
    if (!caPath || caPath === 'system')
        return verifyCaOnly ? { rejectUnauthorized: true, checkServerIdentity: () => undefined } : true;
    let ca;
    try {
        ca = (0, node_fs_1.readFileSync)(caPath, 'utf8');
    }
    catch (e) {
        throw new Error(`Database TLS: cannot read CA bundle at "${caPath}" (sslrootcert / DATABASE_SSL_CA / PGSSLROOTCERT): ${e.message}`);
    }
    if (!ca.includes('BEGIN CERTIFICATE'))
        throw new Error(`Database TLS: "${caPath}" is not a PEM certificate bundle`);
    return { ca, rejectUnauthorized: true, ...(verifyCaOnly ? { checkServerIdentity: () => undefined } : {}) };
}
function adapterFromUrl(raw = process.env.DATABASE_URL ?? exports.DEFAULT_DB_URL) {
    const url = new URL(raw);
    const schema = url.searchParams.get('schema') ?? undefined;
    const sslmode = url.searchParams.get('sslmode');
    const sslrootcert = url.searchParams.get('sslrootcert');
    const limit = Number(url.searchParams.get('connection_limit'));
    const timeoutSec = Number(url.searchParams.get('connect_timeout'));
    for (const k of ['schema', 'sslmode', 'connection_limit', 'connect_timeout', 'pool_timeout', 'pgbouncer', 'sslrootcert', 'uselibpqcompat'])
        url.searchParams.delete(k);
    const pool = { connectionString: url.toString(), max: resolvePoolMax(limit) };
    pool.connectionTimeoutMillis = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec * 1000 : 5000;
    const ssl = resolveSsl(sslmode, sslrootcert);
    if (ssl !== undefined)
        pool.ssl = ssl;
    return new adapter_pg_1.PrismaPg(pool, schema ? { schema } : undefined);
}
function createPrismaClient(url) {
    return new client_1.PrismaClient({ adapter: adapterFromUrl(url) });
}
//# sourceMappingURL=client-factory.js.map