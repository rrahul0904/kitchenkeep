import crypto from "node:crypto";
import { parseIngredient } from "./ingredients.mjs";

function minutesFromDuration(duration) {
  if (!duration) return undefined;
  const match = String(duration).match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!match) return undefined;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

function flattenInstructions(value) {
  if (!value) return [];
  if (typeof value === "string") return value.split(/\n+/).map((step) => step.trim()).filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object") return [];
    if (typeof item.text === "string") return [item.text];
    if (Array.isArray(item.itemListElement)) return flattenInstructions(item.itemListElement);
    return [];
  }).map((step) => decodeEntities(String(step).replace(/<[^>]+>/g, "")).trim()).filter(Boolean);
}

function findRecipeJson(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecipeJson(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const type = value["@type"];
  if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) return value;
  if (value["@graph"]) return findRecipeJson(value["@graph"]);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = findRecipeJson(child);
      if (found) return found;
    }
  }
  return null;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function text(value) {
  return typeof value === "string" ? decodeEntities(value.replace(/<[^>]+>/g, "")).trim() : undefined;
}

function sourceNameFromUrl(sourceUrl) {
  try { return new URL(sourceUrl).hostname.replace(/^www\./, ""); } catch { return "Imported"; }
}

function baseRecipe({ title, description, sourceUrl, sourceName, sourceType, extractionMethod, confidence, servings, prepMinutes, cookMinutes, ingredients, steps, tags }) {
  return {
    id: crypto.randomUUID(),
    title: title || "Imported recipe",
    description: description || undefined,
    sourceUrl: sourceUrl || undefined,
    sourceName: sourceName || sourceNameFromUrl(sourceUrl),
    sourceType: sourceType || "web",
    extractionMethod: extractionMethod || "heuristic",
    confidence: Number.isFinite(confidence) ? confidence : 0.6,
    servings: Number(servings) > 0 ? Number(servings) : 4,
    prepMinutes: Number(prepMinutes) >= 0 ? Number(prepMinutes) : undefined,
    cookMinutes: Number(cookMinutes) >= 0 ? Number(cookMinutes) : undefined,
    ingredients: ingredients || [],
    steps: steps || [],
    tags: (tags || []).filter(Boolean).slice(0, 6),
    createdAt: new Date().toISOString()
  };
}

function fromStructuredData(data, sourceUrl) {
  const imageValue = data.image;
  const image = typeof imageValue === "string" ? imageValue : Array.isArray(imageValue) ? String(imageValue[0] ?? "") : imageValue && typeof imageValue === "object" ? String(imageValue.url ?? "") : undefined;
  const ingredients = Array.isArray(data.recipeIngredient) ? data.recipeIngredient.map((item) => parseIngredient(String(item))).filter((item) => item.name) : [];
  const steps = flattenInstructions(data.recipeInstructions);
  if (!ingredients.length && !steps.length) return null;
  const yieldText = Array.isArray(data.recipeYield) ? data.recipeYield[0] : data.recipeYield;
  return {
    ...baseRecipe({
      title: text(data.name),
      description: text(data.description),
      sourceUrl,
      sourceType: "web",
      extractionMethod: "schema.org/Recipe",
      confidence: 0.98,
      servings: Number(String(yieldText ?? "4").match(/\d+(?:\.\d+)?/)?.[0] ?? 4),
      prepMinutes: minutesFromDuration(data.prepTime),
      cookMinutes: minutesFromDuration(data.cookTime),
      ingredients,
      steps,
      tags: [data.recipeCategory, data.recipeCuisine].flat().filter((value) => typeof value === "string")
    }),
    image: image || undefined
  };
}

