import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const loader = readFileSync(new URL("../public/saiyaara-tagembed.js", import.meta.url), "utf8");
const home = readFileSync(new URL("../public/home-player.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("Saiyaara Tagembed keeps the cached poster until media is detected", () => {
  assert.match(loader, /saiyaara-tagembed-overlay/);
  assert.match(loader, /saiyaara-tagembed-poster/);
  assert.match(loader, /data-saiyaara-tagembed-status/);
  assert.match(loader, /SCRIPT_TIMEOUT = 12000/);
  assert.match(loader, /tagembedState === "ready"/);
  assert.match(loader, /widget\.tagembed\.com\/embed\.min\.js/);
  assert.match(loader, /new MutationObserver/);
  assert.match(styles, /\.saiyaara-tagembed-poster/);
});

test("Saiyaara Tagembed allows visible media autoplay only if the browser permits", () => {
  assert.match(loader, /permissions\.add\("autoplay"\)/);
  assert.match(loader, /video\.playsInline = true/);
  assert.match(loader, /video\.autoplay = true/);
  assert.match(loader, /video\.muted = true/);
  assert.match(loader, /data-saiyaara-tagembed-play/);
  assert.match(loader, /video\.muted = false/);
  assert.match(loader, /revealAndPlay/);
  assert.doesNotMatch(loader, /player\/v1\//);
});

test("cached home TikTok metadata cannot overwrite the Saiyaara mini player", () => {
  assert.match(home, /card\.classList\.contains\("saiyaara-tagembed-tile"\)/);
  assert.match(home, /img\.src = preview\.thumbnail_url/);
  assert.match(home, /saiyaaraPoster/);
  assert.match(home, /VidBestSaiyaaraTagembed\.mount/);
});
