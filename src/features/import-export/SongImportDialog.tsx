import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { FileUp, TriangleAlert } from "lucide-react";
import type { ImportAction } from "@/types/generated/ImportAction";
import type { SongImportPreview } from "@/types/generated/SongImportPreview";
import { api } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Field";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/Toast";

/** Asks where to save, then exports songs (all when `ids` is null) as JSON or CSV. */
export async function exportSongs(ids: string[] | null) {
  const path = await save({
    title: ids ? "Export songs" : "Export all songs",
    defaultPath: ids?.length === 1 ? "song.json" : "songs.json",
    filters: [
      { name: "SanctuaryFlow songs (JSON)", extensions: ["json"] },
      { name: "Spreadsheet (CSV)", extensions: ["csv"] },
    ],
  });
  if (!path) return;
  try {
    const n = await api.songs.exportTo(path, ids);
    toast.success(`Exported ${n} song${n === 1 ? "" : "s"}`, path);
  } catch (e) {
    toast.error("The songs could not be exported", e);
  }
}

export function SongImportDialog({ open: isOpen, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<SongImportPreview | null>(null);
  const [actions, setActions] = useState<Record<number, { action: ImportAction; replaceId: string | null }>>({});
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setPath(null);
    setPreview(null);
    setActions({});
  };

  const choose = async () => {
    const p = await open({
      title: "Choose a song file",
      filters: [{ name: "Songs (JSON or CSV)", extensions: ["json", "csv"] }],
    });
    if (typeof p !== "string") return;
    setBusy(true);
    try {
      const pv = await api.songs.importPreview(p);
      setPath(p);
      setPreview(pv);
      setActions(
        Object.fromEntries(
          pv.candidates.map((c) => [c.index, { action: c.problem ? "skip" : c.duplicates.length ? "skip" : "create", replaceId: c.duplicates[0]?.id ?? null }]),
        ) as Record<number, { action: ImportAction; replaceId: string | null }>,
      );
    } catch (e) {
      toast.error("The file could not be read", e);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!path || !preview) return;
    setBusy(true);
    try {
      const r = await api.songs.importCommit(
        path,
        preview.checksum,
        preview.candidates.map((c) => ({ index: c.index, action: actions[c.index]?.action ?? "skip", replaceId: actions[c.index]?.replaceId ?? null })),
      );
      toast.success(`Imported songs: ${r.created} added, ${r.replaced} replaced, ${r.skipped} skipped`);
      onImported();
      reset();
      onClose();
    } catch (e) {
      toast.error("The import failed and no songs were changed", e);
    } finally {
      setBusy(false);
    }
  };

  const counts = preview
    ? {
        create: preview.candidates.filter((c) => actions[c.index]?.action === "create").length,
        replace: preview.candidates.filter((c) => actions[c.index]?.action === "replace").length,
      }
    : null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
      title="Import songs"
      description="Import songs you are licensed to use from a SanctuaryFlow JSON export or a CSV spreadsheet."
      size="xl"
      footer={
        preview ? (
          <>
            <span className="mr-auto text-xs text-muted">
              {counts?.create} to add, {counts?.replace} to replace
            </span>
            <Button variant="ghost" onClick={reset}>
              Choose another file
            </Button>
            <Button variant="primary" loading={busy} disabled={!counts || counts.create + counts.replace === 0} onClick={() => void commit()}>
              Import
            </Button>
          </>
        ) : undefined
      }
    >
      {!preview ? (
        <div className="space-y-4">
          <Button variant="primary" icon={<FileUp className="size-4" />} loading={busy} onClick={() => void choose()}>
            Choose a file…
          </Button>
          <div className="text-sm text-muted">
            <p className="font-medium text-text">CSV columns</p>
            <p className="mt-1">
              <code className="text-xs">title</code> (required), <code className="text-xs">artist, original_key, tempo, language, category, tags, copyright_holder, copyright_year, ccli_number, source, license, notes, lyrics</code>.
              Separate tags with semicolons. In <code className="text-xs">lyrics</code>, start sections with headers like <code className="text-xs">[Verse 1]</code> and use blank lines for slide breaks.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {preview.warnings.map((w) => (
            <p key={w} className="flex items-center gap-2 text-xs text-warning">
              <TriangleAlert className="size-3.5" /> {w}
            </p>
          ))}
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-subtle">
              <tr>
                <th className="py-1.5 font-medium">Song</th>
                <th className="py-1.5 font-medium">Sections</th>
                <th className="py-1.5 font-medium">Notes</th>
                <th className="py-1.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {preview.candidates.map((c) => {
                const a = actions[c.index];
                return (
                  <tr key={c.index} className="border-t border-border align-top">
                    <td className="py-2 pr-3">
                      <p>{c.title}</p>
                      <p className="text-xs text-subtle">{[c.artist, c.firstLine].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="py-2 pr-3 text-muted">{c.sectionCount}</td>
                    <td className="space-y-1 py-2 pr-3">
                      {c.problem && <Badge tone="danger">{c.problem}</Badge>}
                      {c.duplicates.length > 0 && <Badge tone="warning">Possible duplicate of “{c.duplicates[0]!.title}”</Badge>}
                      {c.missingCopyright && <Badge>No copyright info</Badge>}
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1.5">
                        <Select
                          aria-label={`Action for ${c.title}`}
                          className="h-8 w-36 text-xs"
                          disabled={!!c.problem}
                          value={a?.action ?? "skip"}
                          onChange={(e) => setActions((s) => ({ ...s, [c.index]: { action: e.target.value as ImportAction, replaceId: s[c.index]?.replaceId ?? null } }))}
                        >
                          <option value="create">Add as new</option>
                          <option value="skip">Skip</option>
                          {c.duplicates.length > 0 && <option value="replace">Replace existing</option>}
                        </Select>
                        {a?.action === "replace" && c.duplicates.length > 1 && (
                          <Select
                            aria-label="Song to replace"
                            className="h-8 w-44 text-xs"
                            value={a.replaceId ?? ""}
                            onChange={(e) => setActions((s) => ({ ...s, [c.index]: { action: "replace", replaceId: e.target.value } }))}
                          >
                            {c.duplicates.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.title}
                              </option>
                            ))}
                          </Select>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
