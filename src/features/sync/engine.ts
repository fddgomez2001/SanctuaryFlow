/**
 * Synchronization engine: uploads the local outbox, then downloads remote
 * changes. Storage and network are behind interfaces so the engine can be
 * tested without a server. It never touches presentation state.
 */
import type { ApplyOutcome } from "@/types/generated/ApplyOutcome";
import type { PendingChange } from "@/types/generated/PendingChange";
import type { RemoteRecord } from "@/types/generated/RemoteRecord";

export interface PushRequest {
  opId: string;
  entityType: string;
  entityId: string;
  baseVersion: number | null;
  deleted: boolean;
  payload: unknown | null;
  deviceId: string;
}

export type PushResult = { status: "applied"; version: number } | { status: "conflict"; remote: RemoteRecord };

export interface PullPage {
  records: RemoteRecord[];
  cursor: number;
  hasMore: boolean;
}

export interface SyncTransport {
  push(change: PushRequest): Promise<PushResult>;
  pull(cursor: number, limit: number): Promise<PullPage>;
}

export interface LocalStore {
  deviceId(): Promise<string>;
  pending(limit: number, now: string): Promise<PendingChange[]>;
  markPushed(opId: string, version: number): Promise<void>;
  markFailed(opId: string, error: string, nextAttemptAt: string): Promise<void>;
  markConflict(opId: string, remote: RemoteRecord): Promise<void>;
  applyRemote(records: RemoteRecord[]): Promise<ApplyOutcome[]>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
}

/** Network / server failure. `auth` means the user must sign in again. */
export class TransportError extends Error {
  readonly retryable: boolean;
  readonly auth: boolean;

  constructor(message: string, opts: { retryable: boolean; auth?: boolean }) {
    super(message);
    this.name = "TransportError";
    this.retryable = opts.retryable;
    this.auth = opts.auth ?? false;
  }
}

export interface SyncReport {
  pushed: number;
  pushConflicts: number;
  failed: number;
  pulled: number;
  applied: number;
  pullConflicts: number;
  error: string | null;
  authRequired: boolean;
}

/** Exponential backoff with jitter: 30 s, 1 min, 2 min … capped at 6 hours. */
export function backoffMs(retryCount: number, random: () => number = Math.random): number {
  const base = Math.min(6 * 3600_000, 30_000 * 2 ** Math.max(0, retryCount));
  return Math.round(base * (0.8 + 0.4 * random()));
}

export const META_CURSOR = "pull_cursor";
export const META_LAST_SYNC = "last_sync_at";
export const META_LAST_ERROR = "last_error";

export async function runSync(
  store: LocalStore,
  transport: SyncTransport,
  opts: { now?: () => Date; batchSize?: number; maxBatches?: number } = {},
): Promise<SyncReport> {
  const now = opts.now ?? (() => new Date());
  const batchSize = opts.batchSize ?? 50;
  const maxBatches = opts.maxBatches ?? 40;
  const report: SyncReport = { pushed: 0, pushConflicts: 0, failed: 0, pulled: 0, applied: 0, pullConflicts: 0, error: null, authRequired: false };
  const deviceId = await store.deviceId();

  const fail = async (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    report.error = message;
    report.authRequired = e instanceof TransportError && e.auth;
    await store.setMeta(META_LAST_ERROR, message).catch(() => undefined);
  };

  // 1. Upload local changes.
  try {
    const attempted = new Set<string>();
    for (let batch = 0; batch < maxBatches; batch++) {
      const pending = (await store.pending(batchSize, now().toISOString())).filter((p) => !attempted.has(p.opId));
      if (pending.length === 0) break;
      for (const change of pending) {
        attempted.add(change.opId);
        let result: PushResult;
        try {
          result = await transport.push({
            opId: change.opId,
            entityType: change.entityType,
            entityId: change.entityId,
            baseVersion: change.baseVersion,
            deleted: change.operation === "delete",
            payload: change.operation === "delete" ? null : change.payload,
            deviceId,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (e instanceof TransportError && e.auth) throw e;
          const next = new Date(now().getTime() + backoffMs(Number(change.retryCount)));
          await store.markFailed(change.opId, message, next.toISOString());
          report.failed++;
          // A network outage affects everything: stop and retry later.
          if (!(e instanceof TransportError) || e.retryable) throw e;
          continue;
        }
        if (result.status === "applied") {
          await store.markPushed(change.opId, result.version);
          report.pushed++;
        } else {
          await store.markConflict(change.opId, result.remote);
          report.pushConflicts++;
        }
      }
    }
  } catch (e) {
    await fail(e);
    return report;
  }

  // 2. Download remote changes.
  try {
    let cursor = Number((await store.getMeta(META_CURSOR)) ?? "0") || 0;
    for (let page = 0; page < maxBatches; page++) {
      const result = await transport.pull(cursor, 200);
      if (result.records.length) {
        const outcomes = await store.applyRemote(result.records);
        report.pulled += result.records.length;
        report.applied += outcomes.filter((o) => o === "applied").length;
        report.pullConflicts += outcomes.filter((o) => o === "conflict").length;
      }
      if (result.cursor > cursor) {
        cursor = result.cursor;
        await store.setMeta(META_CURSOR, String(cursor));
      }
      if (!result.hasMore) break;
    }
  } catch (e) {
    await fail(e);
    return report;
  }

  await store.setMeta(META_LAST_SYNC, now().toISOString());
  await store.setMeta(META_LAST_ERROR, "");
  return report;
}
