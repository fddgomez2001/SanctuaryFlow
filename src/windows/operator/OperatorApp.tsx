import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useNav, type PageId } from "@/app/navigation";
import { api } from "@/services/api";
import { setting, useSettings } from "@/hooks/useSettings";
import { useThemes } from "@/hooks/useThemes";
import { useLive } from "@/services/presentation-engine/store";
import { applyUiTheme } from "@/lib/uiTheme";
import { Sidebar } from "@/components/layout/Sidebar";
import { StatusBar } from "@/components/layout/StatusBar";
import { GlobalSearch, useGlobalSearch } from "@/components/layout/GlobalSearch";
import { StartupErrorScreen } from "@/components/layout/StartupErrorScreen";
import { UiThemeToggle } from "@/components/layout/UiThemeToggle";
import { ConfirmHost } from "@/components/ui/Dialog";
import { Toaster } from "@/components/ui/Toast";
import { Kbd, LoadingBlock } from "@/components/ui/misc";
import { HomePage } from "@/features/home/HomePage";
import { SongLibraryPage } from "@/features/songs/SongLibraryPage";
import { BibleLibraryPage } from "@/features/bible/BibleLibraryPage";
import { ServicesPage } from "@/features/services/ServicesPage";
import { LivePage } from "@/features/live/LivePage";
import { SlideEditorPage } from "@/features/slides/SlideEditorPage";
import { MediaLibraryPage } from "@/features/media/MediaLibraryPage";
import { ThemesPage } from "@/features/themes/ThemesPage";
import { ImportExportPage } from "@/features/import-export/ImportExportPage";
import { BackupPage } from "@/features/backup/BackupPage";
import { SyncPage } from "@/features/sync/SyncPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { useSyncEngine } from "@/features/sync/useSyncEngine";
import { AddToServiceHost } from "@/features/services/AddToServiceDialog";
import { Greeting } from "@/features/home/Greeting";
import { Welcome } from "@/features/welcome/Welcome";

const PAGES: Record<PageId, () => React.JSX.Element> = {
  home: HomePage,
  songs: SongLibraryPage,
  bible: BibleLibraryPage,
  services: ServicesPage,
  live: LivePage,
  slides: SlideEditorPage,
  media: MediaLibraryPage,
  themes: ThemesPage,
  "import-export": ImportExportPage,
  backup: BackupPage,
  sync: SyncPage,
  settings: SettingsPage,
};

export function OperatorApp() {
  const page = useNav((s) => s.page);
  const info = useQuery({ queryKey: ["app-info"], queryFn: api.app.info });
  const settings = useSettings();
  const libraryReady = info.isSuccess && !info.data.startupError;

  useEffect(() => {
    if (libraryReady) void useLive.getState().init();
  }, [libraryReady]);
  useEffect(() => useLive.getState().setSettings(settings.data), [settings.data]);
  // Keep the live output's themes in step with every theme change (theme
  // editor, "Use as theme background", restores, sync).
  const themes = useThemes();
  useEffect(() => {
    if (libraryReady && themes.dataUpdatedAt) void useLive.getState().refreshThemes().catch(() => undefined);
  }, [libraryReady, themes.dataUpdatedAt]);
  const uiTheme = setting<string>(settings.data, "general.uiTheme", "light");
  useEffect(() => {
    if (settings.data) applyUiTheme(uiTheme);
  }, [settings.data, uiTheme]);
  useSyncEngine(libraryReady);

  // Built-in content installed in the background (such as a Bible) shows up without a restart.
  const queryClient = useQueryClient();
  useEffect(() => {
    const un = listen("library://changed", () => void queryClient.invalidateQueries());
    return () => void un.then((u) => u());
  }, [queryClient]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useGlobalSearch.getState().setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (info.isLoading) return <LoadingBlock label="Opening the library…" />;
  if (info.data?.startupError) {
    return (
      <>
        <StartupErrorScreen error={info.data.startupError} />
        <ConfirmHost />
        <Toaster />
      </>
    );
  }

  const Page = PAGES[page];
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center justify-end gap-3 border-b border-border bg-panel/60 px-4">
            <UiThemeToggle />
            <button
              type="button"
              onClick={() => useGlobalSearch.getState().setOpen(true)}
              className="flex h-8 w-80 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm text-subtle hover:border-border-strong"
            >
              <Search className="size-4" />
              <span className="flex-1 text-left">Search songs, Bible, services…</span>
              <Kbd>Ctrl K</Kbd>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <Page />
          </div>
        </main>
      </div>
      <StatusBar />
      <GlobalSearch />
      <AddToServiceHost />
      <Welcome />
      <Greeting />
      <ConfirmHost />
      <Toaster />
    </div>
  );
}
