// Generates src/api/schema.d.ts (paths + request bodies) from the real Kiorex API spec.
// Source of truth: ../api/openapi/kiorex-api.v1.openapi.json (the API agent regenerates it as routes land).
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const real = join(root, "../api/openapi/kiorex-api.v1.openapi.json");
if (!existsSync(real)) { console.error("Missing", real); process.exit(1); }
mkdirSync(join(root, "openapi"), { recursive: true });
copyFileSync(real, join(root, "openapi/kiorex-api.v1.openapi.json")); // pinned snapshot used for the typed client
execFileSync("npx", ["openapi-typescript", join(root, "openapi/kiorex-api.v1.openapi.json"), "-o", join(root, "src/api/schema.d.ts")], { stdio: "inherit", cwd: root });
