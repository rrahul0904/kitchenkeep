function parseJsonObjectAt(source, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

export function isYouTubeUrl(value) {
  try {
    const url = new URL(value);
    return ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function parseYouTubePlayerResponse(html) {
  const markers = ["ytInitialPlayerResponse =", "ytInitialPlayerResponse="];
  for (const marker of markers) {
    const index = html.indexOf(marker);
    if (index < 0) continue;
    const start = html.indexOf("{", index + marker.length);
    if (start < 0) continue;
    const raw = parseJsonObjectAt(html, start);
    if (!raw) continue;
    try { return JSON.parse(raw); } catch { /* continue */ }
  }
  return null;
}

export function youtubeMetadata(player) {
  const details = player?.videoDetails || {};
  const micro = player?.microformat?.playerMicroformatRenderer || {};
  return {
    title: details.title || micro.title?.simpleText || "YouTube recipe",
    description: details.shortDescription || micro.description?.simpleText || "",
    author: details.author || micro.ownerChannelName || "YouTube",
    captionTracks: player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []
  };
}

export function transcriptFromJson3(payload) {
  const lines = [];
  for (const event of payload?.events || []) {
    const text = (event?.segs || []).map((segment) => segment?.utf8 || "").join("").replace(/\n/g, " ").trim();
    if (text) lines.push(text);
  }
  return lines.join("\n");
}
