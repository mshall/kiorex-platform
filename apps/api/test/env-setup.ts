process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/kiorex_platform_test?schema=public';
process.env.JOBS_ENABLED = 'false';
process.env.PSP_MODE = 'sandbox-fake';
process.env.KIORLY_TIMEOUT_MS = '400';
process.env.OIDC_ISSUER = 'http://localhost:4400';
process.env.OIDC_AUDIENCE = 'kiorex-api';
process.env.STORAGE_LOCAL_DIR = '.data/test-vault';
