import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContext, runInContext } from "node:vm";

const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
const source = readFileSync(new URL("../public/admin.js", import.meta.url), "utf8");

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.value = "";
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = new Map();
    this.classList = { toggle() {} };
    this.scrollTop = 0;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() {}
}

function editor(fetch) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [`#${match[1]}`, new Element()]));
  const tabs = ["link", "upload"].map((mode) => Object.assign(new Element("button"), { dataset: { mode } }));
  const context = createContext({
    document: {
      querySelector: (selector) => elements.get(selector) || null,
      querySelectorAll: () => tabs,
      addEventListener() {},
      createElement: (tag) => new Element(tag),
    },
    window: { clearTimeout, setTimeout, scrollTo() {} },
    fetch, AbortController, setTimeout, clearTimeout, URL, console,
  });
  runInContext(source, context);
  return {
    call: (expression) => runInContext(expression, context),
    state: runInContext("adminState", context),
    elements,
  };
}

function records(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: count - index,
    slug: `review-${count - index}`,
    title: index === count - 1 ? "Oldest saved review" : `Saved video ${count - index}`,
    primary_category: "Technology",
    subcategory: "Web Development",
    published: index !== count - 1,
    created_at: "2026-10-10T00:00:00Z",
  }));
}

function pageResponse(videos, offset = 0) {
  return Response.json({ videos: videos.slice(offset, offset + 48), pagination: { limit: 48, offset, total: videos.length } });
}

test("admin event setup works with the manual editor and no AI controls", () => {
  const app = editor(async () => Response.json({}));
  assert.equal(app.elements.has("#ai-generate"), false);
  assert.equal(app.elements.has("#ai-status"), false);
  app.call("bindAdminEvents()");
  assert.ok(app.elements.get("#review-text"));
  assert.ok(app.elements.get("#seo-title"));
  assert.ok(app.elements.get("#seo-description"));
  assert.ok(app.elements.get("#admin-library-search").listeners.has("input"));
});

test("full library reaches older drafts across multiple pages and can search them", async () => {
  const videos = records(127);
  const requests = [];
  const app = editor(async (url, options) => {
    requests.push(url);
    assert.equal(options.credentials, "same-origin");
    return pageResponse(videos, Number(new URL(url, "https://vid.best").searchParams.get("offset")));
  });
  await app.call("loadAdminVideos()");
  assert.equal(app.state.videos.length, 127);
  assert.deepEqual(requests.map((url) => new URL(url, "https://vid.best").searchParams.get("offset")), ["0", "48", "96"]);
  assert.equal(app.elements.get("#admin-video-list").children.length, 127);
  assert.equal(app.elements.get("#admin-library-status").textContent, "127 of 127 videos loaded.");
  app.elements.get("#review-text").value = "My manual review stays here.";
  app.elements.get("#admin-library-search").value = "OLDEST SAVED";
  app.call("renderAdminLibrary()");
  const item = app.elements.get("#admin-video-list").children[0];
  assert.equal(app.elements.get("#admin-video-list").children.length, 1);
  assert.equal(item.children[0].textContent, "Oldest saved review");
  assert.match(item.children[2].textContent, /^Draft/);
  assert.deepEqual(item.children[3].children.map((button) => button.textContent), ["Edit", "View", "Delete"]);
  assert.equal(app.elements.get("#review-text").value, "My manual review stays here.");
  assert.match(app.elements.get("#admin-library-status").textContent, /1 matching video\./);
});

test("page failures preserve loaded edits and report an incomplete library", async () => {
  const videos = records(127);
  const app = editor(async (url) => new URL(url, "https://vid.best").searchParams.get("offset") === "0"
    ? pageResponse(videos)
    : Response.json({ error: "Temporarily unavailable" }, { status: 503 }));
  await app.call("loadAdminVideos()");
  assert.equal(app.state.videos.length, 48);
  assert.equal(app.elements.get("#admin-video-list").children.length, 48);
  assert.match(app.elements.get("#admin-library-status").textContent, /48 of 127 videos loaded\. Temporarily unavailable/);
  assert.equal(app.elements.get("#admin-library-status").className, "form-status error");
  assert.equal(app.elements.get("#refresh-videos").disabled, false);
});

test("repeated or empty pages stop with an error instead of looping or claiming completion", async () => {
  for (const second of [[], records(100).slice(0, 48)]) {
    const videos = records(100);
    let calls = 0;
    const app = editor(async () => {
      calls += 1;
      return calls === 1 ? pageResponse(videos) : Response.json({ videos: second, pagination: { total: 100 } });
    });
    await app.call("loadAdminVideos()");
    assert.equal(calls, 2);
    assert.match(app.elements.get("#admin-library-status").className, /error/);
    assert.ok(app.state.videos.length < 100);
  }
});

test("empty library and invalid API responses are distinguishable", async () => {
  const empty = editor(async () => pageResponse([]));
  await empty.call("loadAdminVideos()");
  assert.equal(empty.elements.get("#admin-video-list").children[0].textContent, "No records yet.");
  assert.equal(empty.state.libraryError, "");
  const invalid = editor(async () => Response.json({ videos: [] }));
  await invalid.call("loadAdminVideos()");
  assert.match(invalid.state.libraryError, /response is incomplete/);
});

test("editing the oldest saved record restores all manual SEO fields and verified source metadata", async () => {
  const app = editor(async () => Response.json({ analysis: null }));
  app.state.categories = { Technology: ["Web Development"] };
  const video = {
    ...records(1)[0],
    source_url: "https://example.com/oldest.mp4",
    media_type: "raw",
    review_text: "The owner's original review.",
    description: "Original listing description.",
    seo_title: "Original SEO title",
    seo_description: "Original SEO description",
    seo_tags: ["manual", "review"],
    source_published_at: "2025-06-20",
    source_duration: "PT2M",
  };
  await app.call(`editVideo(${JSON.stringify(video)})`);
  assert.equal(app.elements.get("#editing-id").value, 1);
  assert.equal(app.elements.get("#review-text").value, video.review_text);
  assert.equal(app.elements.get("#description").value, video.description);
  assert.equal(app.elements.get("#seo-title").value, video.seo_title);
  assert.equal(app.elements.get("#seo-description").value, video.seo_description);
  assert.equal(app.elements.get("#seo-tags").value, "manual, review");
  assert.equal(app.elements.get("#source-published-at").value, "2025-06-20");
  assert.equal(app.elements.get("#source-duration-seconds").value, "120");
});

test("a refresh supersedes an older in-flight library response", async () => {
  let finishOldRequest;
  let calls = 0;
  const app = editor(async () => ++calls === 1 ? new Promise((resolve) => { finishOldRequest = resolve; }) : pageResponse(records(2)));
  const old = app.call("loadAdminVideos()");
  await app.call("loadAdminVideos()");
  finishOldRequest(pageResponse(records(127)));
  await old;
  assert.equal(app.state.videos.length, 2);
  assert.equal(app.elements.get("#admin-library-status").textContent, "2 of 2 videos loaded.");
});

test("locking the console prevents late responses from restoring private records", async () => {
  let finishRequest;
  const app = editor(async (url) => url.startsWith("/api/admin/videos")
    ? new Promise((resolve) => { finishRequest = resolve; }) : Response.json({ success: true }));
  const loading = app.call("loadAdminVideos()");
  await app.call("lockAdmin()");
  finishRequest(pageResponse(records(127)));
  await loading;
  assert.equal(app.state.videos.length, 0);
  assert.equal(app.elements.get("#admin-video-list").children.length, 0);
  assert.equal(app.elements.get("#admin-library-status").textContent, "");
});
