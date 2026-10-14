/* Keep this small bootstrap parseable before ES2017: the directory is also usable without JavaScript. */
(function () {
  var started = false;
  var problem = "";
  var heading = "Browser support required";
  function showProblem() {
    if (!problem) return;
    var panel = document.getElementById("empty-state");
    if (!panel) return;
    panel.hidden = false;
    document.getElementById("empty-title").textContent = heading;
    document.getElementById("empty-message").textContent = problem;
    document.getElementById("result-summary").textContent = "Use the video directory below to browse published reviews.";
    document.getElementById("retry-library").hidden = true;
  }
  document.addEventListener("vidbest:library-started", function () { started = true; });
  window.addEventListener("error", function (event) {
    var script = event.target;
    if (script && script.tagName === "SCRIPT" && /\/app\.js(?:\?|$)/.test(script.src)) {
      heading = "Library script unavailable";
      problem = "The interactive library could not load. Reload the page or use the video directory below.";
    } else if (!started && /\/app\.js(?:\?|$)/.test(event.filename || "")) {
      problem = "This browser could not start the interactive library. Use the video directory below or update your browser.";
    }
    if (document.readyState !== "loading") showProblem();
  }, true);
  document.addEventListener("DOMContentLoaded", function () {
    var template = document.getElementById("video-card-template");
    if (!window.fetch || !window.Promise || !window.URLSearchParams || !template || !template.content) {
      problem = "This browser does not support the interactive library. Use the video directory below or update your browser.";
    }
    showProblem();
  });
}());
