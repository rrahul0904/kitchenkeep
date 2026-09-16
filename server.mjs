import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { extractRecipeFromHtml, extractRecipeFromText } from "./lib/recipe-parser.mjs";
import { aiEnabled, extractRecipeWithAI } from "./lib/ai-extractor.mjs";
import { extractTextFromPdf } from "./lib/pdf-text.mjs";
import { isYouTubeUrl, parseYouTubePlayerResponse, transcriptFromJson3, youtubeMetadata } from "./lib/youtube.mjs";

const root = fileURLToPath(new URL("./public/", import.meta.url));
const port = Number(process.env.PORT || 3000);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};
const MAX_BODY = 12_000_000;
const MAX_FETCH = 10_000_000;
const importHits = new Map();

function securityHeaders(extra = {}) {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "default-src 'self'; img-src 'self' data: https:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    ...extra
  };
}

function json(res, status, value) {
  res.writeHead(status, securityHeaders({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }));
  res.end(JSON.stringify(value));
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a >= 224);
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:") || lower.startsWith("ff");
  }
  return true;
}

async function validatePublicUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only public http(s) URLs can be imported.");
  if (url.username || url.password) throw new Error("URLs with embedded credentials are blocked.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("Private or local network URLs are blocked.");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new Error("Private or local network URLs are blocked.");
  return url;
}

async function safeFetch(input, redirects = 0) {
  if (redirects > 4) throw new Error("Too many redirects.");
  const url = await validatePublicUrl(input);
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(12_000),
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; KitchenKeep/0.2; +https://github.com/rrahul0904/kitchenkeep)",
      accept: "text/html,application/xhtml+xml,application/json,text/plain,application/pdf,image/*;q=0.8,*/*;q=0.5"
    }
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect missing a destination.");
    return safeFetch(new URL(location, url).toString(), redirects + 1);
  }
  return response;
}

async function readLimited(response, maxBytes = MAX_FETCH) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("Source is too large to import.");
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Source is too large to import.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function rateLimited(req) {
  const now = Date.now();
  const key = clientIp(req);
  const windowMs = 15 * 60 * 1000;
  const history = (importHits.get(key) || []).filter((time) => now - time < windowMs);
  if (history.length >= 30) return true;
  history.push(now);
  importHits.set(key, history);
  if (importHits.size > 1000) {
    for (const [ip, values] of importHits) if (!values.some((time) => now - time < windowMs)) importHits.delete(ip);
  }
  return false;
}

function sourceTypeForUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
    if (host.includes("instagram.com")) return "instagram";
    if (host.includes("tiktok.com")) return "tiktok";
    return "web";
  } catch { return "web"; }
}

async function tryAiTextFallback(text, details = {}) {
  if (!aiEnabled() || !text || text.length < 20) return null;
  try { return await extractRecipeWithAI({ text, ...details }); } catch { return null; }
}

async function importYouTube(url, html) {
  const player = parseYouTubePlayerResponse(html);
  const meta = youtubeMetadata(player);
  let transcript = "";
  const track = meta.captionTracks.find((item) => /en/i.test(item.languageCode || "")) || meta.captionTracks[0];
  if (track?.baseUrl) {
    try {
      const captionUrl = `${track.baseUrl}${track.baseUrl.includes("?") ? "&" : "?"}fmt=json3`;
      const response = await safeFetch(captionUrl);
      if (response.ok) transcript = transcriptFromJson3(JSON.parse((await readLimited(response, 2_000_000)).toString("utf8")));
    } catch { /* captions are best effort */ }
  }
  const combined = `${meta.title}\n${meta.description}\n\nIngredients\n${meta.description}\n\nInstructions\n${transcript}`.slice(0, 180_000);
  let recipe = extractRecipeFromText(combined, {
    sourceUrl: url,
    sourceName: meta.author || "YouTube",
    sourceType: "youtube",
    extractionMethod: transcript ? "youtube-caption-heuristic" : "youtube-description-heuristic",
    title: meta.title
  });
  if ((!recipe || recipe.ingredients.length < 2 || recipe.steps.length < 1) && aiEnabled()) {
    recipe = await tryAiTextFallback(`${meta.description}\n\nTranscript:\n${transcript}`, { sourceUrl: url, sourceName: meta.author || "YouTube", sourceType: "youtube" }) || recipe;
  }
  return recipe;
}

