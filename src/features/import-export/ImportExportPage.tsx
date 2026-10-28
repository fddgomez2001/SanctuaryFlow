import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { BookOpen, CalendarDays, Database, FileDown, FileUp, Music } from "lucide-react";
import { api } from "@/services/api";
import { navigate } from "@/app/navigation";
import { Button } from "@/components/ui/Button";
import { PageHeader, Section } from "@/components/ui/misc";
import { toast } from "@/components/ui/Toast";
import { importService } from "@/features/services/ServicesPage";
import { exportSongs, SongImportDialog } from "./SongImportDialog";

export function ImportExportPage() {
  const qc = useQueryClient();
  const [songImport, setSongImport] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const exportLibrary = async () => {
    const path = await save({ title: "Export library", defaultPath: "sanctuaryflow-library.json", filters: [{ name: "SanctuaryFlow library", extensions: ["json"] }] });
    if (!path) return;
    setBusy("export-library");
    try {
      await api.backup.exportLibrary(path);
      toast.success("Library exported", path);
    } catch (e) {
      toast.error("The library could not be exported", e);
    } finally {
      setBusy(null);
    }
  };

  const importLibrary = async () => {
    const path = await open({ title: "Import a library file", filters: [{ name: "SanctuaryFlow library", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    setBusy("import-library");
    try {
      const r = await api.backup.importLibrary(path);
      await qc.invalidateQueries();
      toast.success(
        "Library imported",
        `${r.songsAdded} songs, ${r.servicesAdded} services, ${r.decksAdded} slide decks and ${r.themesAdded} themes added; ${r.skippedExisting} already present.`,
      );
    } catch (e) {
      toast.error("The library could not be imported", e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Import & Export" description="Move songs, services and other content between computers or from other programs." />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl gap-5 p-6 md:grid-cols-2">
          <Section title="Songs" description="JSON (SanctuaryFlow) or CSV. Duplicates are detected before importing, and you choose what to do with each song.">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={<FileUp className="size-4" />} onClick={() => setSongImport(true)}>
                Import songs
              </Button>
              <Button icon={<FileDown className="size-4" />} onClick={() => void exportSongs(null)}>
                Export all songs
              </Button>
              <Button variant="ghost" icon={<Music className="size-4" />} onClick={() => void navigate("songs")}>
                Song library
              </Button>
            </div>
          </Section>
          <Section title="Service plans" description="A service file includes its songs, slide decks and custom themes, so it opens on another computer.">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                icon={<FileUp className="size-4" />}
                onClick={async () => {
                  const id = await importService();
                  if (id) {
                    await qc.invalidateQueries({ queryKey: ["services"] });
                    void navigate("services", { planId: id });
                  }
                }}
              >
                Import a service
              </Button>
              <Button variant="ghost" icon={<CalendarDays className="size-4" />} onClick={() => void navigate("services")}>
                Export from the planner
              </Button>
            </div>
          </Section>
          <Section title="Bible translations" description="USFM, USX, OSIS XML, SanctuaryFlow JSON and CSV. Every import is validated and reviewed before it is stored.">
            <Button variant="primary" icon={<BookOpen className="size-4" />} onClick={() => void navigate("bible", { tab: "translations" })}>
              Open Bible import
            </Button>
          </Section>
          <Section title="Whole library (JSON)" description="Songs, service plans, templates, slide decks and custom themes in one file. Importing adds what is missing and never overwrites existing items. Bible text and media files are not included — use Backup for a complete copy.">
            <div className="flex flex-wrap gap-2">
              <Button icon={<FileDown className="size-4" />} loading={busy === "export-library"} onClick={() => void exportLibrary()}>
                Export library
              </Button>
              <Button icon={<Database className="size-4" />} loading={busy === "import-library"} onClick={() => void importLibrary()}>
                Import library file
              </Button>
            </div>
          </Section>
          <section className="panel p-5 md:col-span-2">
            <h2 className="text-sm font-semibold">File formats</h2>
            <div className="mt-3 grid gap-4 text-sm text-muted md:grid-cols-2">
              <div>
                <p className="font-medium text-text">Songs CSV</p>
                <p>
                  Header row with <code>title</code> and optionally <code>artist, original_key, tempo, language, category, tags, copyright_holder, copyright_year, ccli_number, source, license, notes, lyrics</code>. Tags are separated by semicolons. Lyrics use <code>[Verse 1]</code>-style headers and blank lines between slides.
                </p>
              </div>
              <div>
                <p className="font-medium text-text">Bible CSV</p>
                <p>
                  Header row with <code>book, chapter, verse, text</code> (optional <code>verse_end</code>). Books may be names, USFM codes (GEN, 1CO) or numbers 1–66. Comma, semicolon and tab separators are detected.
                </p>
              </div>
              <div>
                <p className="font-medium text-text">Bible JSON</p>
                <p>
                  <code>{`{"format":"sanctuaryflow-bible","translation":{…},"books":[{"id":"GEN","name":"Genesis","chapters":[{"chapter":1,"verses":[{"verse":1,"text":"…"}]}]}]}`}</code>, a flat list of <code>{`{book, chapter, verse, text}`}</code>, or book/chapter arrays.
                </p>
              </div>
              <div>
                <p className="font-medium text-text">Content you import</p>
                <p>Only import songs and Bible text you are licensed to use. SanctuaryFlow records the source and license of each Bible translation and shows its validation report.</p>
              </div>
            </div>
          </section>
        </div>
      </div>
      <SongImportDialog open={songImport} onClose={() => setSongImport(false)} onImported={() => void qc.invalidateQueries({ queryKey: ["songs"] })} />
    </div>
  );
}
