/**
 * Finds the lyric line that matches what the operator typed, so a song found
 * by its words ("I was a wretch") shows the line it was found by.
 */

/** Lower case, without accents or punctuation, single spaces. */
export function simplify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The line matching most of the typed words (all of them, or at least half); null when none does. */
export function matchingLine(lines: string[], query: string): string | null {
  const words = simplify(query).split(" ").filter(Boolean);
  if (!words.length) return null;
  const phrase = words.join(" ");
  let best: { line: string; score: number } | null = null;
  for (const line of lines) {
    const plain = simplify(line);
    if (!plain) continue;
    const lineWords = plain.split(" ");
    let score = words.filter((w) => lineWords.some((lw) => lw.startsWith(w))).length;
    if (plain.includes(phrase)) score += words.length;
    if (!best || score > best.score) best = { line: line.trim(), score };
  }
  return best && best.score >= Math.max(1, Math.ceil(words.length / 2)) ? best.line : null;
}

/** Splits a line into plain and matching parts, for highlighting the typed words. */
export function highlightParts(line: string, query: string): { text: string; match: boolean }[] {
  const words = simplify(query).split(" ").filter((w) => w.length > 1);
  if (!words.length) return [{ text: line, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  let space = "";
  for (const piece of line.split(/(\s+)/)) {
    if (!piece) continue;
    if (/^\s+$/.test(piece)) {
      space += piece;
      continue;
    }
    const match = words.some((w) => simplify(piece).startsWith(w));
    const last = parts[parts.length - 1];
    if (last && last.match === match) last.text += space + piece;
    else if (last && !last.match) {
      // Spaces stay with the plain text, so highlights hold whole words.
      last.text += space;
      parts.push({ text: piece, match });
    } else parts.push({ text: space + piece, match });
    space = "";
  }
  if (space && parts.length) parts[parts.length - 1]!.text += space;
  return parts;
}
