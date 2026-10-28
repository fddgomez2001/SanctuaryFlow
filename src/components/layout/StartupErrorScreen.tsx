import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { DatabaseBackup, FolderOpen, TriangleAlert } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { confirm } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toast";

/** Shown when the library cannot be opened; offers recovery from a backup. */
export function StartupErrorScreen({ error }: { error: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const restore = async () => {
    const path = await open({ title: "Choose a SanctuaryFlow backup", filters: [{ name: "SanctuaryFlow backup", extensions: ["sfbackup"] }] });
    if (typeof path !== "string") return;
    setBusy(true);
    try {
      const v = await api.backup.validate(path);
      if (!v.valid) {
        toast.error("That backup cannot be used", v.issues.join(" "));
        return;
      }
      const ok = await confirm({
        title: "Restore this backup?",
        message: `The backup from ${v.manifest?.createdAt ?? "an unknown date"} will replace the damaged library. The damaged files are kept next to the library.`,
        confirmLabel: "Restore",
      });
      if (!ok) return;
      await api.backup.restore(path, true);
      toast.success("The library was restored");
      await qc.invalidateQueries();
    } catch (e) {
      toast.error("The restore failed", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="panel max-w-xl p-8">
        <TriangleAlert className="mb-4 size-10 text-warning" />
        <h1 className="text-lg font-semibold">The library could not be opened</h1>
        <p className="mt-2 text-sm text-muted selectable">{error}</p>
        <p className="mt-4 text-sm text-muted">
          Your songs and services have not been deleted. You can restore the most recent backup, or open the library folder to
          inspect the files.
        </p>
        <div className="mt-6 flex gap-2">
          <Button variant="primary" icon={<DatabaseBackup className="size-4" />} loading={busy} onClick={() => void restore()}>
            Restore from backup
          </Button>
          <Button
            icon={<FolderOpen className="size-4" />}
            onClick={async () => {
              const info = await api.app.info();
              await revealItemInDir(info.dbPath);
            }}
          >
            Open library folder
          </Button>
        </div>
      </div>
    </div>
  );
}
