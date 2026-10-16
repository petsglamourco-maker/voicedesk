import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Loads the repo-root `.env` into process.env (existing vars win).
 * Walks up from the current working directory so it works from any package.
 */
export function loadRootEnv(startDir: string = process.cwd()): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate) && existsSync(join(dir, "pnpm-workspace.yaml"))) {
      process.loadEnvFile(candidate);
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
