import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { RecordType } from "./schemas.ts";

export const CONFIG_VERSION = 1;

export type Config = {
  configVersion: number;
  nodeUrl: string;
  schemaServiceUrl: string;
  userHash: string;
  schemaHashes: Record<string, string>;
  nodeSocketPath?: string;
};

export function resolveSocketPath(cfg?: { nodeSocketPath?: string }): string {
  const envOverride = process.env.FOLDDB_SOCKET_PATH;
  if (envOverride && envOverride.length > 0) return envOverride;
  if (cfg?.nodeSocketPath && cfg.nodeSocketPath.length > 0) return cfg.nodeSocketPath;
  const home = process.env.FOLDDB_HOME ?? join(homedir(), ".folddb");
  return join(home, "data", "folddb.sock");
}

export function defaultConfigPath(): string {
  const override = process.env.FSITUATIONS_CONFIG;
  if (override && override.length > 0) return override;
  return join(homedir(), ".fsituations", "config.json");
}

export class ConfigMissingError extends Error {
  constructor(path: string) {
    super(`Config not found at ${path}. Run \`fsituations init\` first.`);
    this.name = "ConfigMissingError";
  }
}

export class ConfigInvalidError extends Error {
  constructor(path: string, reason: string) {
    super(`Config at ${path} is invalid: ${reason}. Re-run \`fsituations init\`.`);
    this.name = "ConfigInvalidError";
  }
}

export function readConfig(path: string = defaultConfigPath()): Config {
  if (!existsSync(path)) throw new ConfigMissingError(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigInvalidError(path, `not valid JSON (${msg})`);
  }
  return assertConfigShape(path, parsed);
}

export function writeConfig(config: Config, path: string = defaultConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function schemaHashFor(type: RecordType, cfg: { schemaHashes: Record<string, string> }): string {
  const hash = cfg.schemaHashes[type];
  if (!hash) {
    throw new ConfigInvalidError(defaultConfigPath(), `no canonical hash registered for type "${type}"`);
  }
  return hash;
}

function assertConfigShape(path: string, raw: unknown): Config {
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigInvalidError(path, "not an object");
  }
  const r = raw as Record<string, unknown>;
  for (const key of ["nodeUrl", "userHash"] as const) {
    if (typeof r[key] !== "string" || (r[key] as string).length === 0) {
      throw new ConfigInvalidError(path, `field "${key}" not a non-empty string`);
    }
  }
  const rawHashes = r.schemaHashes;
  if (typeof rawHashes !== "object" || rawHashes === null || Array.isArray(rawHashes)) {
    throw new ConfigInvalidError(path, `field "schemaHashes" must be an object`);
  }
  const schemaHashes: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHashes as Record<string, unknown>)) {
    if (typeof v !== "string" || v.length === 0) {
      throw new ConfigInvalidError(path, `schemaHashes["${k}"] is not a non-empty string`);
    }
    schemaHashes[k] = v;
  }
  const schemaServiceUrl = typeof r.schemaServiceUrl === "string" ? r.schemaServiceUrl : "";
  const nodeSocketPath =
    typeof r.nodeSocketPath === "string" && r.nodeSocketPath.length > 0 ? r.nodeSocketPath : undefined;
  return {
    configVersion: typeof r.configVersion === "number" ? r.configVersion : CONFIG_VERSION,
    nodeUrl: r.nodeUrl as string,
    schemaServiceUrl,
    userHash: r.userHash as string,
    schemaHashes,
    ...(nodeSocketPath ? { nodeSocketPath } : {}),
  };
}
