import crypto from "node:crypto";

const RECIPE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    description: { type: ["string", "null"] },
    servings: { type: ["number", "null"] },
    prepMinutes: { type: ["number", "null"] },
    cookMinutes: { type: ["number", "null"] },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          name: { type: "string" },
          raw: { type: "string" }
        },
        required: ["quantity", "unit", "name", "raw"]
      }
    },
    steps: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } }
  },
  required: ["title", "description", "servings", "prepMinutes", "cookMinutes", "ingredients", "steps", "tags"]
};

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

export function aiEnabled() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function extractRecipeWithAI({ text, buffer, mimeType, filename, sourceUrl, sourceName, sourceType = "ai" }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("AI media extraction is not configured. Set OPENAI_API_KEY to enable image/PDF and AI fallback imports.");

  const content = [{
    type: "input_text",
    text: "Extract the cooking recipe from the supplied content. Preserve the original units and language where possible. Do not invent missing ingredients or steps. Return only the structured recipe."
  }];
  if (text) content.push({ type: "input_text", text: text.slice(0, 120_000) });
  if (buffer) {
    const data = buffer.toString("base64");
    if (String(mimeType).startsWith("image/")) {
      content.push({ type: "input_image", image_url: `data:${mimeType};base64,${data}`, detail: "high" });
    } else {
      content.push({ type: "input_file", file_data: data, filename: filename || "recipe.pdf" });
    }
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "recipe",
          strict: true,
          schema: RECIPE_SCHEMA
        }
      }
    })
  });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 800);
    throw new Error(`AI extraction failed (HTTP ${response.status})${details ? `: ${details}` : "."}`);
  }
  const payload = await response.json();
  const raw = outputText(payload);
  if (!raw) throw new Error("AI extraction returned no recipe content.");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.ingredients) || !Array.isArray(data.steps) || (!data.ingredients.length && !data.steps.length)) {
    throw new Error("AI extraction did not find a usable recipe.");
  }
  return {
    id: crypto.randomUUID(),
    title: data.title || "Imported recipe",
    description: data.description || undefined,
    sourceUrl: sourceUrl || undefined,
    sourceName: sourceName || filename || "AI import",
    sourceType,
    extractionMethod: "openai-structured",
    confidence: 0.9,
    servings: Number(data.servings) > 0 ? Number(data.servings) : 4,
    prepMinutes: Number(data.prepMinutes) >= 0 ? Number(data.prepMinutes) : undefined,
    cookMinutes: Number(data.cookMinutes) >= 0 ? Number(data.cookMinutes) : undefined,
    ingredients: data.ingredients.map((item) => ({
      quantity: Number(item.quantity) > 0 ? Number(item.quantity) : undefined,
      unit: item.unit || undefined,
      name: String(item.name || "").trim(),
      raw: String(item.raw || item.name || "").trim()
    })).filter((item) => item.name),
    steps: data.steps.map((step) => String(step).trim()).filter(Boolean),
    tags: data.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 6),
    createdAt: new Date().toISOString()
  };
}
