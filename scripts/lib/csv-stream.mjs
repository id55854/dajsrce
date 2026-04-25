// Streaming RFC-4180-ish CSV parser (handles quoted fields with embedded
// commas + newlines, "" escape). No deps. Yields rows as arrays of strings.
//
// Usage:
//   import { parseCsvStream } from "./lib/csv-stream.mjs";
//   for await (const row of parseCsvStream(fs.createReadStream(path))) { ... }

import { Buffer } from "node:buffer";

export async function* parseCsvStream(readable) {
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let row = [];
  let field = "";
  let inQuotes = false;
  let prevChar = "";

  function pushField() {
    row.push(field);
    field = "";
  }

  for await (const chunk of readable) {
    buf += decoder.decode(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
      { stream: true }
    );
    let i = 0;
    while (i < buf.length) {
      const c = buf[i];
      if (inQuotes) {
        if (c === '"') {
          // lookahead — need next char available
          if (i + 1 >= buf.length) break; // wait for more
          const next = buf[i + 1];
          if (next === '"') {
            field += '"';
            i += 2;
            continue;
          } else {
            inQuotes = false;
            i += 1;
            continue;
          }
        } else {
          field += c;
          i += 1;
          continue;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
          i += 1;
          continue;
        } else if (c === ",") {
          pushField();
          i += 1;
          continue;
        } else if (c === "\r") {
          // swallow; \n will trigger row push
          i += 1;
          continue;
        } else if (c === "\n") {
          pushField();
          // skip empty trailing rows
          if (!(row.length === 1 && row[0] === "")) {
            yield row;
          }
          row = [];
          i += 1;
          continue;
        } else {
          field += c;
          i += 1;
        }
      }
      prevChar = c;
    }
    buf = buf.slice(i);
  }

  // tail
  if (field.length > 0 || row.length > 0) {
    pushField();
    if (!(row.length === 1 && row[0] === "")) yield row;
  }
}

export function rowsToObjects(rowsAsync, headerRow) {
  return (async function* () {
    const headers = headerRow;
    for await (const r of rowsAsync) {
      const obj = {};
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]] = r[i] ?? "";
      }
      yield obj;
    }
  })();
}
