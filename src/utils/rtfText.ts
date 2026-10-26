// Text from an uploaded Rich Text (.rtf) file, for the upload preview and the brief text.
// RTF is plain ASCII markup, so reading it as text "works" but shows the font table, colour
// table and control words instead of the brief. This is a small reader for the parts a brief
// uses (paragraphs, tabs, tables, special characters), which avoids adding a dependency.

// Groups that hold document machinery rather than body text. Any group starting with \* is
// skipped too, which is how RTF marks destinations a reader may ignore.
const SKIPPED_DESTINATIONS = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "listtable", "listoverridetable",
  "header", "headerl", "headerr", "headerf", "footer", "footerl", "footerr", "footerf", "footnote",
  "fldinst", "themedata", "colorschememapping", "latentstyles", "datastore", "xmlnstbl",
  "rsidtbl", "filetbl", "revtbl", "generator", "nonshppict",
]);

const SYMBOLS: Record<string, string> = {
  par: "\n", line: "\n", sect: "\n", page: "\n", row: "\n", cell: " | ", tab: "\t",
  emdash: "—", endash: "–", bullet: "•", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”",
};

// \'hh escapes are bytes in the document's ANSI code page; Windows-1252 is what Word and
// TextEdit write for Western text. It is Latin-1 except 0x80-0x9F, where curly quotes and dashes
// live. Mapped here rather than with TextDecoder, which Node 22 decodes as plain Latin-1.
const CP1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";
const cp1252 = (byte: number) => (byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : String.fromCharCode(byte));

/**
 * The document body as lines: one per paragraph, and one per table row with its cells joined
 * by " | ", matching docxLines. Empty paragraphs are dropped.
 */
export function rtfLines(rtf: string): string[] {
  if (!/^\s*\{\\rtf/.test(rtf)) throw new Error("This file is not a readable RTF document.");

  let text = "";
  // Each group inherits its parent's state; uc is how many fallback characters follow a \u.
  const stack: Array<{ skip: boolean; uc: number }> = [];
  let state = { skip: false, uc: 1 };
  let fallbackToSkip = 0;
  const emit = (value: string) => {
    if (state.skip) return;
    if (fallbackToSkip > 0) {
      fallbackToSkip--;
      return;
    }
    text += value;
  };

  for (let i = 0; i < rtf.length; i++) {
    const char = rtf[i];
    if (char === "{") {
      stack.push(state);
      state = { ...state };
      fallbackToSkip = 0;
    } else if (char === "}") {
      state = stack.pop() ?? state;
      fallbackToSkip = 0;
    } else if (char === "\r" || char === "\n") {
      // Raw line breaks are only source formatting in RTF.
    } else if (char !== "\\") {
      emit(char);
    } else {
      const next = rtf[i + 1] ?? "";
      if (/[a-z]/i.test(next)) {
        const match = /^([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i + 1, i + 40))!;
        i += match[0].length;
        const word = match[1];
        const param = match[2] === undefined ? undefined : Number(match[2]);
        if (SKIPPED_DESTINATIONS.has(word)) state.skip = true;
        else if (word === "uc" && param !== undefined) state.uc = param;
        else if (word === "u" && param !== undefined) {
          emit(String.fromCharCode(param < 0 ? param + 65536 : param));
          if (!state.skip) fallbackToSkip = state.uc;
        } else if (word === "bin" && param !== undefined) i += param;
        else if (SYMBOLS[word]) emit(SYMBOLS[word]);
      } else {
        i++;
        if (next === "'") {
          const byte = parseInt(rtf.slice(i + 1, i + 3), 16);
          i += 2;
          if (Number.isFinite(byte)) emit(cp1252(byte));
        } else if (next === "*") state.skip = true;
        // A backslash before a line break is a paragraph mark; TextEdit writes them this way.
        else if (next === "\n" || next === "\r") emit("\n");
        else if (next === "{" || next === "}" || next === "\\") emit(next);
        else if (next === "~") emit(" ");
        else if (next === "_") emit("-");
      }
    }
  }

  return text
    .split("\n")
    .map((line) => line.replace(/(\s*\|\s*)+$/, "").trim())
    .filter(Boolean);
}
