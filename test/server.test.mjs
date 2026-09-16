import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
const { server } = await import("../server.mjs");

async function withServer(fn) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health endpoint and pasted recipe import work end to end", async () => {
  await withServer(async (base) => {
    const health = await fetch(`${base}/api/health`).then((res) => res.json());
    assert.equal(health.ok, true);
    assert.equal(typeof health.aiExtraction, "boolean");

    const response = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `Fast Eggs\nIngredients\n2 eggs\n1 tbsp butter\nInstructions\n1. Melt the butter in a pan.\n2. Add eggs and cook until set.` })
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.recipe.title, "Fast Eggs");
    assert.equal(data.recipe.ingredients.length, 2);
    assert.equal(data.recipe.steps.length, 2);
  });
});

test("import endpoint rejects private URLs", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1:1/secret" })
    });
    assert.equal(response.status, 422);
    const data = await response.json();
    assert.match(data.error, /Private or local/);
  });
});
