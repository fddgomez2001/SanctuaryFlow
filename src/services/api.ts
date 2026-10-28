/**
 * Typed wrappers for every Rust command. Argument names are camelCase here;
 * Tauri maps them to the snake_case parameters in Rust.
 */
import { invoke } from "@tauri-apps/api/core";
import { call, toAppError } from "@/lib/ipc";
import type { BackupHistoryEntry } from "@/types/generated/BackupHistoryEntry";
import type { BackupInfo } from "@/types/generated/BackupInfo";
import type { BackupManifest } from "@/types/generated/BackupManifest";
import type { BackupValidation } from "@/types/generated/BackupValidation";
import type { BibleBookInfo } from "@/types/generated/BibleBookInfo";
import type { BibleSearchQuery } from "@/types/generated/BibleSearchQuery";
import type { BibleSearchResult } from "@/types/generated/BibleSearchResult";
import type { ConflictResolution } from "@/types/generated/ConflictResolution";
import type { DashboardSummary } from "@/types/generated/DashboardSummary";
import type { DeckCategory } from "@/types/generated/DeckCategory";
import type { ApplyOutcome } from "@/types/generated/ApplyOutcome";
import type { ImportJob } from "@/types/generated/ImportJob";
import type { ImportOptions } from "@/types/generated/ImportOptions";
import type { ImportPreview } from "@/types/generated/ImportPreview";
import type { ImportResult } from "@/types/generated/ImportResult";
import type { LibraryImportResult } from "@/types/generated/LibraryImportResult";
import type { MediaAsset } from "@/types/generated/MediaAsset";
import type { MediaFolder } from "@/types/generated/MediaFolder";
import type { MediaDetailsInput } from "@/types/generated/MediaDetailsInput";
import type { MediaImportResult } from "@/types/generated/MediaImportResult";
import type { MediaProbe } from "@/types/generated/MediaProbe";
import type { MediaPurpose } from "@/types/generated/MediaPurpose";
import type { MediaQuery } from "@/types/generated/MediaQuery";
import type { Passage } from "@/types/generated/Passage";
import type { PassageRef } from "@/types/generated/PassageRef";
import type { PendingChange } from "@/types/generated/PendingChange";
import type { RemoteRecord } from "@/types/generated/RemoteRecord";
import type { SavedPassage } from "@/types/generated/SavedPassage";
import type { SavePassageInput } from "@/types/generated/SavePassageInput";
import type { ServiceImportResult } from "@/types/generated/ServiceImportResult";
import type { ServicePlan } from "@/types/generated/ServicePlan";
import type { ServicePlanDocument } from "@/types/generated/ServicePlanDocument";
import type { ServicePlanQuery } from "@/types/generated/ServicePlanQuery";
import type { ServicePlanSummary } from "@/types/generated/ServicePlanSummary";
import type { DuplicatePlanOptions } from "@/types/generated/DuplicatePlanOptions";
import type { SlideDeck } from "@/types/generated/SlideDeck";
import type { SlideDeckDocument } from "@/types/generated/SlideDeckDocument";
import type { SlideDeckSummary } from "@/types/generated/SlideDeckSummary";
import type { Song } from "@/types/generated/Song";
import type { SongDocument } from "@/types/generated/SongDocument";
import type { SongFacets } from "@/types/generated/SongFacets";
import type { SongImportDecision } from "@/types/generated/SongImportDecision";
import type { SongImportPreview } from "@/types/generated/SongImportPreview";
import type { SongImportResult } from "@/types/generated/SongImportResult";
import type { SongListResult } from "@/types/generated/SongListResult";
import type { SongQuery } from "@/types/generated/SongQuery";
import type { SongSectionInput } from "@/types/generated/SongSectionInput";
import type { SyncConflict } from "@/types/generated/SyncConflict";
import type { SyncStatus } from "@/types/generated/SyncStatus";
import type { Theme } from "@/types/generated/Theme";
import type { ThemeDocument } from "@/types/generated/ThemeDocument";
import type { Translation } from "@/types/generated/Translation";
import type { TranslationMetadataInput } from "@/types/generated/TranslationMetadataInput";
import type { ValidationReport } from "@/types/generated/ValidationReport";
import type { Verse } from "@/types/generated/Verse";
import { songChanged } from "@/lib/library-events";

// ---------------------------------------------------------------------------
// Types for commands defined only in the app crate
// ---------------------------------------------------------------------------