export function stripHtmlToText(html) {
  return decodeEntities(String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br|\/p|\/li|\/div|\/h[1-6]|\/section|\/article)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanLine(line) {
  return String(line || "").replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
}

function looksLikeIngredient(line) {
  const value = cleanLine(line);
  if (!value || value.length > 180) return false;
  return /^(?:\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\s*(?:[a-zA-Z]+\b)?\s+/.test(value) || /\b(?:cup|cups|tbsp|tablespoons?|tsp|teaspoons?|grams?|kg|g|ml|liters?|oz|ounces?|lb|pounds?|cloves?|pinch|handful)\b/i.test(value);
}

function looksLikeStep(line) {
  const value = cleanLine(line);
  if (value.length < 16 || value.length > 700) return false;
  return /^(?:add|bake|beat|blend|boil|bring|chop|combine|cook|drain|fold|heat|mix|place|pour|preheat|reduce|roast|season|serve|simmer|stir|toss|whisk|transfer|slice|cut|melt|spread|cover|remove)\b/i.test(value) || /^\d+[.)]\s+/.test(String(line).trim());
}

function sectionIndexes(lines) {
  let ingredients = -1;
  let steps = -1;
  lines.forEach((line, index) => {
    const normalized = cleanLine(line).toLowerCase().replace(/:$/, "");
    if (ingredients < 0 && /^(ingredients|what you need|you will need)$/.test(normalized)) ingredients = index;
    if (steps < 0 && /^(instructions|directions|method|steps|preparation|how to make it)$/.test(normalized)) steps = index;
  });
  return { ingredients, steps };
}

function guessTitle(lines, sourceName) {
  const blocked = /^(ingredients|instructions|directions|method|steps|preparation|recipe|servings?|yield|prep|cook|total)/i;
  return cleanLine(lines.find((line) => {
    const v = cleanLine(line);
    return v.length >= 3 && v.length <= 100 && !blocked.test(v) && !looksLikeIngredient(v) && !looksLikeStep(v);
  }) || sourceName || "Imported recipe");
}

export function extractRecipeFromText(rawText, options = {}) {
  const content = decodeEntities(String(rawText || "")).replace(/\r/g, "").trim();
  if (!content) return null;
  const lines = content.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 1500);
  if (!lines.length) return null;
  const { ingredients: ingredientHeader, steps: stepHeader } = sectionIndexes(lines);
  let ingredientLines = [];
  let stepLines = [];

  if (ingredientHeader >= 0) {
    const end = stepHeader > ingredientHeader ? stepHeader : Math.min(lines.length, ingredientHeader + 80);
    ingredientLines = lines.slice(ingredientHeader + 1, end).filter(looksLikeIngredient);
  }
  if (stepHeader >= 0) {
    stepLines = lines.slice(stepHeader + 1, stepHeader + 80).map(cleanLine).filter((line) => line.length > 10);
  }
  if (!ingredientLines.length) ingredientLines = lines.filter(looksLikeIngredient).slice(0, 60);
  if (!stepLines.length) stepLines = lines.filter(looksLikeStep).map(cleanLine).slice(0, 40);

  const ingredients = ingredientLines.map((line) => parseIngredient(cleanLine(line))).filter((item) => item.name);
  const uniqueSteps = [...new Set(stepLines)].filter((step) => !looksLikeIngredient(step));
  if (!ingredients.length && !uniqueSteps.length) return null;
  const sourceName = options.sourceName || (options.sourceUrl ? sourceNameFromUrl(options.sourceUrl) : "Text import");
  const servingMatch = content.match(/(?:serves|servings?|yield)\s*[:\-]?\s*(\d+(?:\.\d+)?)/i);
  const prepMatch = content.match(/prep(?:aration)?\s*(?:time)?\s*[:\-]?\s*(\d+)\s*(?:min|minutes?)/i);
  const cookMatch = content.match(/cook(?:ing)?\s*(?:time)?\s*[:\-]?\s*(\d+)\s*(?:min|minutes?)/i);

  return baseRecipe({
    title: options.title || guessTitle(lines, sourceName),
    description: options.description,
    sourceUrl: options.sourceUrl,
    sourceName,
    sourceType: options.sourceType || "text",
    extractionMethod: options.extractionMethod || "section-heuristic",
    confidence: ingredients.length >= 3 && uniqueSteps.length >= 2 ? 0.75 : 0.55,
    servings: servingMatch ? Number(servingMatch[1]) : 4,
    prepMinutes: prepMatch ? Number(prepMatch[1]) : undefined,
    cookMinutes: cookMatch ? Number(cookMatch[1]) : undefined,
    ingredients,
    steps: uniqueSteps,
    tags: options.tags || []
  });
}

export function extractRecipeFromHtml(html, sourceUrl) {
  const scripts = [...String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const json = JSON.parse(script[1].trim());
      const data = findRecipeJson(json);
      if (!data) continue;
      const recipe = fromStructuredData(data, sourceUrl);
      if (recipe) return recipe;
    } catch {
      // Ignore malformed blocks and continue to the next JSON-LD script.
    }
  }
  const fallbackText = stripHtmlToText(html);
  return extractRecipeFromText(fallbackText, {
    sourceUrl,
    sourceType: "web",
    sourceName: sourceNameFromUrl(sourceUrl),
    extractionMethod: "html-text-heuristic"
  });
}
