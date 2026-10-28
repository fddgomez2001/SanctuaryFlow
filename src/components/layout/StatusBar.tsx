import { useQuery } from "@tanstack/react-query";
import { Archive, CircleAlert, Cloud, CloudOff, Database, Monitor, Wifi, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { navigate } from "@/app/navigation";
import { api } from "@/services/api";
import { useOnline } from "@/hooks/useOnline";
import { setting, useSettings } from "@/hooks/useSettings";
import { useLive } from "@/services/presentation-engine/store";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";

function Item({ icon, children, tone = "muted", onClick, tip }: { icon: ReactNode; children: ReactNode; tone?: "muted" | "ok" | "warn" | "bad" | "live"; onClick?: () => void; tip?: string }) {
  const color = { muted: "text-muted", ok: "text-success", warn: "text-warning", bad: "text-danger", live: "text-red-400 light:text-live" }[tone];
  const body = (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex items-center gap-1.5 rounded px-2 py-0.5 text-[12px] text-muted hover:enabled:bg-elevated hover:enabled:text-text [&>svg]:size-3.5"
    >
      <span className={cn("flex", color)}>{icon}</span>
      {children}
    </button>
  );
  return tip ? <Tooltip content={tip}>{body}</Tooltip> : body;
}

export function StatusBar() {
  const online = useOnline();
  const settings = useSettings();
  const syncEnabled = setting(settings.data, "sync.enabled", false);
  const info = useQuery({ queryKey: ["app-info"], queryFn: api.app.info, refetchInterval: 60_000 });
  const dash = useQuery({
    queryKey: ["status-dashboard"],
    queryFn: () => api.app.dashboard(new Date().toISOString().slice(0, 10)),
    refetchInterval: 30_000,
    enabled: !info.data?.startupError,
  });
  const projector = useLive((s) => s.projector);
  const displays = useLive((s) => s.displays);
  const live = useLive((s) => s.engine.live !== null);
  const output = useLive((s) => s.engine.output);
  const publishError = useLive((s) => s.publishError);

  const display = displays.find((d) => d.id === projector.displayId);
  const lastBackup = dash.data?.lastBackupAt ?? null;
  const backupOld = !lastBackup || Date.now() - Date.parse(lastBackup) > 14 * 24 * 3600 * 1000;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-1 border-t border-border bg-panel px-2">
      {info.data?.startupError ? (
        <Item icon={<CircleAlert />} tone="bad">
          Library unavailable
        </Item>
      ) : (
        <Item icon={<Database />} tone="ok" tip={info.data ? `Library: ${info.data.dataDir}` : undefined}>
          Library ready
        </Item>
      )}
      <Item icon={online ? <Wifi /> : <WifiOff />} tone={online ? "ok" : "warn"} tip="Presenting never needs the internet. Only cloud sync and Bible downloads use it.">
        {online ? "Online" : "Offline"}
      </Item>
      <Item
        icon={<Monitor />}
        tone={projector.waitingForDisplay ? "warn" : projector.open ? (live && output === "normal" ? "live" : "ok") : "muted"}
        onClick={() => void navigate("live")}
      >
        {projector.waitingForDisplay
          ? "Output display disconnected — waiting"
          : projector.open
            ? `Output on ${display ? display.name : "display"}${output !== "normal" ? ` · ${output}` : ""}`
            : "Output off"}
      </Item>
      {publishError && (
        <Item icon={<CircleAlert />} tone="bad" tip={publishError}>
          Output update failed
        </Item>
      )}
      <div className="flex-1" />
      <Item
        icon={syncEnabled ? <Cloud /> : <CloudOff />}
        tone={!syncEnabled ? "muted" : (dash.data?.syncConflicts ?? 0) > 0 ? "warn" : "ok"}
        onClick={() => void navigate("sync")}
      >
        {!syncEnabled
          ? "Sync off"
          : (dash.data?.syncConflicts ?? 0) > 0
            ? `${dash.data?.syncConflicts} sync conflict(s)`
            : (dash.data?.pendingSyncOperations ?? 0) > 0
              ? `${dash.data?.pendingSyncOperations} change(s) to sync`
              : `Synced ${timeAgo(dash.data?.lastSyncAt)}`}
      </Item>
      <Item icon={<Archive />} tone={backupOld ? "warn" : "muted"} onClick={() => void navigate("backup")}>
        {lastBackup ? `Backup ${timeAgo(lastBackup)}` : "No backup yet"}
      </Item>
    </footer>
  );
}