async function importUrl(url) {
  const response = await safeFetch(url);
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const finalUrl = response.url || url;
  const buffer = await readLimited(response);

  if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
    const html = buffer.toString("utf8");
    if (isYouTubeUrl(finalUrl)) {
      const recipe = await importYouTube(finalUrl, html);
      if (recipe) return recipe;
    }
    let recipe = extractRecipeFromHtml(html, finalUrl);
    if (recipe) recipe.sourceType = sourceTypeForUrl(finalUrl);
    if ((!recipe || recipe.ingredients.length < 1 || recipe.steps.length < 1) && aiEnabled()) {
      const aiRecipe = await tryAiTextFallback(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 120_000), {
        sourceUrl: finalUrl,
        sourceName: new URL(finalUrl).hostname.replace(/^www\./, ""),
        sourceType: sourceTypeForUrl(finalUrl)
      });
      if (aiRecipe) recipe = aiRecipe;
    }
    if (recipe) return recipe;
    throw new Error("No usable recipe could be extracted from this page.");
  }

  if (contentType.includes("application/pdf") || finalUrl.toLowerCase().endsWith(".pdf")) {
    const text = extractTextFromPdf(buffer);
    const heuristic = extractRecipeFromText(text, { sourceUrl: finalUrl, sourceType: "pdf", sourceName: "PDF import", extractionMethod: "pdf-text-heuristic" });
    if (heuristic?.ingredients.length && heuristic?.steps.length) return heuristic;
    if (aiEnabled()) return extractRecipeWithAI({ buffer, mimeType: "application/pdf", filename: "recipe.pdf", sourceUrl: finalUrl, sourceName: "PDF import", sourceType: "pdf" });
    if (heuristic) return heuristic;
    throw new Error("This PDF needs AI extraction. Configure OPENAI_API_KEY to enable scanned/complex PDF imports.");
  }

  if (contentType.startsWith("image/")) {
    return extractRecipeWithAI({ buffer, mimeType: contentType.split(";")[0], filename: "recipe-image", sourceUrl: finalUrl, sourceName: "Image import", sourceType: "image" });
  }

  if (contentType.includes("text/plain") || contentType.includes("application/json")) {
    const rawText = buffer.toString("utf8");
    const recipe = extractRecipeFromText(rawText, { sourceUrl: finalUrl, sourceType: "text", sourceName: new URL(finalUrl).hostname.replace(/^www\./, "") });
    if (recipe) return recipe;
  }
  throw new Error("Unsupported source type. Use a recipe webpage, public social/video link, image, PDF, or pasted recipe text.");
}

