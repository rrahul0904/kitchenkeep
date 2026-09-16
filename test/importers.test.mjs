import test from "node:test";
import assert from "node:assert/strict";
import { extractRecipeFromHtml, extractRecipeFromText } from "../lib/recipe-parser.mjs";
import { parseYouTubePlayerResponse, transcriptFromJson3, youtubeMetadata } from "../lib/youtube.mjs";
import { extractTextFromPdf } from "../lib/pdf-text.mjs";

test("plain text recipe extracts sections", () => {
  const recipe = extractRecipeFromText(`Weeknight Soup\nServes 2\n\nIngredients\n1 tbsp olive oil\n2 cups tomatoes\n1 tsp salt\n\nInstructions\n1. Heat the oil in a pot.\n2. Add tomatoes and simmer for 10 minutes.\n3. Season with salt and serve.`);
  assert.equal(recipe.title, "Weeknight Soup");
  assert.equal(recipe.servings, 2);
  assert.equal(recipe.ingredients.length, 3);
  assert.equal(recipe.steps.length, 3);
  assert.equal(recipe.sourceType, "text");
});

test("HTML without JSON-LD falls back to readable text", () => {
  const html = `<article><h1>Garlic Toast</h1><h2>Ingredients</h2><ul><li>2 slices bread</li><li>1 tbsp butter</li><li>1 clove garlic</li></ul><h2>Instructions</h2><ol><li>Toast the bread until golden.</li><li>Mix butter with garlic and spread it over the toast.</li></ol></article>`;
  const recipe = extractRecipeFromHtml(html, "https://example.com/garlic-toast");
  assert.equal(recipe.title, "Garlic Toast");
  assert.equal(recipe.extractionMethod, "html-text-heuristic");
  assert.equal(recipe.ingredients.length, 3);
  assert.equal(recipe.steps.length, 2);
});

test("YouTube player response parser finds metadata and caption tracks", () => {
  const player = { videoDetails: { title: "Pasta", shortDescription: "Ingredients\\n2 cups pasta", author: "Chef" }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: "en", baseUrl: "https://example.com/caption" }] } } };
  const html = `<script>var x=1; ytInitialPlayerResponse = ${JSON.stringify(player)};</script>`;
  const parsed = parseYouTubePlayerResponse(html);
  const meta = youtubeMetadata(parsed);
  assert.equal(meta.title, "Pasta");
  assert.equal(meta.author, "Chef");
  assert.equal(meta.captionTracks.length, 1);
});

test("YouTube json3 transcript flattens segments", () => {
  const text = transcriptFromJson3({ events: [{ segs: [{ utf8: "Heat " }, { utf8: "the pan" }] }, { segs: [{ utf8: "Add oil" }] }] });
  assert.equal(text, "Heat the pan\nAdd oil");
});

test("basic PDF text operators are readable", () => {
  const pdf = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length 90 >>\nstream\nBT\n(Recipe Demo) Tj\n(Ingredients) Tj\n(2 cups flour) Tj\n(Instructions) Tj\n(Mix flour with water.) Tj\nET\nendstream\nendobj\n%%EOF`, "latin1");
  const text = extractTextFromPdf(pdf);
  assert.match(text, /Recipe Demo/);
  assert.match(text, /2 cups flour/);
});
