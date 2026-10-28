import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { Cloud, CloudOff, KeyRound, LogOut, RefreshCw, ShieldAlert, Users } from "lucide-react";
import type { SyncConflict } from "@/types/generated/SyncConflict";
import { api } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { confirm } from "@/components/ui/Dialog";
import { Field, Input, Select, Switch, TextField } from "@/components/ui/Field";
import { Badge, ErrorNotice, PageHeader, Section } from "@/components/ui/misc";
import { toast } from "@/components/ui/Toast";
import { useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { useOnline } from "@/hooks/useOnline";
import { timeAgo } from "@/lib/format";
import { errorMessage } from "@/lib/ipc";
import { supabaseClient, toTransportError, validateSupabaseUrl } from "./supabase";
import { syncConfig, useSyncRun } from "./useSyncEngine";

const ENTITY_LABEL: Record<string, string> = { song: "Song", service_plan: "Service", theme: "Theme", slide_deck: "Slides", media_asset: "Media" };

export function SyncPage() {
  const qc = useQueryClient();
  const online = useOnline();
  const settings = useSettings();
  const update = useUpdateSettings();
  const cfg = syncConfig(settings.data);
  const status = useQuery({ queryKey: ["sync-status"], queryFn: api.sync.status, refetchInterval: 15_000 });
  const conflicts = useQuery({ queryKey: ["sync-conflicts"], queryFn: api.sync.conflicts });
  const run = useSyncRun();
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setUrl(cfg.url);
    setAnonKey(cfg.anonKey);
  }, [cfg.url, cfg.anonKey]);

  const configured = !validateSupabaseUrl(cfg.url) && cfg.anonKey.length > 20;
  const sb = configured ? supabaseClient(cfg.url, cfg.anonKey) : null;

  useEffect(() => {
    if (!sb) {
      setSession(null);
      return;
    }
    void sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [sb]);

  const workspaces = useQuery({
    queryKey: ["sync-workspaces", session?.user.id],
    queryFn: async () => {
      const { data, error } = await sb!.from("workspace_members").select("workspace_id, role, workspaces(name)").eq("user_id", session!.user.id);
      if (error) throw toTransportError(error);
      return (data ?? []).map((r) => ({
        id: r.workspace_id as string,
        role: r.role as string,
        name: ((r.workspaces as unknown as { name: string } | null)?.name ?? "Workspace") as string,
      }));
    },
    enabled: !!sb && !!session && online,
  });

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error("That did not work", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const saveProject = () =>
    act("project", async () => {
      const problem = validateSupabaseUrl(url.trim());
      if (problem) throw new Error(problem);
      if (anonKey.trim().length < 20) throw new Error("Paste the project's public anon key.");
      if (/service_role/i.test(atobSafe(anonKey.split(".")[1] ?? ""))) throw new Error("That is a service-role key. Never put it in the app — use the public anon key.");
      update.mutate({ "sync.supabaseUrl": url.trim(), "sync.supabaseAnonKey": anonKey.trim() });
      toast.success("Cloud project saved");
    });

  const chooseWorkspace = async (id: string, name: string) => {
    if (cfg.workspaceId && cfg.workspaceId !== id) {
      const ok = await confirm({
        title: "Switch workspace?",
        message: "Synchronization state is reset. Your local content is kept and will be uploaded to the new workspace.",
        confirmLabel: "Switch",
      });
      if (!ok) return;
      await api.sync.reset();
    }
    update.mutate({ "sync.workspaceId": id, "sync.workspaceName": name });
  };

  const enable = async (on: boolean) => {
    if (on) {
      const n = await api.sync.backfill();
      if (n) toast.info(`${n} item(s) queued to upload`);
    }
    update.mutate({ "sync.enabled": on });
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Synchronization"
        description="Optional. Share songs, services, slides and themes between computers through your church's Supabase project. Presenting never depends on it."
        actions={
          <Button
            variant="primary"
            icon={<RefreshCw className={run.running ? "size-4 animate-spin" : "size-4"} />}
            disabled={!cfg.ready || !session || !online || run.running}
            onClick={async () => {
              const r = await run.run(settings.data);
              if (!r) return;
              if (r.error) toast.error("Synchronization stopped", r.error);
              else toast.success("Synchronized", `${r.pushed} uploaded, ${r.applied} downloaded${r.pushConflicts + r.pullConflicts ? `, ${r.pushConflicts + r.pullConflicts} conflict(s)` : ""}.`);
              void qc.invalidateQueries({ queryKey: ["sync-conflicts"] });
            }}
          >
            Sync now
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-5 p-6">
          <Section title="Status">
            <div className="grid gap-3 text-sm md:grid-cols-4">
              <Stat label="Synchronization" value={cfg.enabled ? (cfg.ready ? "On" : "Needs setup") : "Off"} />
              <Stat label="Last successful sync" value={timeAgo(status.data?.lastSyncAt)} />
              <Stat label="Waiting to upload" value={String((status.data?.pending ?? 0) + (status.data?.failed ?? 0))} />
              <Stat label="Conflicts" value={String(status.data?.conflicts ?? 0)} />
            </div>
            {!online && <p className="mt-3 flex items-center gap-2 text-sm text-warning"><CloudOff className="size-4" /> Offline. Changes are kept and uploaded when the connection returns.</p>}
            {status.data?.lastError && <p className="mt-3 text-sm text-danger">Last error: {status.data.lastError}</p>}
            <div className="mt-4">
              <Switch checked={cfg.enabled} onChange={(v) => void enable(v)} label="Synchronize this computer" description="When off, nothing is sent to or received from the cloud." />
            </div>
          </Section>

          <Section title="Cloud project" description="Create a free Supabase project, run the SanctuaryFlow SQL migration, then paste the project URL and its public anon key. The service-role key must never be used here.">
            <div className="grid gap-3 md:grid-cols-2">
              <TextField label="Project URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://abcd1234.supabase.co" />
              <TextField label="Public anon key" value={anonKey} onChange={(e) => setAnonKey(e.target.value)} placeholder="eyJ…" type="password" />
            </div>
            <Button className="mt-3" icon={<KeyRound className="size-4" />} loading={busy === "project"} onClick={() => void saveProject()}>
              Save project
            </Button>
          </Section>

          {configured && (
            <Section title="Account" description="Each person signs in with their own account. The sign-in is stored encrypted for this Windows user.">
              {session ? (
                <div className="flex items-center gap-3">
                  <p className="text-sm">
                    Signed in as <span className="font-medium">{session.user.email}</span>
                  </p>
                  <Button
                    size="sm"
                    icon={<LogOut className="size-3.5" />}
                    onClick={() =>
                      void act("signout", async () => {
                        await sb!.auth.signOut();
                        toast.success("Signed out");
                      })
                    }
                  >
                    Sign out
                  </Button>
                </div>
              ) : (
                <form
                  className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act("signin", async () => {
                      const { error } = await sb!.auth.signInWithPassword({ email, password });
                      if (error) throw error;
                      setPassword("");
                    });
                  }}
                >
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email" autoComplete="username" />
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="Password" autoComplete="current-password" />
                  <Button type="submit" variant="primary" loading={busy === "signin"} disabled={!online}>
                    Sign in
                  </Button>
                  <Button
                    disabled={!online || !email || password.length < 8}
                    loading={busy === "signup"}
                    onClick={() =>
                      void act("signup", async () => {
                        const { error } = await sb!.auth.signUp({ email, password });
                        if (error) throw error;
                        toast.info("Account created", "Check your email to confirm the account if your project requires it, then sign in.");
                      })
                    }
                  >
                    Create account
                  </Button>
                </form>
              )}
            </Section>
          )}

          {session && (
            <Section title="Church workspace" description="Everyone in the same workspace shares the same songs, services, slides and themes.">
              {workspaces.isError && <ErrorNotice title="Workspaces could not be loaded" message={errorMessage(workspaces.error)} />}
              <div className="space-y-3">
                <Field label="Workspace">
                  <Select
                    value={cfg.workspaceId}
                    onChange={(e) => {
                      const w = workspaces.data?.find((x) => x.id === e.target.value);
                      if (w) void chooseWorkspace(w.id, w.name);
                    }}
                  >
                    <option value="">Choose…</option>
                    {workspaces.data?.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.role})
                      </option>
                    ))}
                  </Select>
                </Field>
                <WorkspaceActions
                  sbAvailable={!!sb}
                  onCreate={(name) =>
                    act("create", async () => {
                      const { data, error } = await sb!.rpc("create_workspace", { p_name: name });
                      if (error) throw toTransportError(error);
                      await workspaces.refetch();
                      await chooseWorkspace(String(data), name);
                    })
                  }
                  onJoin={(code) =>
                    act("join", async () => {
                      const { data, error } = await sb!.rpc("accept_workspace_invite", { p_code: code });
                      if (error) throw toTransportError(error);
                      const list = await workspaces.refetch();
                      const w = list.data?.find((x) => x.id === data);
                      await chooseWorkspace(String(data), w?.name ?? "Workspace");
                    })
                  }
                  onInvite={
                    workspaces.data?.find((w) => w.id === cfg.workspaceId)?.role === "owner"
                      ? (role) =>
                          act("invite", async () => {
                            const { data, error } = await sb!.rpc("create_workspace_invite", { p_workspace: cfg.workspaceId, p_role: role, p_days: 7 });
                            if (error) throw toTransportError(error);
                            await navigator.clipboard.writeText(String(data));
                            toast.success(`Invite code ${data} copied`, "Share it with your team. It works for 7 days.");
                          })
                      : null
                  }
                />
              </div>
            </Section>
          )}

          <Section title="Conflicts" description="When the same item was changed on two computers, nothing is overwritten until you choose.">
            {conflicts.data?.length === 0 && <p className="text-sm text-subtle">No conflicts.</p>}
            <div className="space-y-2">
              {conflicts.data?.map((c) => (
                <ConflictRow key={c.id} conflict={c} onResolved={() => void qc.invalidateQueries({ queryKey: ["sync-conflicts"] })} />
              ))}
            </div>
          </Section>

          <Section title="Advanced">
            <p className="mb-3 text-sm text-muted">
              Media files themselves are not uploaded; their titles and tags synchronize, and a file is matched on another computer when the same file is imported there. Bible translations are not synchronized because their licenses differ — install them on each computer.
            </p>
            <Button
              variant="outline"
              icon={<ShieldAlert className="size-4" />}
              onClick={async () => {
                if (!(await confirm({ title: "Reset synchronization?", message: "Sync history is cleared and all local content is queued to upload again. Local content is not deleted.", confirmLabel: "Reset" }))) return;
                await api.sync.reset();
                await qc.invalidateQueries({ queryKey: ["sync-status"] });
                toast.success("Synchronization state was reset");
              }}
            >
              Reset synchronization state
            </Button>
          </Section>
        </div>
      </div>
    </div>
  );
}