async function importFile(file) {
  if (!file || typeof file !== "object" || !file.data) throw new Error("A file payload is required.");
  const buffer = Buffer.from(String(file.data), "base64");
  if (!buffer.length) throw new Error("The uploaded file is empty.");
  if (buffer.length > 9_000_000) throw new Error("Files must be under 9 MB.");
  const type = String(file.type || "application/octet-stream").toLowerCase();
  const name = String(file.name || "recipe-upload").slice(0, 180);

  if (type.startsWith("image/")) return extractRecipeWithAI({ buffer, mimeType: type, filename: name, sourceName: name, sourceType: "image" });
  if (type.includes("pdf") || name.toLowerCase().endsWith(".pdf")) {
    const extracted = extractTextFromPdf(buffer);
    const heuristic = extractRecipeFromText(extracted, { sourceName: name, sourceType: "pdf", extractionMethod: "pdf-text-heuristic" });
    if (heuristic?.ingredients.length && heuristic?.steps.length) return heuristic;
    if (aiEnabled()) return extractRecipeWithAI({ buffer, mimeType: "application/pdf", filename: name, sourceName: name, sourceType: "pdf" });
    if (heuristic) return heuristic;
    throw new Error("This PDF needs AI extraction. Configure OPENAI_API_KEY to enable scanned/complex PDF imports.");
  }
  if (type.startsWith("text/") || type.includes("json") || /\.(txt|md|html?|json)$/i.test(name)) {
    const raw = buffer.toString("utf8");
    const recipe = type.includes("html") || /\.html?$/i.test(name)
      ? extractRecipeFromHtml(raw)
      : extractRecipeFromText(raw, { sourceName: name, sourceType: "file", extractionMethod: "file-text-heuristic" });
    if (recipe) {
      recipe.sourceUrl = undefined;
      recipe.sourceName = name;
      recipe.sourceType = "file";
      return recipe;
    }
    if (aiEnabled()) return extractRecipeWithAI({ text: raw, sourceName: name, sourceType: "file" });
  }
  throw new Error("Unsupported file type. Upload an image, PDF, text, Markdown, HTML, or JSON recipe file.");
}

async function readJsonBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY) throw Object.assign(new Error("Request too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Invalid JSON body."), { statusCode: 400 }); }
}

async function handleImport(req, res) {
  if (rateLimited(req)) return json(res, 429, { error: "Too many imports. Try again shortly." });
  try {
    const body = await readJsonBody(req);
    let recipe;
    if (body.url) recipe = await importUrl(String(body.url));
    else if (body.text) {
      recipe = extractRecipeFromText(String(body.text).slice(0, 180_000), { sourceName: body.title || "Pasted recipe", sourceType: "text", extractionMethod: "pasted-text-heuristic" });
      if ((!recipe || !recipe.ingredients.length || !recipe.steps.length) && aiEnabled()) {
        recipe = await tryAiTextFallback(String(body.text), { sourceName: body.title || "Pasted recipe", sourceType: "text" }) || recipe;
      }
    } else if (body.file) recipe = await importFile(body.file);
    else return json(res, 400, { error: "Provide url, text, or file to import." });
    if (!recipe) return json(res, 422, { error: "No usable recipe could be extracted." });
    return json(res, 200, { recipe });
  } catch (error) {
    const status = Number(error?.statusCode) || 422;
    return json(res, status, { error: error instanceof Error ? error.message : "The source could not be imported." });
  }
}

async function serveStatic(req, res) {
  const requestPath = new URL(req.url, "http://localhost").pathname;
  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, "");
  const path = join(root, safe);
  if (!path.startsWith(root)) {
    res.writeHead(403, securityHeaders());
    return res.end("Forbidden");
  }
  try {
    const info = await stat(path);
    const file = info.isDirectory() ? join(path, "index.html") : path;
    const data = await readFile(file);
    res.writeHead(200, securityHeaders({
      "content-type": mime[extname(file)] ?? "application/octet-stream",
      "cache-control": extname(file) === ".html" ? "no-cache" : "public, max-age=3600"
    }));
    if (req.method === "HEAD") return res.end();
    res.end(data);
  } catch {
    try {
      const data = await readFile(join(root, "index.html"));
      res.writeHead(200, securityHeaders({ "content-type": mime[".html"], "cache-control": "no-cache" }));
      if (req.method === "HEAD") return res.end();
      res.end(data);
    } catch {
      res.writeHead(404, securityHeaders());
      res.end("Not found");
    }
  }
}

export const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/health") {
    return json(res, 200, {
      ok: true,
      version: "0.2.0",
      aiExtraction: aiEnabled(),
      commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || null
    });
  }
  if (req.method === "POST" && req.url === "/api/import") return handleImport(req, res);
  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
  res.writeHead(405, securityHeaders({ allow: "GET, HEAD, POST" }));
  res.end("Method not allowed");
});

if (process.env.NODE_ENV !== "test") {
  server.listen(port, "0.0.0.0", () => console.log(`KitchenKeep running on http://0.0.0.0:${port}`));
}
