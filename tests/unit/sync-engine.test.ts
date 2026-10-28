import { describe, expect, it } from "vitest";
import type { ApplyOutcome } from "@/types/generated/ApplyOutcome";
import type { PendingChange } from "@/types/generated/PendingChange";
import type { RemoteRecord } from "@/types/generated/RemoteRecord";
import { backoffMs, META_CURSOR, META_LAST_ERROR, META_LAST_SYNC, runSync, TransportError, type LocalStore, type PushRequest, type PushResult, type SyncTransport } from "@/features/sync/engine";

/** In-memory server with the same rules as the `sync_push` SQL function. */
class FakeServer implements SyncTransport {
  rows = new Map<string, { version: number; deleted: boolean; payload: unknown; device: string; seq: number }>();
  applied = new Map<string, PushResult>();
  seq = 0;
  offline = false;
  authExpired = false;
  pushes = 0;

  async push(c: PushRequest): Promise<PushResult> {
    if (this.offline) throw new TransportError("offline", { retryable: true });
    if (this.authExpired) throw new TransportError("sign in again", { retryable: false, auth: true });
    this.pushes++;
    const prev = this.applied.get(c.opId);
    if (prev) return prev;
    const key = `${c.entityType}:${c.entityId}`;
    const cur = this.rows.get(key);
    if (cur && cur.version !== c.baseVersion && cur.device !== c.deviceId) {
      return {
        status: "conflict",
        remote: { entityType: c.entityType, entityId: c.entityId, version: cur.version, deleted: cur.deleted, payload: cur.payload as RemoteRecord["payload"], updatedByDevice: cur.device, updatedAt: null },
      };
    }
    const version = (cur?.version ?? 0) + 1;
    this.rows.set(key, { version, deleted: c.deleted, payload: c.deleted ? null : c.payload, device: c.deviceId, seq: ++this.seq });
    const result: PushResult = { status: "applied", version };
    this.applied.set(c.opId, result);
    return result;
  }

  async pull(cursor: number, limit: number) {
    if (this.offline) throw new TransportError("offline", { retryable: true });
    const all = [...this.rows.entries()].filter(([, r]) => r.seq > cursor).sort((a, b) => a[1].seq - b[1].seq).slice(0, limit);
    return {
      records: all.map(([k, r]) => {
        const [entityType, entityId] = k.split(":") as [string, string];
        return { entityType, entityId, version: r.version, deleted: r.deleted, payload: r.payload as RemoteRecord["payload"], updatedByDevice: r.device, updatedAt: null };
      }),
      cursor: all.length ? all[all.length - 1]![1].seq : cursor,
      hasMore: all.length >= limit,
    };
  }

  /** Another device writes directly. */
  remoteEdit(entityId: string, payload: unknown, device = "other") {
    const key = `song:${entityId}`;
    const cur = this.rows.get(key);
    this.rows.set(key, { version: (cur?.version ?? 0) + 1, deleted: false, payload, device, seq: ++this.seq });
  }
}

/** Minimal local store mirroring the Rust outbox behaviour. */
class FakeStore implements LocalStore {
  ops: (PendingChange & { status: "pending" | "failed" | "conflict" | "done"; next: string | null })[] = [];
  remoteVersion = new Map<string, number>();
  meta = new Map<string, string>();
  applied: RemoteRecord[] = [];
  conflicts: RemoteRecord[] = [];
  constructor(readonly id = "this-device") {}

  edit(entityId: string, payload: unknown, op: "upsert" | "delete" = "upsert") {
    this.ops = this.ops.filter((o) => !(o.entityId === entityId && o.status !== "done"));
    this.ops.push({
      opId: crypto.randomUUID(),
      entityType: "song",
      entityId,
      operation: op,
      localRevision: 1,
      baseVersion: this.remoteVersion.get(entityId) ?? null,
      payload: op === "delete" ? null : (payload as PendingChange["payload"]),
      retryCount: 0,
      status: "pending",
      next: null,
    });
  }
  async deviceId() {
    return this.id;
  }
  async pending(limit: number, now: string) {
    return this.ops
      .filter((o) => o.status === "pending" || (o.status === "failed" && (!o.next || o.next <= now)))
      .slice(0, limit)
      .map((o) => ({ ...o, baseVersion: this.remoteVersion.get(o.entityId) ?? null }));
  }
  async markPushed(opId: string, version: number) {
    const o = this.ops.find((x) => x.opId === opId);
    if (!o) return;
    o.status = "done";
    this.remoteVersion.set(o.entityId, version);
  }
  async markFailed(opId: string, _error: string, next: string) {
    const o = this.ops.find((x) => x.opId === opId)!;
    o.status = "failed";
    o.retryCount = Number(o.retryCount) + 1;
    o.next = next;
  }
  async markConflict(opId: string, remote: RemoteRecord) {
    this.ops.find((x) => x.opId === opId)!.status = "conflict";
    this.conflicts.push(remote);
  }
  async applyRemote(records: RemoteRecord[]): Promise<ApplyOutcome[]> {
    return records.map((r) => {
      if ((this.remoteVersion.get(r.entityId) ?? 0) >= r.version) return "skipped";
      if (this.ops.some((o) => o.entityId === r.entityId && o.status !== "done")) {
        this.conflicts.push(r);
        return "conflict";
      }
      this.remoteVersion.set(r.entityId, r.version);
      this.applied.push(r);
      return "applied";
    });
  }
  async getMeta(key: string) {
    return this.meta.get(key) ?? null;
  }
  async setMeta(key: string, value: string) {
    this.meta.set(key, value);
  }
}

