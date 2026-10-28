import { useEffect } from "react";
import { create } from "zustand";
import { api, type SettingsMap } from "@/services/api";
import { queryClient } from "@/app/queryClient";
import { useLive } from "@/services/presentation-engine/store";
import { setting, useSettings } from "@/hooks/useSettings";
import { runSync, type LocalStore, type SyncReport } from "./engine";
import { SupabaseTransport, supabaseClient, validateSupabaseUrl } from "./supabase";

interface SyncRunState {
  running: boolean;
  lastReport: SyncReport | null;
  lastRunAt: string | null;
  run: (settings: SettingsMap | undefined) => Promise<SyncReport | null>;
}

export const localStore: LocalStore = {
  deviceId: async () => (await api.sync.status()).deviceId,
  pending: (limit, now) => api.sync.pending(limit, now),
  markPushed: (opId, version) => api.sync.markPushed(opId, version),
  markFailed: (opId, error, next) => api.sync.markFailed(opId, error, next),
  markConflict: (opId, remote) => api.sync.markConflict(opId, remote),
  applyRemote: (records) => api.sync.applyRemote(records),
  getMeta: (key) => api.sync.getMeta(key),
  setMeta: (key, value) => api.sync.setMeta(key, value),
};

export function syncConfig(settings: SettingsMap | undefined) {
  const url = setting(settings, "sync.supabaseUrl", "").trim();
  const anonKey = setting(settings, "sync.supabaseAnonKey", "").trim();
  const workspaceId = setting(settings, "sync.workspaceId", "").trim();
  const enabled = setting(settings, "sync.enabled", false);
  const ready = enabled && !validateSupabaseUrl(url) && anonKey.length > 20 && workspaceId.length > 0;
  return { url, anonKey, workspaceId, enabled, ready };
}

export const useSyncRun = create<SyncRunState>((set, get) => ({
  running: false,
  lastReport: null,
  lastRunAt: null,
  async run(settings) {
    const cfg = syncConfig(settings);
    if (!cfg.ready || get().running || !navigator.onLine) return null;
    const sb = supabaseClient(cfg.url, cfg.anonKey);
    const { data } = await sb.auth.getSession();
    if (!data.session) return null;
    set({ running: true });
    try {
      const report = await runSync(localStore, new SupabaseTransport(sb, cfg.workspaceId));
      set({ lastReport: report, lastRunAt: new Date().toISOString() });
      if (report.applied > 0) {
        // Remote changes arrived: refresh library views and what is being presented.
        void queryClient.invalidateQueries();
        if (useLive.getState().ready) void useLive.getState().refresh();
      } else {
        void queryClient.invalidateQueries({ queryKey: ["sync-status"] });
        void queryClient.invalidateQueries({ queryKey: ["status-dashboard"] });
      }
      return report;
    } finally {
      set({ running: false });
    }
  },
}));

const INTERVAL_MS = 2 * 60_000;

/** Background synchronization: periodic, and whenever the network returns. */
export function useSyncEngine(active: boolean) {
  const settings = useSettings();
  const cfg = syncConfig(settings.data);
  useEffect(() => {
    if (!active || !cfg.ready) return;
    const tick = () => void useSyncRun.getState().run(settings.data).catch(() => undefined);
    const first = setTimeout(tick, 5_000);
    const timer = setInterval(tick, INTERVAL_MS);
    window.addEventListener("online", tick);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("online", tick);
    };
  }, [active, cfg.ready, cfg.url, cfg.anonKey, cfg.workspaceId, settings.data]);
}
