import { readFile, writeFile } from "node:fs/promises";

async function patchLiteral(path, from, to) {
  let source = await readFile(path, "utf8");
  if (source.includes(to)) {
    console.log(`${path}: already patched`);
    return;
  }
  if (!source.includes(from)) throw new Error(`Patch anchor not found in ${path}`);
  source = source.replace(from, to);
  await writeFile(path, source);
  console.log(`${path}: patched`);
}

await patchLiteral(
  "src/index.js",
  'return json({ categories: CATEGORIES }, 200, { "Cache-Control": "public, max-age=3600" });',
  'return json({ categories: CATEGORIES }, 200, { "Cache-Control": "no-store, max-age=0" });',
);

let index = await readFile("public/index.html", "utf8");
index = index.replace("<dt>13</dt>", "<dt>14</dt>");
index = index.replace("<h2>Thirteen ways to discover</h2>", "<h2>Fourteen ways to discover</h2>");
await writeFile("public/index.html", index);
console.log("public/index.html: category count updated");

let app = await readFile("public/app.js", "utf8");
app = app.replace(
  'const response = await api("/api/categories");',
  'const response = await api("/api/categories?version=14");',
);
app = app.replace(
  'state.categories = response.categories || {};',
  'state.categories = response.categories || {};\n    if (!Object.hasOwn(state.categories, "Other")) state.categories.Other = ["Other"];',
);
await writeFile("public/app.js", app);
console.log("public/app.js: category cache-bust and Other fallback updated");

await writeFile("scripts/patch-category-sync.mjs", "");
