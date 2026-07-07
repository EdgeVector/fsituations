import { existsSync } from "node:fs";

export type Verbose = (msg: string) => void;
const noopVerbose: Verbose = () => {};

export class FsituationsError extends Error {
  readonly code: string;
  readonly hint?: string;
  override readonly cause?: unknown;

  constructor(opts: { code: string; message: string; hint?: string; cause?: unknown }) {
    super(opts.message);
    this.name = "FsituationsError";
    this.code = opts.code;
    this.hint = opts.hint;
    this.cause = opts.cause;
  }
}

export type QueryRow = {
  fields: Record<string, unknown>;
  key: { hash: string | null; range: string | null };
};

export type QueryResponse = {
  ok: boolean;
  results: QueryRow[];
  total_count?: number;
  returned_count?: number;
};

export type QueryFilter = Record<string, string>;

export type LoadedSchema = {
  name: string;
  descriptive_name: string;
  owner_app_id: string;
  fields: string[];
};

export type NodeClient = {
  baseUrl: string;
  userHash: string;
  autoIdentity(): Promise<
    | { provisioned: true; userHash: string }
    | { provisioned: false; reason: string }
  >;
  listSchemas(): Promise<LoadedSchema[]>;
  createRecord(opts: {
    schemaHash: string;
    fields: Record<string, unknown>;
    keyHash: string;
  }): Promise<void>;
  updateRecord(opts: {
    schemaHash: string;
    fields: Record<string, unknown>;
    keyHash: string;
  }): Promise<void>;
  queryAll(opts: {
    schemaHash: string;
    fields: string[];
    filter?: QueryFilter;
  }): Promise<QueryResponse>;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const QUERY_PAGE_SIZE = 1000;
const QUERY_PAGE_LIMIT = 1000;

export function newNodeClient(opts: {
  baseUrl: string;
  userHash: string;
  verbose?: Verbose;
  timeoutMs?: number;
  socketPath?: string;
}): NodeClient {
  const baseUrl = stripTrailingSlash(opts.baseUrl);
  const verbose = opts.verbose ?? noopVerbose;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const socketPath = opts.socketPath;

  const headers = (): Record<string, string> => ({ "X-User-Hash": opts.userHash });

  async function callJson(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const { res, text } = await request({
      baseUrl,
      method,
      path,
      body,
      headers: headers(),
      socketPath,
      timeoutMs,
      verbose,
    });
    return { status: res.status, body: parseBody(text) };
  }

  async function mutate(
    mutationType: "create" | "update",
    schemaHash: string,
    fields: Record<string, unknown>,
    keyHash: string,
  ): Promise<void> {
    const { status, body } = await callJson("POST", "/api/mutation", {
      type: "mutation",
      schema: schemaHash,
      fields_and_values: fields,
      key_value: { hash: keyHash, range: null },
      mutation_type: mutationType,
    });
    if (status !== 200) throw mapNodeError(status, body, "/api/mutation");
  }

  return {
    baseUrl,
    userHash: opts.userHash,
    async autoIdentity() {
      const { status, body } = await callJson("GET", "/api/system/auto-identity");
      if (status === 200) {
        const userHash =
          body && typeof body === "object"
            ? (body as Record<string, unknown>).user_hash
            : undefined;
        return {
          provisioned: true,
          userHash: typeof userHash === "string" ? userHash : opts.userHash,
        };
      }
      if (status === 503) {
        return { provisioned: false, reason: bodyError(body) ?? "node_not_provisioned" };
      }
      throw mapNodeError(status, body, "/api/system/auto-identity");
    },
    async listSchemas() {
      const { status, body } = await callJson("GET", "/api/schemas");
      if (status !== 200) throw mapNodeError(status, body, "/api/schemas");
      const raw =
        body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).schemas)
          ? ((body as Record<string, unknown>).schemas as unknown[])
          : [];
      return raw
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map((schema) => ({
          name: stringField(schema, "name"),
          descriptive_name: stringField(schema, "descriptive_name"),
          owner_app_id: stringField(schema, "owner_app_id"),
          fields: Array.isArray(schema.fields)
            ? schema.fields.filter((field): field is string => typeof field === "string")
            : [],
        }));
    },
    async createRecord({ schemaHash, fields, keyHash }) {
      await mutate("create", schemaHash, fields, keyHash);
    },
    async updateRecord({ schemaHash, fields, keyHash }) {
      await mutate("update", schemaHash, fields, keyHash);
    },
    async queryAll({ schemaHash, fields, filter }) {
      const results: QueryRow[] = [];
      const seen = new Set<string>();
      let offset = 0;
      for (let page = 0; page < QUERY_PAGE_LIMIT; page++) {
        const { status, body } = await callJson("POST", "/api/query", {
          schema_name: schemaHash,
          fields,
          ...(filter ? { filter } : {}),
          limit: QUERY_PAGE_SIZE,
          offset,
        });
        if (status !== 200) throw mapNodeError(status, body, "/api/query");
        const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
        const pageRows = Array.isArray(obj.results) ? (obj.results as QueryRow[]) : [];
        let added = 0;
        for (const row of pageRows) {
          const key = rowKey(row);
          if (seen.has(key)) continue;
          seen.add(key);
          results.push(row);
          added++;
        }
        if (obj.has_more !== true || added === 0) break;
        offset += pageRows.length;
      }
      return { ok: true, results, returned_count: results.length, total_count: results.length };
    },
  };
}

