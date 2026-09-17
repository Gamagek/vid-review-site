import { readFile, writeFile } from "node:fs/promises";

async function patchEmbeddedShare() {
  const path = "public/watch.js";
  let source = await readFile(path, "utf8");
  const start = source.indexOf("function initializeEmbeddedMediaTools()");
  if (start < 0) throw new Error("Embedded player function was not found");
  const next = source.indexOf("\nfunction ", start + 10);
  const end = next > 0 ? next : source.length;
  const block = source.slice(start, end);

  if (!block.includes('button("Share", "Share this Vid.Best page"')) {
    const pip = block.match(/^[ \t]*const pip = .*?;$/m);
    if (!pip) throw new Error("Embedded PiP control anchor was not found");
    const shareLine = '  const share = button("Share", "Share this Vid.Best page", function() { shareWatchPage(); });';
    const patchedBlock = block.replace(pip[0], `${pip[0]}\n${shareLine}`);
    if (patchedBlock === block) throw new Error("Unable to insert embedded Share control");
    const appendMatch = patchedBlock.match(/([ \t]*)overlay\.append\(/);
    if (!appendMatch) throw new Error("Embedded overlay append call was not found");
    const appended = patchedBlock.replace(appendMatch[0], `${appendMatch[1]}overlay.append(share, `);
    source = source.slice(0, start) + appended + source.slice(end);
  }
  await writeFile(path, source);
}

async function patchCategories() {
  const path = "src/index.js";
  let source = await readFile(path, "utf8");
  if (!source.includes('  Spirituality: [')) {
    const anchor = '  "Social Media & Trending": [\n    "YouTube Trends",\n    "TikTok Viral Challenges",\n    "Facebook Reels Highlights",\n    "Instagram Reels",\n    "Creator News & Drama",\n  ],';
    const category = `${anchor}\n  Spirituality: [\n    "Buddhism",\n    "Hinduism",\n    "Christianity",\n    "Islam",\n    "Meditation & Mindfulness",\n    "Spiritual Philosophy",\n    "Sacred Texts & Teachings",\n    "Devotional Practices",\n    "Contemplative Traditions",\n    "Interfaith & Comparative Spirituality",\n  ],`;
    if (!source.includes(anchor)) throw new Error("Category insertion anchor was not found");
    source = source.replace(anchor, category);
  }
  await writeFile(path, source);
}

async function patchHomepageText() {
  const path = "public/index.html";
  let source = await readFile(path, "utf8");
  source = source.replace("<dt>12</dt>", "<dt>13</dt>");
  source = source.replace("<h2>Twelve ways to discover</h2>", "<h2>Thirteen ways to discover</h2>");
  await writeFile(path, source);
}

async function restoreDeployPermissions() {
  const path = ".github/workflows/deploy.yml";
  let source = await readFile(path, "utf8");
  source = source.replace(/permissions:\n  contents: write/, "permissions:\n  contents: read");
  await writeFile(path, source);
}

await patchEmbeddedShare();
await patchCategories();
await patchHomepageText();
await restoreDeployPermissions();
console.log("Applied embedded Share and Spirituality category patches and restored read-only deployment permissions.");
