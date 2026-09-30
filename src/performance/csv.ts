// CSV reading for uploaded campaign reports. Touch-level exports reach 50MB (hundreds of
// thousands of rows), so the reader is incremental: feed it chunks as File.stream() yields them
// and it hands back completed rows, holding only the row in progress. The same reader runs in the
// browser (a Web Worker) and on the server, so it depends on nothing but the language.

export class CsvReader {
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  // A quote inside a quoted field is either the closing quote or the first half of an escaped
  // "" pair; which one is only known from the next character, which may be in the next chunk.
  private quoteSeen = false;
  private skipLineFeed = false;
  private started = false;

  constructor(private readonly delimiter = ",") {}

  push(chunk: string): string[][] {
    const rows: string[][] = [];
    let text = chunk;
    if (!this.started) {
      this.started = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (this.skipLineFeed) {
        this.skipLineFeed = false;
        if (ch === "\n") continue;
      }
      if (this.inQuotes) {
        if (this.quoteSeen) {
          this.quoteSeen = false;
          if (ch === '"') {
            this.field += '"';
            continue;
          }
          this.inQuotes = false;
          // Fall through: this character is outside the quotes.
        } else if (ch === '"') {
          this.quoteSeen = true;
          continue;
        } else {
          this.field += ch;
          continue;
        }
      }
      if (ch === '"' && this.field === "") {
        this.inQuotes = true;
      } else if (ch === this.delimiter) {
        this.row.push(this.field);
        this.field = "";
      } else if (ch === "\n" || ch === "\r") {
        this.skipLineFeed = ch === "\r";
        this.endRow(rows);
      } else {
        this.field += ch;
      }
    }
    return rows;
  }

  end(): string[][] {
    const rows: string[][] = [];
    if (this.quoteSeen) {
      this.quoteSeen = false;
      this.inQuotes = false;
    }
    if (this.field !== "" || this.row.length > 0) this.endRow(rows);
    return rows;
  }

  private endRow(rows: string[][]) {
    this.row.push(this.field);
    this.field = "";
    // Blank lines carry nothing; exports often end with one.
    if (!(this.row.length === 1 && this.row[0].trim() === "")) rows.push(this.row);
    this.row = [];
  }
}

/** Tab-separated exports are pasted from spreadsheets often enough to be worth recognising. */
export function detectDelimiter(sample: string): string {
  const firstLine = sample.slice(0, sample.search(/\r?\n|$/));
  const tabs = firstLine.split("\t").length - 1;
  const commas = firstLine.split(",").length - 1;
  return tabs > commas ? "\t" : ",";
}

/** A whole report already in memory: the header row and the data rows. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const reader = new CsvReader(detectDelimiter(text));
  const all = [...reader.push(text), ...reader.end()];
  const [headers = [], ...rows] = all;
  return { headers: headers.map((h) => h.trim()), rows };
}