export interface AppInfo {
  version: string;
  dataDir: string;
  mediaDir: string;
  backupsDir: string;
  dbPath: string;
  dbSizeBytes: number;
  freeDiskBytes: number | null;
  schemaVersion: number;
  deviceId: string | null;
  startupError: string | null;
  notices: string[];
}

export interface DisplayInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
}

export type ProjectorMode = "fullscreen" | "window";

export interface ProjectorStatus {
  open: boolean;
  visible: boolean;
  mode: ProjectorMode | null;
  displayId: string | null;
  waitingForDisplay: boolean;
}

export interface RecoveryFile {
  render: unknown | null;
  session: unknown | null;
  savedAt: string | null;
}

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  homepage: string;
  requiresApiKey: boolean;
  allowsBulkDownload: boolean;
}

export interface ProviderTranslation {
  providerId: string;
  id: string;
  suggestedCode: string;
  title: string;
  shortTitle: string;
  languageCode: string;
  languageName: string;
  copyright: string;
  publicDomain: boolean;
  redistributable: boolean;
  otBooks: number;
  ntBooks: number;
  dcBooks: number;
  updated: string;
  textDirection: string;
  detailsUrl: string;
}

export interface ProviderCatalog {
  translations: ProviderTranslation[];
  fromCache: boolean;
  fetchedAt: string | null;
}

export interface ImportPreviewResponse {
  token: string;
  preview: ImportPreview;
  suggestedMetadata: TranslationMetadataInput;
  licenseText: string | null;
}

export interface MediaImportOutcome {
  path: string;
  result: MediaImportResult | null;
  error: string | null;
}

export interface RestoreOutcome {
  manifest: BackupManifest;
  safetyBackup: string;
}

export type SettingsMap = Record<string, unknown>;

