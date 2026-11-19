// Generates src/api/schema.d.ts from the real API contract when present, else the provisional one.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const real = path.resolve(root, "../api/openapi/kiorex-api.v1.openapi.json");

if (!existsSync(real)) { console.error(`[gen:api] real contract not found: ${real}`); process.exit(1); }
const src = real;
console.log(`[gen:api] source: ${path.relative(root, src)}`);
execFileSync("npx", ["openapi-typescript", src, "-o", path.join(root, "src/api/schema.d.ts")], { stdio: "inherit", cwd: root });