async function request(opts: {
  baseUrl: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  headers: Record<string, string>;
  socketPath?: string;
  timeoutMs: number;
  verbose: Verbose;
}): Promise<{ res: Response; text: string }> {
  const body =
    opts.body === undefined
      ? undefined
      : typeof opts.body === "string"
        ? opts.body
        : JSON.stringify(opts.body);
  const headers = { ...opts.headers };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const useSocket = shouldUseSocket(opts.baseUrl, opts.socketPath);
  const url = useSocket ? `http://localhost${opts.path}` : `${opts.baseUrl}${opts.path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    opts.verbose(`→ NODE ${opts.method} ${url}${useSocket ? ` [unix:${opts.socketPath}]` : ""}`);
    const init: RequestInit & { unix?: string } = {
      method: opts.method,
      headers,
      body,
      signal: controller.signal,
    };
    if (useSocket) init.unix = opts.socketPath;
    const res = await fetch(url, init);
    const text = await res.text();
    opts.verbose(`← NODE ${opts.method} ${url} status=${res.status}`);
    return { res, text };
  } catch (err) {
    throw connectionError(opts.baseUrl, opts.socketPath, err);
  } finally {
    clearTimeout(timer);
  }
}

function shouldUseSocket(baseUrl: string, socketPath?: string): socketPath is string {
  if (!socketPath || !isLoopbackNodeUrl(baseUrl)) return false;
  return existsSync(socketPath);
}

function isLoopbackNodeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

function parseBody(text: string): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function rowKey(row: QueryRow): string {
  return `h:${row.key?.hash ?? ""}|r:${row.key?.range ?? ""}`;
}

function stringField(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  return typeof value === "string" ? value : "";
}

function bodyError(body: unknown): string | undefined {
  if (body && typeof body === "object") {
    const value = (body as Record<string, unknown>).error;
    if (typeof value === "string") return value;
  }
  return undefined;
}

function bodyMessage(body: unknown): string | undefined {
  if (body && typeof body === "object") {
    const value = (body as Record<string, unknown>).message;
    if (typeof value === "string") return value;
  }
  return undefined;
}

function rawBodySuffix(body: unknown): string {
  if (body === null || body === undefined) return "";
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text && text !== "{}" ? `: ${text.slice(0, 300)}` : "";
}

function mapNodeError(status: number, body: unknown, path: string): FsituationsError {
  const code = bodyError(body) ?? `http_${status}`;
  const message = bodyMessage(body) ?? `LastDB node ${path} failed with HTTP ${status}${rawBodySuffix(body)}.`;
  return new FsituationsError({ code, message });
}

function connectionError(baseUrl: string, socketPath: string | undefined, err: unknown): FsituationsError {
  const detail = err instanceof Error ? err.message : String(err);
  return new FsituationsError({
    code: "node_unreachable",
    message: `Could not reach LastDB node at ${baseUrl}${socketPath ? ` via ${socketPath}` : ""}: ${detail}.`,
    cause: err,
  });
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