function atobSafe(s: string): string {
  try {
    return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return "";
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2">
      <p className="text-xs text-subtle">{label}</p>
      <p className="text-base font-semibold">{value}</p>
    </div>
  );
}

function WorkspaceActions({
  sbAvailable,
  onCreate,
  onJoin,
  onInvite,
}: {
  sbAvailable: boolean;
  onCreate: (name: string) => void;
  onJoin: (code: string) => void;
  onInvite: ((role: "editor" | "viewer") => void) | null;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New workspace name" aria-label="New workspace name" />
        <Button icon={<Cloud className="size-4" />} disabled={!sbAvailable || !name.trim()} onClick={() => onCreate(name.trim())}>
          Create
        </Button>
      </div>
      <div className="flex gap-2">
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Invite code" aria-label="Invite code" />
        <Button icon={<Users className="size-4" />} disabled={!sbAvailable || !code.trim()} onClick={() => onJoin(code.trim())}>
          Join
        </Button>
      </div>
      {onInvite && (
        <div className="flex gap-2 md:col-span-2">
          <Button size="sm" onClick={() => onInvite("editor")}>
            Invite an editor
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onInvite("viewer")}>
            Invite a viewer (read-only)
          </Button>
        </div>
      )}
    </div>
  );
}

function ConflictRow({ conflict, onResolved }: { conflict: SyncConflict; onResolved: () => void }) {
  const [busy, setBusy] = useState(false);
  const resolve = async (r: "keep_local" | "keep_remote" | "keep_both") => {
    setBusy(true);
    try {
      await api.sync.resolve(conflict.id, r);
      toast.success("Conflict resolved");
      onResolved();
    } catch (e) {
      toast.error("Could not resolve the conflict", e);
    } finally {
      setBusy(false);
    }
  };
  const remoteTitle = (conflict.remotePayload as { title?: string; name?: string } | null)?.title ?? (conflict.remotePayload as { name?: string } | null)?.name;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
      <Badge>{ENTITY_LABEL[conflict.entityType] ?? conflict.entityType}</Badge>
      <div className="min-w-0 flex-1 text-sm">
        <p className="truncate">{conflict.title}</p>
        <p className="text-xs text-subtle">
          {conflict.remoteDeleted ? "Deleted on another computer" : `Other version: “${remoteTitle ?? "untitled"}”`} · detected {timeAgo(conflict.detectedAt)}
        </p>
      </div>
      <Button size="sm" disabled={busy} onClick={() => void resolve("keep_local")}>
        Keep mine
      </Button>
      <Button size="sm" disabled={busy} onClick={() => void resolve("keep_remote")}>
        Keep theirs
      </Button>
      {!conflict.remoteDeleted && conflict.entityType !== "media_asset" && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void resolve("keep_both")}>
          Keep both
        </Button>
      )}
    </div>
  );
}
