const ALIASES = {
  scallion: "green onion",
  scallions: "green onion",
  "green onions": "green onion",
  "spring onion": "green onion",
  "spring onions": "green onion",
  cilantro: "coriander",
  "coriander leaves": "coriander",
  capsicum: "bell pepper",
  "bell peppers": "bell pepper",
  "garbanzo bean": "chickpea",
  "garbanzo beans": "chickpea",
  chickpeas: "chickpea",
  "confectioners sugar": "powdered sugar",
  "icing sugar": "powdered sugar"
};

const UNIT_ALIASES = {
  tablespoon: "tbsp", tablespoons: "tbsp", tbsp: "tbsp",
  teaspoon: "tsp", teaspoons: "tsp", tsp: "tsp",
  cup: "cup", cups: "cup",
  gram: "g", grams: "g", g: "g",
  kilogram: "kg", kilograms: "kg", kg: "kg",
  ounce: "oz", ounces: "oz", oz: "oz",
  pound: "lb", pounds: "lb", lb: "lb",
  milliliter: "ml", milliliters: "ml", ml: "ml",
  liter: "l", liters: "l", l: "l"
};

export function normalizeIngredientName(input) {
  let value = String(input || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(fresh|finely|roughly|chopped|diced|minced|sliced|optional|to taste|divided)\b/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  value = ALIASES[value] ?? value;
  if (value.endsWith("s") && !value.endsWith("ss") && !ALIASES[value]) value = value.slice(0, -1);
  return ALIASES[value] ?? value;
}

export function normalizeUnit(unit) {
  if (!unit) return "item";
  const key = String(unit).toLowerCase().replace(/\./g, "").trim();
  return UNIT_ALIASES[key] ?? key;
}

export function parseIngredient(raw) {
  const cleaned = String(raw).replace(/^[-•]\s*/, "").trim();
  const fractionMap = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875 };
  const unicodeFraction = Object.keys(fractionMap).find((fraction) => cleaned.startsWith(fraction));
  const match = cleaned.match(/^(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*([a-zA-Z]+)?\s+(.*)$/);
  if (!match && unicodeFraction) {
    const rest = cleaned.slice(unicodeFraction.length).trim();
    const unitMatch = rest.match(/^([a-zA-Z]+)\s+(.*)$/);
    return { quantity: fractionMap[unicodeFraction], unit: unitMatch?.[1], name: unitMatch?.[2] ?? rest, raw: cleaned };
  }
  if (!match) return { name: cleaned, raw: cleaned };
  const quantityText = match[1];
  let quantity;
  if (quantityText.includes(" ")) {
    const [whole, fraction] = quantityText.split(" ");
    const [n, d] = fraction.split("/").map(Number);
    quantity = Number(whole) + n / d;
  } else if (quantityText.includes("/")) {
    const [n, d] = quantityText.split("/").map(Number);
    quantity = n / d;
  } else quantity = Number(quantityText);
  return { quantity, unit: match[2], name: match[3], raw: cleaned };
}

export function aggregateGroceries(recipes, checked = new Set()) {
  const map = new Map();
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients || []) {
      const key = normalizeIngredientName(ingredient.name);
      if (!key) continue;
      const unit = normalizeUnit(ingredient.unit);
      const existing = map.get(key) ?? { name: key, displayName: ingredient.name, quantities: {}, rawItems: [], checked: checked.has(key) };
      if (Number.isFinite(ingredient.quantity) && ingredient.quantity > 0) existing.quantities[unit] = (existing.quantities[unit] ?? 0) + ingredient.quantity;
      if (ingredient.raw) existing.rawItems.push(ingredient.raw);
      map.set(key, existing);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
