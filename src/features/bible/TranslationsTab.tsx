import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CloudDownload, ExternalLink, FileUp, FolderOpen, RefreshCw, Search, ShieldCheck, Star, Trash2 } from "lucide-react";
import type { Translation } from "@/types/generated/Translation";
import type { TranslationMetadataInput } from "@/types/generated/TranslationMetadataInput";
import { api, type ImportPreviewResponse, type ProviderTranslation } from "@/services/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog, confirm } from "@/components/ui/Dialog";
import { Input, TextField } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorNotice, LoadingBlock, Section } from "@/components/ui/misc";
import { toast } from "@/components/ui/Toast";
import { setting, useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { useOnline } from "@/hooks/useOnline";
import { timeAgo } from "@/lib/format";
import { errorMessage } from "@/lib/ipc";
import { ImportWizard, ReportSummary, statusTone } from "./ImportWizard";

export function TranslationsTab() {
  const qc = useQueryClient();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const translations = useQuery({ queryKey: ["translations"], queryFn: api.bible.translations });
  const jobs = useQuery({ queryKey: ["bible-import-jobs"], queryFn: () => api.bible.importJobs(10) });
  const [wizard, setWizard] = useState<ImportPreviewResponse | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [details, setDetails] = useState<Translation | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const defaultId = setting<string | null>(settings.data, "bible.defaultTranslationId", null);

  const importFile = async (directory: boolean) => {
    const path = await open(
      directory
        ? { title: "Choose a folder of USFM or USX files", directory: true }
        : {
            title: "Choose a Bible file",
            filters: [{ name: "Bible text (USFM, USX, OSIS, JSON, CSV, ZIP)", extensions: ["usfm", "sfm", "usx", "xml", "osis", "json", "csv", "tsv", "zip"] }],
          },
    );
    if (typeof path !== "string") return;
    setPreparing("Reading and validating the file…");
    try {
      setWizard(await api.bible.importPreview(path));
    } catch (e) {
      toast.error("The file could not be imported", e);
    } finally {
      setPreparing(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-6">
        <Section
          title="Installed translations"
          description="Installed text is stored in the local library and never needs the internet."
        >
          {translations.isLoading && <LoadingBlock />}
          {translations.data?.length === 0 && <EmptyState title="No translations installed yet" description="Download one below or import a licensed file." />}
          <div className="space-y-2">
            {translations.data?.map((t) => (
              <div key={t.id} className="flex items-center gap-4 rounded-md border border-border bg-bg px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {t.code} — {t.name}
                    {defaultId === t.id && <Badge tone="primary">Default</Badge>}
                  </p>
                  <p className="text-xs text-subtle">
                    {t.language} · {t.verseCount.toLocaleString()} verses · {t.bookCount} books · {t.licenseName ?? "License not recorded"}
                    {t.importedAt && ` · imported ${timeAgo(t.importedAt)}`}
                  </p>
                </div>
                <Badge tone={statusTone(t.validationStatus)}>{t.validationStatus === "complete" ? "Complete" : t.validationStatus === "incomplete" ? "Incomplete" : t.validationStatus}</Badge>
                {t.importStatus !== "imported" && <Badge tone="danger">{t.importStatus}</Badge>}
                <div className="flex gap-1">
                  {defaultId !== t.id && (
                    <IconButton size="sm" label="Make default" icon={<Star className="size-3.5" />} onClick={() => updateSettings.mutate({ "bible.defaultTranslationId": t.id })} />
                  )}
                  <Button size="sm" onClick={() => setDetails(t)}>
                    Details
                  </Button>
                  <IconButton
                    size="sm"
                    label="Delete"
                    icon={<Trash2 className="size-3.5" />}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete ${t.code}?`,
                        message: "All verses of this translation will be removed from this computer. Services that use it will ask for another translation.",
                        confirmLabel: "Delete translation",
                        danger: true,
                      });
                      if (!ok) return;
                      try {
                        await api.bible.deleteTranslation(t.id);
                        if (defaultId === t.id) updateSettings.mutate({ "bible.defaultTranslationId": null });
                        await qc.invalidateQueries({ queryKey: ["translations"] });
                        toast.success(`${t.code} was deleted`);
                      } catch (e) {
                        toast.error("Could not delete the translation", e);
                      }
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Section>

        <div className="grid gap-5 md:grid-cols-2">
          <Section title="Download from eBible.org" description="Public-domain and openly licensed translations whose copyright holders allow redistribution.">
            <Button variant="primary" icon={<CloudDownload className="size-4" />} onClick={() => setCatalogOpen(true)}>
              Browse translations
            </Button>
          </Section>
          <Section title="Import a file" description="Use text you are licensed to store: USFM (file, folder or zip), USX, OSIS XML, SanctuaryFlow JSON or CSV.">
            <div className="flex gap-2">
              <Button icon={<FileUp className="size-4" />} onClick={() => void importFile(false)}>
                Choose file…
              </Button>
              <Button icon={<FolderOpen className="size-4" />} onClick={() => void importFile(true)}>
                Choose folder…
              </Button>
            </div>
          </Section>
        </div>

        {jobs.data && jobs.data.length > 0 && (
          <Section title="Recent imports">
            <ul className="space-y-1 text-sm">
              {jobs.data.map((j) => (
                <li key={j.id} className="flex items-center gap-3">
                  <Badge tone={j.status === "completed" ? "success" : j.status === "failed" ? "danger" : "warning"}>{j.status}</Badge>
                  <span>{j.translationCode}</span>
                  <span className="text-xs text-subtle">
                    {j.sourceFormat.toUpperCase()} · {j.sourceProvider ?? "file"} · {timeAgo(j.startedAt)}
                    {j.status === "completed" && ` · ${j.versesImported.toLocaleString()} verses`}
                  </span>
                  {j.errorMessage && <span className="truncate text-xs text-danger" title={j.errorMessage}>{j.errorMessage}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      {preparing && (
        <Dialog open title="Preparing import" dismissable={false} onOpenChange={() => undefined} size="sm">
          <LoadingBlock label={preparing} />
        </Dialog>
      )}
      <ImportWizard
        response={wizard}
        onClose={() => {
          setWizard(null);
          void qc.invalidateQueries({ queryKey: ["bible-import-jobs"] });
        }}
      />
      <CatalogDialog
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        onPrepared={(r) => {
          setCatalogOpen(false);
          setWizard(r);
        }}
        installedCodes={translations.data?.map((t) => t.code) ?? []}
      />
      <TranslationDetailsDialog translation={details} onClose={() => setDetails(null)} />
    </div>
  );
}

function CatalogDialog({
  open: isOpen,
  onClose,
  onPrepared,
  installedCodes,
}: {
  open: boolean;
  onClose: () => void;
  onPrepared: (r: ImportPreviewResponse) => void;
  installedCodes: string[];
}) {
  const online = useOnline();
  const [refresh, setRefresh] = useState(0);
  const [text, setText] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const catalog = useQuery({
    queryKey: ["ebible-catalog", refresh],
    queryFn: () => api.bible.providerCatalog("ebible", refresh > 0),
    enabled: isOpen,
    retry: false,
    staleTime: Infinity,
  });
  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    const list = catalog.data?.translations ?? [];
    return (q ? list.filter((t) => `${t.title} ${t.languageName} ${t.languageCode} ${t.shortTitle} ${t.id}`.toLowerCase().includes(q)) : list).slice(0, 300);
  }, [catalog.data, text]);

  const download = async (t: ProviderTranslation) => {
    setDownloading(t.id);
    try {
      onPrepared(await api.bible.providerDownload("ebible", t.id));
    } catch (e) {
      toast.error("The download could not be prepared", errorMessage(e));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()} title="Translations from eBible.org" size="xl" description="Downloads are validated and shown for review before anything is stored.">
      {!online && !catalog.data && <ErrorNotice title="You are offline" message="Connect to the internet to browse and download translations. Installed translations keep working offline." />}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-subtle" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by language or title (e.g. English, Tagalog, Cebuano)" className="pl-8" autoFocus />
        </div>
        <IconButton label="Refresh the catalog" icon={<RefreshCw className="size-4" />} onClick={() => setRefresh((n) => n + 1)} />
        <IconButton label="Open eBible.org" icon={<ExternalLink className="size-4" />} onClick={() => void openUrl("https://ebible.org")} />
      </div>
      {catalog.isLoading && <LoadingBlock label="Loading the catalog…" />}
      {catalog.isError && <ErrorNotice title="The catalog could not be loaded" message={errorMessage(catalog.error)} />}
      {catalog.data?.fromCache && <p className="mb-2 text-xs text-subtle">Showing the saved catalog.</p>}
      <div className="max-h-[55vh] overflow-y-auto">
        <table className="w-full text-sm">
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="py-2 pr-3">
                  <p>{t.title || t.shortTitle}</p>
                  <p className="text-xs text-subtle">
                    {t.languageName} ({t.languageCode}) · {t.otBooks} OT / {t.ntBooks} NT books{t.dcBooks ? ` / ${t.dcBooks} deuterocanonical` : ""}
                  </p>
                </td>
                <td className="py-2 pr-3 text-xs">{t.publicDomain ? <Badge tone="success">Public domain</Badge> : <span className="text-muted">{t.copyright}</span>}</td>
                <td className="py-2 text-right">
                  <Button
                    size="sm"
                    loading={downloading === t.id}
                    disabled={!!downloading}
                    onClick={() => void download(t)}
                  >
                    {installedCodes.includes(t.suggestedCode) ? "Re-download" : "Download"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

function TranslationDetailsDialog({ translation, onClose }: { translation: Translation | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [meta, setMeta] = useState<TranslationMetadataInput | null>(null);
  const report = useQuery({
    queryKey: ["bible-report", translation?.id],
    queryFn: () => api.bible.report(translation!.id),
    enabled: !!translation,
  });
  const revalidate = useMutation({
    mutationFn: () => api.bible.revalidate(translation!.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["bible-report", translation?.id] });
      await qc.invalidateQueries({ queryKey: ["translations"] });
      toast.success("Validation finished");
    },
    onError: (e) => toast.error("Validation failed", e),
  });
  const t = translation;
  const m: TranslationMetadataInput | null =
    meta ??
    (t
      ? {
          code: t.code,
          name: t.name,
          language: t.language,
          versification: t.versification,
          textDirection: t.textDirection,
          publisher: t.publisher,
          sourceProvider: t.sourceProvider,
          sourceUrl: t.sourceUrl,
          licenseName: t.licenseName,
          licenseUrl: t.licenseUrl,
          copyrightNotice: t.copyrightNotice,
          attributionText: t.attributionText,
          offlinePermitted: t.offlinePermitted,
          redistributionPermitted: t.redistributionPermitted,
          modificationPermitted: t.modificationPermitted,
          downloadedAt: t.downloadedAt,
          notes: t.notes,
        }
      : null);
  const set = <K extends keyof TranslationMetadataInput>(k: K, v: TranslationMetadataInput[K]) => m && setMeta({ ...m, [k]: v });

  return (
    <Dialog
      open={!!t}
      onOpenChange={(o) => {
        if (!o) {
          setMeta(null);
          onClose();
        }
      }}
      title={t ? `${t.code} — ${t.name}` : ""}
      size="lg"
      footer={
        <>
          <Button icon={<ShieldCheck className="size-4" />} loading={revalidate.isPending} onClick={() => revalidate.mutate()}>
            Validate again
          </Button>
          <Button
            variant="primary"
            disabled={!meta}
            onClick={async () => {
              if (!t || !meta) return;
              try {
                await api.bible.updateTranslation(t.id, meta);
                await qc.invalidateQueries({ queryKey: ["translations"] });
                toast.success("Details saved");
                setMeta(null);
                onClose();
              } catch (e) {
                toast.error("The details could not be saved", e);
              }
            }}
          >
            Save details
          </Button>
        </>
      }
    >
      {t && m && (
        <div className="space-y-5">
          <dl className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-subtle">Source</dt>
            <dd>
              {t.sourceProvider ?? "File"} · {t.sourceFormat?.toUpperCase()}
              {t.sourceUrl && (
                <button type="button" className="ml-2 text-primary hover:underline" onClick={() => void openUrl(t.sourceUrl!)}>
                  open
                </button>
              )}
            </dd>
            <dt className="text-subtle">Imported</dt>
            <dd>{t.importedAt ? new Date(t.importedAt).toLocaleString() : "—"}</dd>
            <dt className="text-subtle">Last validated</dt>
            <dd>{t.lastValidatedAt ? new Date(t.lastValidatedAt).toLocaleString() : "—"}</dd>
            <dt className="text-subtle">Offline storage</dt>
            <dd>{t.offlinePermitted === true ? "Permitted" : t.offlinePermitted === false ? "Not permitted" : "Unknown"}</dd>
          </dl>
          {report.data && <ReportSummary report={report.data} />}
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Code" value={m.code} onChange={(e) => set("code", e.target.value.toUpperCase())} />
            <TextField label="Name" value={m.name} onChange={(e) => set("name", e.target.value)} />
            <TextField label="Language" value={m.language} onChange={(e) => set("language", e.target.value)} />
            <TextField label="Publisher" value={m.publisher ?? ""} onChange={(e) => set("publisher", e.target.value || null)} />
            <TextField label="License" value={m.licenseName ?? ""} onChange={(e) => set("licenseName", e.target.value || null)} />
            <TextField label="License URL" value={m.licenseUrl ?? ""} onChange={(e) => set("licenseUrl", e.target.value || null)} />
            <TextField className="col-span-2" label="Copyright notice" value={m.copyrightNotice ?? ""} onChange={(e) => set("copyrightNotice", e.target.value || null)} />
            <TextField className="col-span-2" label="Attribution" value={m.attributionText ?? ""} onChange={(e) => set("attributionText", e.target.value || null)} />
          </div>
          {t.notes && <p className="max-h-32 overflow-y-auto rounded-md border border-border bg-bg p-3 text-xs text-muted selectable">{t.notes}</p>}
        </div>
      )}
    </Dialog>
  );
}
