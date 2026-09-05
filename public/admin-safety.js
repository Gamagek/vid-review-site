const publishedToggle = document.querySelector("#published");
const editingId = document.querySelector("#editing-id");

function defaultToDraft() {
  if (publishedToggle && !editingId?.value) publishedToggle.checked = false;
}

document.addEventListener("DOMContentLoaded", defaultToDraft);

document.addEventListener("click", (event) => {
  const selectedDiscovery = event.target.closest("#video-search-results button");
  const resetButton = event.target.closest("#reset-form");
  if (!selectedDiscovery && !resetButton) return;
  queueMicrotask(defaultToDraft);
});
