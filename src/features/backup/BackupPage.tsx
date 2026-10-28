import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Archive, CheckCircle2, FolderOpen, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import type { BackupValidation } from "@/types/generated/BackupValidation";
import { api } from "@/services/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog, confirm } from "@/components/ui/Dialog";
import { Checkbox, Field, Input, Select, Switch } from "@/components/ui/Field";
import { Badge, LoadingBlock, PageHeader, Section } from "@/components/ui/misc";
import { toast } from "@/components/ui/Toast";
import { setting, useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { formatBytes, timeAgo } from "@/lib/format";
import { useLive } from "@/services/presentation-engine/store";

export function BackupPage() {
  const qc = useQueryClient();
  const settings = useSettings();
  const update = useUpdateSettings();
  const info = useQuery({ queryKey: ["app-info"], queryFn: api.app.info });
  const history = useQuery({ queryKey: ["backup-history"], queryFn: () => api.backup.history(50) });
  const [includeMedia, setIncludeMedia] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [restore, setRestore] = useState<BackupValidation | null>(null);
  const dir = setting<string | null>(settings.data, "backup.directory", null);
  const media = includeMedia ?? setting(settings.data, "backup.includeMedia", true);

  const create = async () => {
    setCreating(true);
    try {
      const b = await api.backup.create(dir, media);
      toast.success("Backup created", `${formatBytes(b.sizeBytes)} — ${b.path}`);
      await qc.invalidateQueries({ queryKey: ["backup-history"] });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      await qc.invalidateQueries({ queryKey: ["status-dashboard"] });
    } catch (e) {
      toast.error("The backup failed", e);
    } finally {
      setCreating(false);
    }
  };

  const check = async (path: string, forRestore: boolean) => {
    setChecking(path);
    try {
      const v = await api.backup.validate(path);
      if (forRestore) setRestore(v);
      else if (v.valid) toast.success("The backup is valid", `${v.counts?.songs ?? 0} songs, ${v.counts?.servicePlans ?? 0} services, ${v.counts?.translations ?? 0} Bible translations.`);
      else toast.error("The backup has problems", v.issues.join(" "));
    } catch (e) {
      toast.error("The backup could not be checked", e);
    } finally {
      setChecking(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Backup & Restore" description="Keep a complete copy of your library somewhere safe, such as a USB drive." />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-5 p-6">
          <Section title="Create a backup" description="Includes songs, service plans, Bible translations, themes, slides, settings and sync status. Media files are included when selected.">
            <div className="space-y-3">
              <Field label="Backup folder" hint={dir ? undefined : `Default: ${info.data?.backupsDir ?? ""}`}>
                <div className="flex gap-2">
                  <Input readOnly value={dir ?? info.data?.backupsDir ?? ""} />
                  <Button
                    onClick={async () => {
                      const d = await open({ directory: true, title: "Choose a backup folder" });
                      if (typeof d === "string") update.mutate({ "backup.directory": d });
                    }}
                  >
                    Change…
                  </Button>
                  {dir && (
                    <Button variant="ghost" onClick={() => update.mutate({ "backup.directory": null })}>
                      Use default
                    </Button>
                  )}
                </div>
              </Field>
              <Checkbox checked={media} onChange={setIncludeMedia} label="Include media files (images, videos, audio)" />
              <Button variant="primary" icon={<Archive className="size-4" />} loading={creating} onClick={() => void create()}>
                Back up now
              </Button>
            </div>
          </Section>

          <Section title="Scheduled backups" description="Runs in the background while SanctuaryFlow is open. It never interrupts a presentation.">
            <div className="space-y-3">
              <Switch
                checked={setting(settings.data, "backup.scheduleEnabled", false)}
                onChange={(v) => update.mutate({ "backup.scheduleEnabled": v })}
                label="Back up automatically"
              />
              <div className="grid grid-cols-3 gap-3">
                <Field label="How often">
                  <Select value={setting(settings.data, "backup.scheduleIntervalHours", 168)} onChange={(e) => update.mutate({ "backup.scheduleIntervalHours": Number(e.target.value) })}>
                    <option value={24}>Every day</option>
                    <option value={72}>Every 3 days</option>
                    <option value={168}>Every week</option>
                  </Select>
                </Field>
                <Field label="Keep">
                  <Select value={setting(settings.data, "backup.keepCount", 10)} onChange={(e) => update.mutate({ "backup.keepCount": Number(e.target.value) })}>
                    {[3, 5, 10, 20, 50].map((n) => (
                      <option key={n} value={n}>
                        Last {n} backups
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="flex items-end pb-2">
                  <Checkbox checked={setting(settings.data, "backup.includeMedia", true)} onChange={(v) => update.mutate({ "backup.includeMedia": v })} label="Include media" />
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="Restore"
            description="A backup is checked before anything changes. Your current library is backed up first, and is put back automatically if the restore fails."
            actions={
              <Button
                icon={<RotateCcw className="size-4" />}
                onClick={async () => {
                  const p = await open({ title: "Choose a backup", filters: [{ name: "SanctuaryFlow backup", extensions: ["sfbackup"] }] });
                  if (typeof p === "string") void check(p, true);
                }}
              >
                Restore from file…
              </Button>
            }
          >
            <p className="text-xs text-subtle">Restoring replaces the current library with the backup. The projector output keeps showing the current slide while the library is swapped.</p>
          </Section>

          <Section title="Backup history">
            {history.isLoading && <LoadingBlock />}
            {history.data?.length === 0 && <p className="text-sm text-subtle">No backups yet.</p>}
            <ul className="divide-y divide-border">
              {history.data?.map((h) => (
                <li key={h.id} className="flex items-center gap-3 py-2">
                  {h.status === "completed" ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <TriangleAlert className="size-4 shrink-0 text-danger" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {new Date(h.createdAt).toLocaleString()} <span className="text-subtle">({timeAgo(h.createdAt)})</span>
                    </p>
                    <p className="truncate text-xs text-subtle" title={h.path}>
                      {h.kind.replace("_", " ")} · {formatBytes(h.sizeBytes)} · {h.includeMedia ? "with media" : "without media"} · {h.path}
                    </p>
                    {h.errorMessage && <p className="text-xs text-danger">{h.errorMessage}</p>}
                  </div>
                  {!h.fileExists && h.status === "completed" && <Badge tone="warning">File moved or deleted</Badge>}
                  {h.fileExists && h.status === "completed" && (
                    <>
                      <IconButton size="sm" label="Check this backup" icon={<ShieldCheck className="size-3.5" />} disabled={checking === h.path} onClick={() => void check(h.path, false)} />
                      <IconButton size="sm" label="Restore this backup" icon={<RotateCcw className="size-3.5" />} onClick={() => void check(h.path, true)} />
                      <IconButton size="sm" label="Show in folder" icon={<FolderOpen className="size-3.5" />} onClick={() => void revealItemInDir(h.path)} />
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
      <RestoreDialog validation={restore} onClose={() => setRestore(null)} />
    </div>
  );
}

function RestoreDialog({ validation, onClose }: { validation: BackupValidation | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [restoreMedia, setRestoreMedia] = useState(true);
  const [busy, setBusy] = useState(false);
  const v = validation;
  const m = v?.manifest;
  return (
    <Dialog
      open={!!v}
      dismissable={!busy}
      onOpenChange={(o) => !o && onClose()}
      title="Restore backup"
      size="md"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!v?.valid}
            onClick={async () => {
              if (!v) return;
              const ok = await confirm({
                title: "Replace the current library?",
                message: "Everything in the current library will be replaced by this backup. A safety backup of the current library is made first.",
                confirmLabel: "Restore",
                danger: true,
              });
              if (!ok) return;
              setBusy(true);
              try {
                const r = await api.backup.restore(v.path, restoreMedia && !!m?.includeMedia);
                await qc.invalidateQueries();
                await useLive.getState().refresh();
                toast.success("The library was restored", `A copy of the previous library was saved to ${r.safetyBackup}.`);
                onClose();
              } catch (e) {
                toast.error("The restore failed — your previous library is still in place", e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Restore
          </Button>
        </>
      }
    >
      {v && (
        <div className="space-y-3 text-sm">
          {v.valid ? (
            <p className="flex items-center gap-2 text-success">
              <CheckCircle2 className="size-4" /> The backup passed all checks.
            </p>
          ) : (
            <div className="rounded-md border border-danger/40 bg-danger/10 p-3">
              <p className="font-medium">This backup cannot be restored:</p>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {v.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          )}
          {m && (
            <dl className="grid grid-cols-[150px_1fr] gap-y-1">
              <dt className="text-subtle">Created</dt>
              <dd>{new Date(m.createdAt).toLocaleString()}</dd>
              <dt className="text-subtle">App version</dt>
              <dd>{m.appVersion}</dd>
              <dt className="text-subtle">Contents</dt>
              <dd>
                {v.counts?.songs ?? m.counts.songs} songs, {v.counts?.servicePlans ?? m.counts.servicePlans} services, {v.counts?.translations ?? m.counts.translations} Bible translations,{" "}
                {v.counts?.media ?? m.counts.media} media records
              </dd>
              <dt className="text-subtle">Media files</dt>
              <dd>{m.includeMedia ? `${m.media.length} included` : "Not included"}</dd>
            </dl>
          )}
          {m?.includeMedia && <Checkbox checked={restoreMedia} onChange={setRestoreMedia} label="Also restore media files" />}
        </div>
      )}
    </Dialog>
  );
}