let clock = Date.parse("2026-11-01T09:00:00Z");
const now = () => new Date(clock);

describe("sync engine", () => {
  it("uploads offline edits once the connection returns, with backoff in between", async () => {
    const server = new FakeServer();
    const store = new FakeStore();
    store.edit("a", { title: "Offline song" });

    server.offline = true;
    const first = await runSync(store, server, { now });
    expect(first.error).toMatch(/offline/);
    expect(first.failed).toBe(1);
    expect(store.meta.get(META_LAST_ERROR)).toMatch(/offline/);
    expect(store.ops[0]!.status).toBe("failed");

    // Still within the backoff window: nothing is retried yet.
    server.offline = false;
    const tooSoon = await runSync(store, server, { now });
    expect(tooSoon.pushed).toBe(0);

    clock += backoffMs(1, () => 1) + 1000;
    const retry = await runSync(store, server, { now });
    expect(retry.error).toBeNull();
    expect(retry.pushed).toBe(1);
    expect(server.rows.get("song:a")?.version).toBe(1);
    expect(store.meta.get(META_LAST_SYNC)).toBe(now().toISOString());
    expect(store.meta.get(META_LAST_ERROR)).toBe("");
  });

  it("is idempotent when a response is lost and the same operation is retried", async () => {
    const server = new FakeServer();
    const store = new FakeStore();
    store.edit("a", { title: "Once" });
    const op = (await store.pending(10, now().toISOString()))[0]!;
    // The server applied it but the client never heard back.
    await server.push({ opId: op.opId, entityType: "song", entityId: "a", baseVersion: null, deleted: false, payload: op.payload, deviceId: store.id });
    const r = await runSync(store, server, { now });
    expect(r.pushed).toBe(1);
    expect(server.rows.get("song:a")?.version).toBe(1);
  });

  it("detects conflicts in both directions and never overwrites silently", async () => {
    const server = new FakeServer();
    const mine = new FakeStore("mine");
    mine.edit("a", { title: "v1" });
    await runSync(mine, server, { now });
    expect(server.rows.get("song:a")?.version).toBe(1);

    // Another device edits; meanwhile I edit too.
    server.remoteEdit("a", { title: "theirs" });
    mine.edit("a", { title: "mine" });
    const r = await runSync(mine, server, { now });
    expect(r.pushConflicts).toBe(1);
    expect(server.rows.get("song:a")?.payload).toEqual({ title: "theirs" });
    expect(mine.conflicts[0]?.payload).toEqual({ title: "theirs" });
  });

  it("downloads remote changes and deletions, resuming from the cursor", async () => {
    const server = new FakeServer();
    const store = new FakeStore();
    for (let i = 0; i < 5; i++) server.remoteEdit(`s${i}`, { title: `Song ${i}` });
    const r = await runSync(store, server, { now });
    expect(r.applied).toBe(5);
    expect(store.meta.get(META_CURSOR)).toBe("5");

    // A deletion arrives as a tombstone.
    const key = "song:s1";
    const row = server.rows.get(key)!;
    server.rows.set(key, { ...row, version: row.version + 1, deleted: true, payload: null, seq: ++server.seq });
    const r2 = await runSync(store, server, { now });
    expect(r2.pulled).toBe(1);
    expect(store.applied.at(-1)).toMatchObject({ entityId: "s1", deleted: true });

    // Local deletion propagates as a delete operation without content.
    store.edit("s2", null, "delete");
    const r3 = await runSync(store, server, { now });
    expect(r3.pushed).toBe(1);
    expect(server.rows.get("song:s2")).toMatchObject({ deleted: true, payload: null });
  });

  it("stops on an authentication failure without losing queued changes", async () => {
    const server = new FakeServer();
    const store = new FakeStore();
    store.edit("a", { title: "x" });
    server.authExpired = true;
    const r = await runSync(store, server, { now });
    expect(r.authRequired).toBe(true);
    expect(r.error).toMatch(/sign in/);
    expect(store.ops[0]!.status).toBe("pending");
    expect(server.pushes).toBe(0);
  });

  it("backs off exponentially up to six hours", () => {
    const fixed = () => 0.5;
    expect(backoffMs(0, fixed)).toBe(30_000);
    expect(backoffMs(1, fixed)).toBe(60_000);
    expect(backoffMs(3, fixed)).toBe(240_000);
    expect(backoffMs(30, fixed)).toBe(6 * 3600_000);
  });
});
