process.env.NODE_ENV = 'test';
import { testDatabaseUrl } from './db-url';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.JOBS_ENABLED = 'false';
process.env.PSP_MODE = 'sandbox-fake';
process.env.KIORLY_TIMEOUT_MS = '400';
process.env.OIDC_ISSUER = 'http://localhost:4400';
process.env.OIDC_AUDIENCE = 'kiorex-api';
// per-run private vault directory (like the per-run database): two jest runs on one machine must not share encrypted files
process.env.STORAGE_LOCAL_DIR = `.data/test-vault-${process.pid}`;

// MSG-REAL / launch guide 13.4: tests may exercise real adapters against fake vendors; production ignores this flag (common/providers/real-mode-gate.ts). Gate tests unset it.
process.env.INTEGRATION_MODE_GATE_BYPASS = 'true';
