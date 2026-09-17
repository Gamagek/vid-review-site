import { readFile, writeFile } from "node:fs/promises";

let source = await readFile("public/admin.js", "utf8");
const from = '    primary_category: ui.category.value,\n    subcategory: ui.subcategory.value,\n    thumbnail_url: ui.thumbnail.value,';
const to = '    primary_category: ui.category.value,\n    subcategory: ui.category.value === "Other" ? ui.otherSubcategory.value.trim() : ui.subcategory.value,\n    thumbnail_url: ui.thumbnail.value,';
if (!source.includes(from)) throw new Error("Patch anchor not found in public/admin.js");
source = source.replace(from, to);
await writeFile("public/admin.js", source);
