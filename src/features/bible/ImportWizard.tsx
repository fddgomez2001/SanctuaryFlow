import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ImportResult } from "@/types/generated/ImportResult";
import type { TranslationMetadataInput } from "@/types/generated/TranslationMetadataInput";
import type { ValidationReport } from "@/types/generated/ValidationReport";
import { api, type ImportPreviewResponse } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Checkbox, Field, Input, Select, Textarea, TextField } from "@/components/ui/Field";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/ipc";
import { useUpdateSettings } from "@/hooks/useSettings";

export function statusTone(status: string) {
  return status === "complete" ? "success" : status === "invalid" ? "danger" : "warning";
}

export function ReportSummary({ report }: { report: ValidationReport }) {
  const [showAll, setShowAll] = useState(false);
  const issues = report.issues.filter((i) => showAll || i.severity !== "info");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(report.status)}>{report.status === "complete" ? "Complete" : report.status === "incomplete" ? "Incomplete" : "Has errors"}</Badge>
        <span className="text-sm text-muted">
          {report.booksFound} of {report.booksExpected} books · {report.chaptersFound} of {report.chaptersExpected} chapters · {report.versesFound.toLocaleString()} verses
          {report.excludedVerses > 0 && ` · ${report.excludedVerses.toLocaleString()} not importable`}
        </span>
      </div>
      {issues.length > 0 && (
        <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-bg p-2 text-xs selectable">
          {issues.map((i, n) => (
            <li key={n} className="flex items-start gap-1.5">
              {i.severity === "error" ? (
                <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-danger" />
              ) : i.severity === "warning" ? (
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
              ) : (
                <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
              )}
              <span>{i.message}</span>
            </li>
          ))}
          {report.issueOverflow > 0 && <li className="text-subtle">…and {report.issueOverflow} more.</li>}
        </ul>
      )}
      {report.issues.some((i) => i.severity === "info") && (
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Hide details" : "Show all details"}
        </button>
      )}
    </div>
  );
}

const tri = (v: boolean | null) => (v === true ? "yes" : v === false ? "no" : "unknown");
const fromTri = (v: string) => (v === "yes" ? true : v === "no" ? false : null);

