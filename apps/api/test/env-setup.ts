process.env.NODE_ENV = 'test';
import { testDatabaseUrl } from './db-url';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.JOBS_ENABLED = 'false';
process.env.PSP_MODE = 'sandbox-fake';
process.env.KIORLY_TIMEOUT_MS = '400';
process.env.OIDC_ISSUER = 'http://localhost:4400';
process.env.OIDC_AUDIENCE = 'kiorex-api';
process.env.STORAGE_LOCAL_DIR = '.data/test-vault';
