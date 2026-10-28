import { expect, test } from "@playwright/test";
import { launchApp } from "./app";

// Downloads a real public-domain translation, so it needs the internet.
// Run with SANCTUARYFLOW_E2E_NETWORK=1.
test.skip(!process.env.SANCTUARYFLOW_E2E_NETWORK, "network test; set SANCTUARYFLOW_E2E_NETWORK=1");

interface Catalog {
  translations: { id: string; title: string; publicDomain: boolean; redistributable: boolean }[];
}
interface PreviewResponse {
  token: string;
  preview: { report: { status: string; booksFound: number; chaptersFound: number; versesFound: number } };
  suggestedMetadata: { code: string; offlinePermitted: boolean | null; licenseName: string | null };
  licenseText: string | null;
}

test("downloads the World English Bible from eBible.org, validates and imports it", async () => {
  const app = await launchApp();
  try {
    const catalog = await app.invoke<Catalog>("bible_provider_catalog", { providerId: "ebible", refresh: true });
    expect(catalog.translations.length).toBeGreaterThan(100);
    expect(catalog.translations.every((t) => t.redistributable)).toBe(true);
    const web = catalog.translations.find((t) => t.id === "engwebp");
    expect(web?.publicDomain).toBe(true);

    const pv = await app.invoke<PreviewResponse>("bible_provider_download", { providerId: "ebible", translationId: "engwebp" });
    expect(pv.suggestedMetadata.code).toBe("WEB");
    expect(pv.suggestedMetadata.offlinePermitted).toBe(true);
    expect(pv.suggestedMetadata.licenseName).toBe("Public Domain");
    expect(pv.preview.report).toMatchObject({ status: "complete", booksFound: 66, chaptersFound: 1189 });

    const result = await app.invoke<{ translationId: string; versesImported: number }>("bible_import_commit", {
      token: pv.token,
      options: { metadata: pv.suggestedMetadata, replaceExisting: false, acknowledgeExclusions: true },
    });
    expect(result.versesImported).toBeGreaterThan(31000);

    const passage = await app.invoke<{ verses: { text: string }[] }>("bible_passage", {
      translationId: result.translationId,
      reference: { bookId: "JHN", chapter: 3, verseStart: 16, chapterEnd: null, verseEnd: null },
    });
    expect(passage.verses[0]!.text).toMatch(/For God so loved the world/);
    const search = await app.invoke<{ total: number }>("bible_search", {
      query: { translationId: result.translationId, text: "shepherd", testament: null, bookId: null, limit: 10, offset: 0 },
    });
    expect(search.total).toBeGreaterThan(10);
  } finally {
    await app.close();
  }
});
