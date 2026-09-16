import { readFile, writeFile } from "node:fs/promises";

const path = "public/watch.js";
let source = await readFile(path, "utf8");

if (!source.includes("function initializeEmbeddedMediaTools()")) {
  throw new Error("Embedded player function was not found");
}

const oldShare = 'const share = button("Share", "Share this Vid.Best page", function() { shareWatchPage(); });';
if (!source.includes(oldShare)) {
  const anchor = '  const pip = button("▣ PiP", "Picture in Picture", embeddedPiP);';
  if (!source.includes(anchor)) throw new Error("Embedded PiP control anchor was not found");
  source = source.replace(anchor, `${anchor}\n  ${oldShare}`);
}

const oldAppend = '  overlay.append(play, back, forward, speed, captions, mute, pip, pop, full, note);';
const newAppend = '  overlay.append(play, back, forward, speed, captions, mute, pip, share, pop, full, note);';
if (source.includes(oldAppend)) source = source.replace(oldAppend, newAppend);

const nativeShare = 'async function shareWatchPage() {';
if (!source.includes(nativeShare)) throw new Error("Universal share function was not found");

await writeFile(path, source);
console.log("Embedded Share control patched; it uses the current Vid.Best watch-page URL.");
