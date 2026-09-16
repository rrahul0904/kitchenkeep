import test from "node:test";
import assert from "node:assert/strict";
import { aggregateGroceries, normalizeIngredientName, parseIngredient } from "../lib/ingredients.mjs";
import { extractRecipeFromHtml } from "../lib/recipe-parser.mjs";

test("ingredient aliases converge", () => {
  assert.equal(normalizeIngredientName("Scallions"), "green onion");
  assert.equal(normalizeIngredientName("Spring onions"), "green onion");
});

test("fractional ingredient quantities parse", () => {
  assert.deepEqual(parseIngredient("1 1/2 cups flour"), { quantity: 1.5, unit: "cups", name: "flour", raw: "1 1/2 cups flour" });
});

test("grocery aggregation combines aliases", () => {
  const recipes = [
    { ingredients: [{ quantity: 2, unit: "item", name: "scallions" }] },
    { ingredients: [{ quantity: 3, unit: "item", name: "green onions" }] }
  ];
  const list = aggregateGroceries(recipes);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "green onion");
  assert.equal(list[0].quantities.item, 5);
});

test("Recipe JSON-LD extracts into normalized card", () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context":"https://schema.org","@type":"Recipe",name:"Tomato Toast",recipeYield:"2 servings",prepTime:"PT5M",cookTime:"PT10M",recipeIngredient:["2 slices bread","1 tomato"],recipeInstructions:[{"@type":"HowToStep",text:"Toast the bread."},{"@type":"HowToStep",text:"Top with tomato."}]
  })}</script></head></html>`;
  const recipe = extractRecipeFromHtml(html, "https://example.com/toast");
  assert.equal(recipe.title, "Tomato Toast");
  assert.equal(recipe.servings, 2);
  assert.equal(recipe.prepMinutes, 5);
  assert.equal(recipe.steps.length, 2);
  assert.equal(recipe.ingredients[0].quantity, 2);
});
