import { readFile, writeFile } from "node:fs/promises";

async function patch(path, replacements) {
  let source = await readFile(path, "utf8");
  for (const [from, to] of replacements) {
    if (!source.includes(from)) throw new Error(`Patch anchor not found in ${path}`);
    source = source.replace(from, to);
  }
  await writeFile(path, source);
}

await patch("src/index.js", [
  [
    '    "Interfaith & Comparative Spirituality",\n  ],\n});',
    '    "Interfaith & Comparative Spirituality",\n  ],\n  Other: [\n    "Other",\n  ],\n});',
  ],
  [
    '  if (subcategory && (!category || !CATEGORIES[category].includes(subcategory))) {\n    throw new AppError(400, "Unknown subcategory for the selected category");\n  }',
    '  if (subcategory && category !== "Other" && (!category || !CATEGORIES[category].includes(subcategory))) {\n    throw new AppError(400, "Unknown subcategory for the selected category");\n  }',
  ],
  [
    '  if (!CATEGORIES[category].includes(subcategory)) throw new AppError(400, "Select a valid subcategory");',
    '  if (category !== "Other" && !CATEGORIES[category].includes(subcategory)) throw new AppError(400, "Select a valid subcategory");',
  ],
]);

await patch("public/admin.html", [
  [
    '<label><span>Subcategory</span><select id="admin-subcategory" name="subcategory" required disabled><option value="">Choose subcategory</option></select></label>',
    '<label><span>Subcategory</span><select id="admin-subcategory" name="subcategory" required disabled><option value="">Choose subcategory</option></select><input id="admin-other-subcategory" type="text" maxlength="80" placeholder="Type your subcategory" autocomplete="off" hidden></label>',
  ],
  [
    '<p>Choose a world, then narrow it to exactly what interests you.',
    '<p>Choose a world, then narrow it to exactly what interests you.',
  ],
]);

await patch("public/admin.js", [
  [
    '  subcategory: document.querySelector("#admin-subcategory"),\n  title:',
    '  subcategory: document.querySelector("#admin-subcategory"),\n  otherSubcategory: document.querySelector("#admin-other-subcategory"),\n  title:',
  ],
  [
    '  ui.category.addEventListener("change", () => fillSubcategories(ui.category.value));',
    '  ui.category.addEventListener("change", () => fillSubcategories(ui.category.value));\n  ui.otherSubcategory.addEventListener("input", syncOtherSubcategory);',
  ],
  [
    'function fillSubcategories(category, selected = "") {\n  ui.subcategory.innerHTML = \'<option value="">Choose subcategory</option>\';\n  const list = adminState.categories[category] || [];\n  ui.subcategory.disabled = list.length === 0;\n  list.forEach((subcategory) => {\n    const option = document.createElement("option");\n    option.value = subcategory;\n    option.textContent = subcategory;\n    ui.subcategory.append(option);\n  });\n  if (selected && list.includes(selected)) ui.subcategory.value = selected;\n}',
    'function fillSubcategories(category, selected = "") {\n  ui.subcategory.innerHTML = \'<option value="">Choose subcategory</option>\';\n  const list = adminState.categories[category] || [];\n  ui.subcategory.disabled = list.length === 0;\n  ui.otherSubcategory.hidden = category !== "Other";\n  ui.otherSubcategory.required = category === "Other";\n  ui.otherSubcategory.value = category === "Other" && selected && selected !== "Other" ? selected : "";\n  list.forEach((subcategory) => {\n    const option = document.createElement("option");\n    option.value = subcategory;\n    option.textContent = subcategory;\n    ui.subcategory.append(option);\n  });\n  if (selected && list.includes(selected)) ui.subcategory.value = selected;\n}',
  ],
  [
    'function setSourceMode(mode) {',
    'function syncOtherSubcategory() {\n  if (ui.category.value !== "Other") return;\n  const value = ui.otherSubcategory.value.trim();\n  const existing = [...ui.subcategory.options].find((option) => option.dataset.custom === "1");\n  if (existing) existing.remove();\n  const option = document.createElement("option");\n  option.value = value;\n  option.textContent = value || "Type your subcategory";\n  option.dataset.custom = "1";\n  option.hidden = !value;\n  ui.subcategory.append(option);\n  ui.subcategory.value = value;\n}\n\nfunction setSourceMode(mode) {',
  ],
  [
    '    subcategory: ui.subcategory.value,',
    '    subcategory: ui.category.value === "Other" ? ui.otherSubcategory.value.trim() : ui.subcategory.value,',
  ],
]);

await writeFile("scripts/patch-other-category.mjs", "");
