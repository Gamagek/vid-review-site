import { readFile, writeFile } from "node:fs/promises";

async function patch(path, replacements) {
  let source = await readFile(path, "utf8");
  for (const [from, to] of replacements) {
    if (!source.includes(from)) throw new Error(`Patch anchor not found in ${path}`);
    source = source.replace(from, to);
  }
  await writeFile(path, source);
}

await patch("public/admin.js", [
  [
    '    primary_category: ui.category.value,\n    subcategory: ui.subcategory.value,\n    thumbnail_url: ui.thumbnail.value,',
    '    primary_category: ui.category.value,\n    subcategory: ui.category.value === "Other" ? ui.otherSubcategory.value.trim() : ui.subcategory.value,\n    thumbnail_url: ui.thumbnail.value,',
  ],
]);

await patch("src/index.js", [
  [
    '  if (subcategory && (!category || !CATEGORIES[category].includes(subcategory))) {\n    throw new AppError(400, "Unknown subcategory for the selected category");\n  }',
    '  if (subcategory && (!category || (category !== "Other" && !CATEGORIES[category].includes(subcategory)))) {\n    throw new AppError(400, "Unknown subcategory for the selected category");\n  }',
  ],
]);
