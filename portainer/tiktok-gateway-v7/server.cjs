const http = require("http");
const crypto = require("crypto");

const SITE = String(process.env.ALLOWED_SITE || "")
  .split(/\s+/)
  .filter(Boolean)
  .map((value) => value.replace(/\/+$/, ""))
  .join(" ");
const SECRET = String(process.env.SIGN_SECRET || "");
const RETRY = String(process.env.AUTO_RETRY || "1").trim() !== "0";
const PORT = Number(process.env.PORT || 8080);
function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback;
}

const MAX_ATTEMPTS = Math.floor(clampNumber(process.env.PLAYER_ATTEMPTS, 1, 2, 2));
const WAIT_MS = clampNumber(process.env.PLAYER_WAIT_MS, 8000, 30000, 15000);
const RETRY_BASE_MS = clampNumber(process.env.RETRY_BASE_MS, 2500, 15000, 4500);
const RETRY_JITTER_MS = clampNumber(process.env.RETRY_JITTER_MS, 0, 5000, 1200);
const REVEAL_MS = clampNumber(process.env.FALLBACK_REVEAL_MS, 2500, 15000, 5000);
const REQUESTS_PER_MINUTE = Math.floor(clampNumber(process.env.REQUESTS_PER_MINUTE, 5, 120, 30));
const rateBuckets = new Map();

function sign(id, exp) {
  return crypto.createHmac("sha256", SECRET).update(id + "." + exp).digest("hex");
}

function sameSig(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function clientMain(cfg) {
  var box = document.getElementById("v");
  var note = document.getElementById("s");
  var frame = null;
  var attempt = 0;
  var timer = null;
  var playing = false;
  var done = false;

  function say(text) {
    note.textContent = text;
    note.style.display = text ? "block" : "none";
  }

  function stop() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function showBar() {
    if ((document.body.className || "").indexOf("b") === -1) {
      document.body.className = document.body.className ? document.body.className + " b" : "b";
    }
  }

  function finish() {
    done = true;
    stop();
    say("");
    showBar();
  }

  function load() {
    playing = false;
    if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
    frame = document.createElement("iframe");
    frame.src = cfg.urls[attempt];
    frame.title = "TikTok video player";
    frame.setAttribute("allow", "autoplay; fullscreen; encrypted-media; picture-in-picture");
    frame.setAttribute("allowfullscreen", "");
    box.appendChild(frame);
    var last = attempt >= cfg.urls.length - 1;
    timer = setTimeout(function () {
      if (last) finish();
      else retry(false);
    }, cfg.wait);
  }

  function retry(hard) {
    if (done) return;
    stop();
    if (attempt >= cfg.urls.length - 1) {
      finish();
      return;
    }
    if (!hard && document.activeElement === frame) return;
    say("Reconnecting to TikTok... " + (attempt + 2) + "/" + cfg.urls.length);
    timer = setTimeout(function () {
      attempt += 1;
      load();
    }, cfg.retryBase * (attempt + 1) + Math.floor(Math.random() * cfg.retryJitter));
  }

  window.addEventListener("message", function (event) {
    if (done || !frame || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (_) { return; }
    }
    if (!data || !data["x-tiktok-player"]) return;

    if (data.type === "onPlayerReady") {
      stop();
      say("");
      return;
    }

    if (data.type === "onStateChange") {
      playing = data.value === 1 || data.value === 3;
      return;
    }

    if (data.type === "onPlayerError") {
      var value = data.value || {};
      var code = Number(value.errorCode || data.errorCode || 0);
      var kind = String(value.errorType || data.errorType || "");
      if (code === 1001 || kind === "INVALID_VIDEO") {
        finish();
        return;
      }
      if (code === 3002 || kind === "AUTOPLAY_ERROR") return;
      if (!playing) retry(true);
    }
  });

  load();
  setTimeout(showBar, cfg.reveal);
}

function playerPage(id, user) {
  const player = "https://www.tiktok.com/player/v1/" + id;
  const embed = "https://www.tiktok.com/embed/v2/" + id;
  const candidates = RETRY ? [player, embed] : [player];
  const cfg = {
    urls: candidates.slice(0, MAX_ATTEMPTS),
    wait: WAIT_MS,
    reveal: REVEAL_MS,
    retryBase: RETRY_BASE_MS,
    retryJitter: RETRY_JITTER_MS,
  };
  const open = user ? "https://www.tiktok.com/@" + user + "/video/" + id : "";
  const bar = open
    ? '<a id="o" href="' + esc(open) + '" target="_blank" rel="noopener noreferrer">Watch on TikTok</a>'
    : '<div id="o">If this video does not play, please try again in a minute.</div>';
  const css = "html,body{margin:0;height:100%;background:#000;overflow:hidden;font:13px/1.3 sans-serif}"
    + "#v{position:absolute;top:0;left:0;right:0;bottom:0}"
    + "body.b #v{bottom:30px}"
    + "iframe{display:block;border:0;width:100%;height:100%}"
    + "#s{display:none;position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:2;padding:4px 10px;border-radius:12px;background:rgba(0,0,0,.7);color:#fff;pointer-events:none;white-space:nowrap}"
    + "#o{display:none;position:absolute;left:0;right:0;bottom:0;height:30px;line-height:30px;text-align:center;background:#111;color:#cfd3d8;text-decoration:none}"
    + "body.b #o{display:block}";

  return "<!doctype html><html><head><meta charset=\"utf-8\">"
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><title>Video</title>'
    + "<style>" + css + "</style></head><body>"
    + '<div id="v"></div><div id="s"></div>' + bar
    + "<script>(" + clientMain.toString() + ")(" + JSON.stringify(cfg).replace(/</g, "\\u003c") + ");<\/script>"
    + "</body></html>";
}

function clientKey(req) {
  const cf = String(req.headers["cf-connecting-ip"] || "").trim();
  if (cf) return cf.slice(0, 80);
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (forwarded) return forwarded.slice(0, 80);
  return String(req.socket && req.socket.remoteAddress || "unknown").slice(0, 80);
}

function allowedByRateLimit(req) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const key = clientKey(req);
  const existing = rateBuckets.get(key);
  if (!existing || now - existing.startedAt >= windowMs) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  existing.count += 1;
  return existing.count <= REQUESTS_PER_MINUTE;
}

