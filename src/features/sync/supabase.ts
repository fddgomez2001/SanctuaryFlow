import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RemoteRecord } from "@/types/generated/RemoteRecord";
import { api } from "@/services/api";
import { TransportError, type PullPage, type PushRequest, type PushResult, type SyncTransport } from "./engine";

const SESSION_KEY = "supabase-session";

/**
 * Session storage for Supabase Auth backed by Windows DPAPI (via the Rust
 * secure store), so tokens are never kept in plain browser storage.
 */
const secureStorage = {
  getItem: (_key: string) => api.secure.get(SESSION_KEY),
  setItem: (_key: string, value: string) => api.secure.set(SESSION_KEY, value),
  removeItem: (_key: string) => api.secure.remove(SESSION_KEY),
};

let client: SupabaseClient | null = null;
let clientKey = "";

export function validateSupabaseUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return "The project URL must start with https://";
    if (!/\.supabase\.(co|in)$/.test(u.hostname)) return "Use your project URL from the Supabase dashboard (https://<project>.supabase.co).";
    return null;
  } catch {
    return "Enter a valid URL, e.g. https://abcd1234.supabase.co";
  }
}

/** One client per project configuration. Only the public anon key is used. */
export function supabaseClient(url: string, anonKey: string): SupabaseClient {
  const key = `${url}|${anonKey}`;
  if (client && clientKey === key) return client;
  client = createClient(url, anonKey, {
    auth: { storage: secureStorage, storageKey: "sanctuaryflow-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  clientKey = key;
  return client;
}

interface PgError {
  message: string;
  code?: string;
  status?: number;
}

export function toTransportError(error: PgError | Error | unknown): TransportError {
  const e = error as PgError;
  const message = e?.message ?? String(error);
  if (/fetch|network|timed? ?out|ECONN|Failed to fetch|Load failed/i.test(message)) {
    return new TransportError("Cannot reach the cloud service. Changes will upload when the connection returns.", { retryable: true });
  }
  if (e?.code === "PGRST301" || e?.status === 401 || /JWT|token|not authenticated|sign in required/i.test(message)) {
    return new TransportError("Your sign-in has expired. Sign in again to resume synchronization.", { retryable: false, auth: true });
  }
  if (e?.code === "42501") {
    return new TransportError(message || "You do not have permission to change this workspace.", { retryable: false, auth: true });
  }
  if (e?.code === "54000" || e?.code === "22023") return new TransportError(message, { retryable: false });
  if ((e?.status ?? 0) >= 500) return new TransportError(`The cloud service had a problem (${message}). It will be retried.`, { retryable: true });
  return new TransportError(message, { retryable: false });
}

interface PullRow {
  entity_type: string;
  entity_id: string;
  version: number;
  deleted: boolean;
  payload: unknown;
  updated_by_device: string | null;
  updated_at: string;
  change_seq: number;
}

export class SupabaseTransport implements SyncTransport {
  private readonly sb: SupabaseClient;
  private readonly workspaceId: string;

  constructor(sb: SupabaseClient, workspaceId: string) {
    this.sb = sb;
    this.workspaceId = workspaceId;
  }

  async push(c: PushRequest): Promise<PushResult> {
    let res;
    try {
      res = await this.sb.rpc("sync_push", {
        p_workspace: this.workspaceId,
        p_op_id: c.opId,
        p_entity_type: c.entityType,
        p_entity_id: c.entityId,
        p_base_version: c.baseVersion,
        p_deleted: c.deleted,
        p_payload: c.payload,
        p_device_id: c.deviceId,
      });
    } catch (e) {
      throw toTransportError(e);
    }
    if (res.error) throw toTransportError({ ...res.error, status: res.status });
    const data = res.data as { status: string; version?: number; remote?: Record<string, unknown> };
    if (data.status === "applied" && typeof data.version === "number") return { status: "applied", version: data.version };
    if (data.status === "conflict" && data.remote) {
      const r = data.remote;
      return {
        status: "conflict",
        remote: {
          entityType: String(r.entityType),
          entityId: String(r.entityId),
          version: Number(r.version),
          deleted: Boolean(r.deleted),
          payload: (r.payload ?? null) as RemoteRecord["payload"],
          updatedByDevice: (r.updatedByDevice as string | null) ?? null,
          updatedAt: (r.updatedAt as string | null) ?? null,
        },
      };
    }
    throw new TransportError("Unexpected response from the cloud service.", { retryable: false });
  }

  async pull(cursor: number, limit: number): Promise<PullPage> {
    let res;
    try {
      res = await this.sb.rpc("sync_pull", { p_workspace: this.workspaceId, p_cursor: cursor, p_limit: limit });
    } catch (e) {
      throw toTransportError(e);
    }
    if (res.error) throw toTransportError({ ...res.error, status: res.status });
    const rows = (res.data ?? []) as PullRow[];
    return {
      records: rows.map((r) => ({
        entityType: r.entity_type,
        entityId: r.entity_id,
        version: Number(r.version),
        deleted: r.deleted,
        payload: (r.payload ?? null) as RemoteRecord["payload"],
        updatedByDevice: r.updated_by_device,
        updatedAt: r.updated_at,
      })),
      cursor: rows.length ? Math.max(cursor, ...rows.map((r) => Number(r.change_seq))) : cursor,
      hasMore: rows.length >= limit,
    };
  }
}