export interface ConvertedPresentation {
  slides: { mediaId: string; notes: string | null }[];
  /** "powerpoint", "zip" or "images". */
  method: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------

export const api = {
  app: {
    info: () => call<AppInfo>("app_info"),
    dashboard: (today: string) => call<DashboardSummary>("dashboard_summary", { today }),
  },
  settings: {
    all: () => call<SettingsMap>("settings_get_all"),
    set: (key: string, value: unknown) => call<void>("settings_set", { key, value }),
    setMany: (values: SettingsMap) => call<void>("settings_set_many", { values }),
  },
  secure: {
    get: (key: string) => call<string | null>("secure_get", { key }),
    set: (key: string, value: string) => call<void>("secure_set", { key, value }),
    remove: (key: string) => call<void>("secure_delete", { key }),
  },
  songs: {
    list: (query: SongQuery) => call<SongListResult>("songs_list", { query }),
    get: (id: string) => call<Song>("songs_get", { id }),
    /** Saves a song; a presentation using it picks up the change. */
    save: (song: SongDocument) =>
      call<Song>("songs_save", { song }).then((saved) => {
        songChanged(saved.id);
        return saved;
      }),
    duplicate: (id: string) => call<Song>("songs_duplicate", { id }),
    remove: (id: string) => call<void>("songs_delete", { id }),
    setArchived: (id: string, archived: boolean) => call<void>("songs_set_archived", { id, archived }),
    setFavorite: (id: string, favorite: boolean) => call<void>("songs_set_favorite", { id, favorite }),
    recordUse: (id: string) => call<void>("songs_record_use", { id }),
    facets: () => call<SongFacets>("songs_facets"),
    parseLyrics: (text: string) => call<SongSectionInput[]>("songs_parse_lyrics", { text }),
    exportTo: (path: string, ids: string[] | null) => call<number>("songs_export", { path, ids }),
    importPreview: (path: string) => call<SongImportPreview>("songs_import_preview", { path }),
    importCommit: (path: string, checksum: string, decisions: SongImportDecision[]) =>
      call<SongImportResult>("songs_import_commit", { path, checksum, decisions }),
  },
  services: {
    list: (query: ServicePlanQuery) => call<ServicePlanSummary[]>("services_list", { query }),
    get: (id: string) => call<ServicePlan>("services_get", { id }),
    save: (plan: ServicePlanDocument) => call<ServicePlan>("services_save", { plan }),
    duplicate: (id: string, options: DuplicatePlanOptions) => call<ServicePlan>("services_duplicate", { id, options }),
    remove: (id: string) => call<void>("services_delete", { id }),
    markOpened: (id: string) => call<void>("services_mark_opened", { id }),
    exportTo: (id: string, path: string) => call<void>("services_export", { id, path }),
    importFrom: (path: string) => call<ServiceImportResult>("services_import", { path }),
  },
  themes: {
    list: () => call<Theme[]>("themes_list"),
    save: (theme: ThemeDocument) => call<Theme>("themes_save", { theme }),
    duplicate: (id: string, name: string | null) => call<Theme>("themes_duplicate", { id, name }),
    remove: (id: string) => call<void>("themes_delete", { id }),
  },
  decks: {
    list: (category: DeckCategory | null) => call<SlideDeckSummary[]>("decks_list", { category }),
    get: (id: string) => call<SlideDeck>("decks_get", { id }),
    save: (deck: SlideDeckDocument) => call<SlideDeck>("decks_save", { deck }),
    duplicate: (id: string) => call<SlideDeck>("decks_duplicate", { id }),
    remove: (id: string) => call<void>("decks_delete", { id }),
  },
  bible: {
    translations: () => call<Translation[]>("bible_translations"),
    updateTranslation: (id: string, metadata: TranslationMetadataInput) =>
      call<Translation>("bible_translation_update", { id, metadata }),
    deleteTranslation: (id: string) => call<void>("bible_translation_delete", { id }),
    books: (translationId: string | null) => call<BibleBookInfo[]>("bible_books", { translationId }),
    chapter: (translationId: string, bookId: string, chapter: number) =>
      call<Verse[]>("bible_chapter", { translationId, bookId, chapter }),
    passage: (translationId: string, reference: PassageRef) => call<Passage>("bible_passage", { translationId, reference }),
    search: (query: BibleSearchQuery) => call<BibleSearchResult>("bible_search", { query }),
    recordUse: (input: SavePassageInput) => call<void>("bible_passage_use", { input }),
    setFavorite: (input: SavePassageInput, favorite: boolean) => call<void>("bible_passage_favorite", { input, favorite }),
    savedPassages: (favorites: boolean, limit = 30) => call<SavedPassage[]>("bible_saved_passages", { favorites, limit }),
    removeSaved: (id: string) => call<void>("bible_saved_passage_remove", { id }),
    report: (translationId: string) => call<ValidationReport | null>("bible_validation_report", { translationId }),
    revalidate: (translationId: string) => call<ValidationReport>("bible_revalidate", { translationId }),
    importJobs: (limit = 20) => call<ImportJob[]>("bible_import_jobs", { limit }),
    importPreview: (path: string) => call<ImportPreviewResponse>("bible_import_preview", { path }),
    importDiscard: (token: string) => call<void>("bible_import_discard", { token }),
    importCommit: (token: string, options: ImportOptions) => call<ImportResult>("bible_import_commit", { token, options }),
    providers: () => call<ProviderInfo[]>("bible_providers"),
    providerCatalog: (providerId: string, refresh: boolean) =>
      call<ProviderCatalog>("bible_provider_catalog", { providerId, refresh }),
    providerDownload: (providerId: string, translationId: string) =>
      call<ImportPreviewResponse>("bible_provider_download", { providerId, translationId }),
  },
  media: {
    list: (query: MediaQuery) => call<MediaAsset[]>("media_list", { query }),
    get: (id: string) => call<MediaAsset>("media_get", { id }),
    importFiles: (paths: string[]) => call<MediaImportOutcome[]>("media_import", { paths }),
    /** Imports a folder on this computer (and its subfolders) into a Media Library folder. */
    importFolder: (path: string, folder: string | null) => call<{ folder: string; outcomes: MediaImportOutcome[] }>("media_import_folder", { path, folder }),
    folders: () => call<MediaFolder[]>("media_folders"),
    /** Puts files into a folder, or takes them out of any (null). */
    setFolder: (ids: string[], folder: string | null) => call<number>("media_set_folder", { ids, folder }),
    renameFolder: (from: string, to: string) => call<number>("media_rename_folder", { from, to }),
    update: (id: string, details: MediaDetailsInput) => call<MediaAsset>("media_update", { id, details }),
    setProbe: (id: string, probe: MediaProbe) => call<void>("media_set_probe", { id, probe }),
    async setThumbnail(id: string, bytes: Uint8Array): Promise<string> {
      try {
        return await invoke<string>("media_set_thumbnail", bytes, { headers: { "x-media-id": id } });
      } catch (e) {
        throw toAppError(e);
      }
    },
    /** Stores a picture made in the app; a "slide" picture (a PDF page) is not listed in the Media Library. */
    async importBytes(fileName: string, bytes: Uint8Array, purpose: MediaPurpose = "library"): Promise<MediaAsset> {
      try {
        return await invoke<MediaAsset>("media_import_bytes", bytes, { headers: { "x-file-name": encodeURIComponent(fileName), "x-media-purpose": purpose } });
      } catch (e) {
        throw toAppError(e);
      }
    },
    references: (id: string) => call<string[]>("media_references", { id }),
    remove: (id: string) => call<void>("media_delete", { id }),
    supportedExtensions: () => call<string[]>("media_supported_extensions"),
  },
  backup: {
    create: (directory: string | null, includeMedia: boolean) => call<BackupInfo>("backup_create", { directory, includeMedia }),
    validate: (path: string) => call<BackupValidation>("backup_validate", { path }),
    history: (limit = 50) => call<BackupHistoryEntry[]>("backup_history", { limit }),
    restore: (path: string, restoreMedia: boolean) => call<RestoreOutcome>("backup_restore", { path, restoreMedia }),
    exportLibrary: (path: string) => call<void>("library_export", { path }),
    importLibrary: (path: string) => call<LibraryImportResult>("library_import", { path }),
  },
  sync: {
    status: () => call<SyncStatus>("sync_status"),
    pending: (limit: number, now: string) => call<PendingChange[]>("sync_pending", { limit, now }),
    markPushed: (opId: string, remoteVersion: number) => call<void>("sync_mark_pushed", { opId, remoteVersion }),
    markFailed: (opId: string, error: string, nextAttemptAt: string) =>
      call<void>("sync_mark_failed", { opId, error, nextAttemptAt }),
    markConflict: (opId: string, remote: RemoteRecord) => call<void>("sync_mark_conflict", { opId, remote }),
    applyRemote: (records: RemoteRecord[]) => call<ApplyOutcome[]>("sync_apply_remote", { records }),
    conflicts: () => call<SyncConflict[]>("sync_conflicts"),
    resolve: (conflictId: string, resolution: ConflictResolution) => call<void>("sync_resolve", { conflictId, resolution }),
    backfill: () => call<number>("sync_backfill"),
    reset: () => call<void>("sync_reset"),
    getMeta: (key: string) => call<string | null>("sync_get_meta", { key }),
    setMeta: (key: string, value: string) => call<void>("sync_set_meta", { key, value }),
  },
  files: {
    /** Reads a file chosen for import (PDF), as raw bytes. */
    async readForImport(path: string): Promise<ArrayBuffer> {
      try {
        return await invoke<ArrayBuffer>("import_read_file", { path });
      } catch (e) {
        throw toAppError(e);
      }
    },
    powerpointAvailable: () => call<boolean>("powerpoint_available"),
    /** Title and size of a public Canva design (Canva's oEmbed service; needs the internet). */
    canvaInfo: (link: string) => call<{ title: string; viewUrl: string; width: number | null; height: number | null }>("canva_info", { link }),
    /** Opens a Canva design in the hidden page-picture window (`width` × `height` CSS pixels). */
    canvaCaptureOpen: (url: string, width: number, height: number) => call<void>("canva_capture_open", { url, width, height }),
    /** Turns the hidden window to a page and returns a JPEG picture of it. */
    async canvaCapturePage(page: number): Promise<ArrayBuffer> {
      try {
        return await invoke<ArrayBuffer>("canva_capture_page", { page });
      } catch (e) {
        throw toAppError(e);
      }
    },
    canvaCaptureClose: () => call<void>("canva_capture_close"),
    /** PDF, PowerPoint and ZIP files that appeared in Downloads since the given time. */
    newDownloads: (sinceMs: number) => call<{ path: string; name: string; modifiedMs: number }[]>("downloads_new_files", { sinceMs }),
    convertPresentation: (path: string) => call<ConvertedPresentation>("presentation_convert", { path }),
  },
  presentation: {
    displays: () => call<DisplayInfo[]>("displays_list"),
    openProjector: (displayId: string | null, mode: ProjectorMode) => call<ProjectorStatus>("projector_open", { displayId, mode }),
    closeProjector: () => call<void>("projector_close"),
    projectorStatus: () => call<ProjectorStatus>("projector_status"),
    update: (render: unknown) => call<void>("presentation_update", { render }),
    getState: () => call<unknown | null>("presentation_get_state"),
    saveSession: (session: unknown) => call<void>("presentation_save_session", { session }),
    clearSession: () => call<void>("presentation_clear_session"),
    recovery: () => call<RecoveryFile>("presentation_recovery"),
    report: (status: unknown) => call<void>("projector_report", { status }),
  },
};