function handle(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Security-Policy", "frame-ancestors " + (SITE || "'none'"));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex");
  res.setHeader("Cache-Control", "no-store");

  try {
    const url = new URL(req.url, "http://x");

    if (url.pathname === "/health") {
      res.end(
        "OK v7 secret:" + (SECRET ? "set" : "missing")
        + " secretlen:" + SECRET.length
        + " site:" + (SITE ? "set" : "missing")
        + " retry:" + (RETRY ? "on" : "off")
        + " attempts:" + MAX_ATTEMPTS
        + " rpm:" + REQUESTS_PER_MINUTE,
      );
      return;
    }

    if (!allowedByRateLimit(req)) {
      res.statusCode = 429;
      res.setHeader("Retry-After", "60");
      res.end("Too Many Requests");
      return;
    }

    const sourceUrl = (url.searchParams.get("url") || "").slice(0, 300);
    const exp = url.searchParams.get("exp") || "";
    const sig = url.searchParams.get("sig") || "";
    const videoMatch = sourceUrl.match(/video\/(\d+)/);
    const expNumber = Number(exp);
    let why = "";

    if (!SECRET) why = "no-secret";
    else if (!videoMatch || videoMatch[1].length > 25) why = "bad-url";
    else if (!exp || !Number.isFinite(expNumber)) why = "bad-exp";
    else if (expNumber < Date.now() / 1000) why = "expired";
    else if (!sameSig(sig, sign(videoMatch[1], exp))) why = "bad-sig";

    if (why) {
      if (why !== "bad-url") console.log("403", why);
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    const userMatch = sourceUrl.match(/@([A-Za-z0-9_.]+)\/video\//);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.end(playerPage(videoMatch[1], userMatch ? userMatch[1] : ""));
  } catch (error) {
    console.error("gateway error", error && error.stack ? error.stack : error);
    res.statusCode = 500;
    res.end("Error");
  }
}

http.createServer(handle).listen(PORT, "0.0.0.0", function () {
  console.log("gateway v7 listening on " + PORT);
});
