import { inflateSync } from "node:zlib";

function decodePdfString(value) {
  return value
    .replace(/\\([nrtbf()\\])/g, (_, ch) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" }[ch]))
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function textFromContent(content) {
  const out = [];
  const token = /\((?:\\.|[^\\)])*\)\s*(?:Tj|'|")|\[(.*?)\]\s*TJ/gs;
  for (const match of content.matchAll(token)) {
    if (match[1] != null) {
      for (const part of match[1].matchAll(/\((?:\\.|[^\\)])*\)/g)) out.push(decodePdfString(part[0].slice(1, -1)));
    } else {
      const start = match[0].indexOf("(");
      const end = match[0].lastIndexOf(")");
      if (start >= 0 && end > start) out.push(decodePdfString(match[0].slice(start + 1, end)));
    }
  }
  return out.join("\n");
}

export function extractTextFromPdf(buffer) {
  const raw = buffer.toString("latin1");
  const chunks = [textFromContent(raw)];
  const streamRegex = /(<<[\s\S]*?>>)\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of raw.matchAll(streamRegex)) {
    if (!/\/FlateDecode\b/.test(match[1])) continue;
    try {
      const compressed = Buffer.from(match[2], "latin1");
      chunks.push(textFromContent(inflateSync(compressed).toString("latin1")));
    } catch { /* best effort only */ }
  }
  return chunks.join("\n").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