/** Review → confirm → import → verify, for files and provider downloads alike. */
export function ImportWizard({ response, onClose }: { response: ImportPreviewResponse | null; onClose: () => void }) {
  const qc = useQueryClient();
  const updateSettings = useUpdateSettings();
  const [meta, setMeta] = useState<TranslationMetadataInput | null>(null);
  const [confirmOffline, setConfirmOffline] = useState(false);
  const [replace, setReplace] = useState(false);
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  const installed = useQuery({ queryKey: ["translations"], queryFn: api.bible.translations, enabled: !!response });

  useEffect(() => {
    if (response) {
      setMeta({ ...response.suggestedMetadata });
      setConfirmOffline(response.suggestedMetadata.offlinePermitted === true);
      setReplace(false);
      setAcknowledge(false);
      setError(null);
      setResult(null);
      setSample(null);
      setProgress(null);
    }
  }, [response]);

  useEffect(() => {
    const un = listen<{ done: number; total: number }>("bible-import://progress", (e) => setProgress(e.payload));
    return () => void un.then((u) => u());
  }, []);

  if (!response || !meta) return null;
  const pv = response.preview;
  const set = <K extends keyof TranslationMetadataInput>(k: K, v: TranslationMetadataInput[K]) => setMeta((m) => (m ? { ...m, [k]: v } : m));
  const invalid = pv.report.status === "invalid";
  const existing = installed.data?.find((t) => t.code.toUpperCase() === meta.code.trim().toUpperCase());
  const needsAck = pv.report.excludedVerses > 0;

  const doImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.bible.importCommit(response.token, {
        metadata: { ...meta, offlinePermitted: confirmOffline ? true : meta.offlinePermitted === false ? false : null },
        replaceExisting: replace,
        acknowledgeExclusions: acknowledge,
      });
      setResult(r);
      await qc.invalidateQueries({ queryKey: ["translations"] });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      await qc.invalidateQueries({ queryKey: ["bible-books"] });
      // Verify by looking up a well-known verse from the database itself.
      const probe = [
        { bookId: "JHN", chapter: 3, verseStart: 16 },
        { bookId: "GEN", chapter: 1, verseStart: 1 },
        { bookId: "PSA", chapter: 23, verseStart: 1 },
      ];
      for (const p of probe) {
        try {
          const passage = await api.bible.passage(r.translationId, { ...p, chapterEnd: null, verseEnd: null });
          setSample(`${passage.bookName} ${p.chapter}:${p.verseStart} (${passage.translationCode}) — ${passage.verses[0]?.text ?? ""}`);
          break;
        } catch {
          // try the next probe
        }
      }
      const translations = await api.bible.translations();
      if (translations.length === 1) updateSettings.mutate({ "bible.defaultTranslationId": r.translationId });
      toast.success(`${meta.code} was imported`, `${r.versesImported.toLocaleString()} verses stored.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      dismissable={!busy}
      onOpenChange={(o) => {
        if (!o) {
          if (!result) void api.bible.importDiscard(response.token).catch(() => undefined);
          onClose();
        }
      }}
      title={result ? "Import complete" : `Review import: ${pv.sourceName}`}
      size="xl"
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            {progress && busy && (
              <span className="mr-auto text-xs text-muted">
                Storing verses… {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
              </span>
            )}
            <Button variant="ghost" disabled={busy} onClick={() => { void api.bible.importDiscard(response.token).catch(() => undefined); onClose(); }}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={invalid || !confirmOffline || (needsAck && !acknowledge) || (!!existing && !replace) || !meta.code.trim()}
              onClick={() => void doImport()}
            >
              Import translation
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-5 text-success" /> {result.versesImported.toLocaleString()} verses were stored in one step. The translation is available offline.
          </p>
          <ReportSummary report={result.report} />
          {sample && (
            <div className="rounded-md border border-border bg-bg p-3 text-sm selectable">
              <p className="mb-1 text-xs font-semibold text-subtle">LOOKUP CHECK</p>
              {sample}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold text-subtle">SOURCE</p>
              <p className="text-sm">
                {pv.format.toUpperCase()} · {pv.books.length} books · {pv.verseCount.toLocaleString()} verses read
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-subtle">VALIDATION</p>
              <ReportSummary report={pv.report} />
              {invalid && <p className="mt-2 text-sm text-danger">This source has structural errors and cannot be imported. Fix the file and try again.</p>}
            </div>
            {pv.sample.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold text-subtle">SAMPLE</p>
                <div className="space-y-1.5 rounded-md border border-border bg-bg p-3 text-sm selectable">
                  {pv.sample.map((s) => (
                    <p key={s.reference}>
                      <span className="font-semibold">{s.reference}</span> {s.text}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {response.licenseText && (
              <div>
                <p className="mb-2 text-xs font-semibold text-subtle">LICENSE STATEMENT FROM THE PACKAGE</p>
                <p className="max-h-40 overflow-y-auto rounded-md border border-border bg-bg p-3 text-xs text-muted selectable">{response.licenseText}</p>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold text-subtle">TRANSLATION DETAILS</p>
            <div className="grid grid-cols-[120px_1fr] gap-3">
              <TextField label="Code" value={meta.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="WEB" />
              <TextField label="Name" value={meta.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <TextField label="Language" value={meta.language} onChange={(e) => set("language", e.target.value)} placeholder="en" />
              <TextField label="Versification" value={meta.versification ?? ""} onChange={(e) => set("versification", e.target.value || null)} />
              <Field label="Direction">
                <Select value={meta.textDirection ?? "ltr"} onChange={(e) => set("textDirection", e.target.value)}>
                  <option value="ltr">Left to right</option>
                  <option value="rtl">Right to left</option>
                </Select>
              </Field>
            </div>
            <TextField label="Publisher" value={meta.publisher ?? ""} onChange={(e) => set("publisher", e.target.value || null)} />
            <div className="grid grid-cols-2 gap-3">
              <TextField label="License" value={meta.licenseName ?? ""} onChange={(e) => set("licenseName", e.target.value || null)} />
              <TextField label="License URL" value={meta.licenseUrl ?? ""} onChange={(e) => set("licenseUrl", e.target.value || null)} />
            </div>
            <Field label="Copyright notice">
              <Textarea rows={2} value={meta.copyrightNotice ?? ""} onChange={(e) => set("copyrightNotice", e.target.value || null)} />
            </Field>
            <Field label="Attribution to show">
              <Input value={meta.attributionText ?? ""} onChange={(e) => set("attributionText", e.target.value || null)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Redistribution permitted">
                <Select value={tri(meta.redistributionPermitted)} onChange={(e) => set("redistributionPermitted", fromTri(e.target.value))}>
                  <option value="unknown">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              </Field>
              <Field label="Modifications permitted">
                <Select value={tri(meta.modificationPermitted)} onChange={(e) => set("modificationPermitted", fromTri(e.target.value))}>
                  <option value="unknown">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              </Field>
            </div>
            <div className="space-y-2 rounded-md border border-border bg-bg p-3">
              <Checkbox
                checked={confirmOffline}
                onChange={setConfirmOffline}
                label="I confirm this translation's license permits storing it on this computer for use in our services."
              />
              {needsAck && (
                <Checkbox
                  checked={acknowledge}
                  onChange={setAcknowledge}
                  label={`Import without the ${pv.report.excludedVerses.toLocaleString()} verses listed in the report (books outside the 66-book catalog or empty verses).`}
                />
              )}
              {existing && (
                <Checkbox
                  checked={replace}
                  onChange={setReplace}
                  label={`Replace the installed translation ${existing.code} (${existing.name}). Its current text is kept if the import fails.`}
                />
              )}
            </div>
            {error && (
              <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
