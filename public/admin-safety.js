const publishedToggle = document.querySelector("#published");
const editingId = document.querySelector("#editing-id");

// admin.js predates the draft-first publishing rule and programmatically sets
// Published=true in a few new-record flows. Intercept JavaScript assignments on
// this one checkbox: existing records may restore their saved state, while new
// records remain drafts. Normal user interaction with the checkbox still works.
if (publishedToggle) {
  const checkedDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
  if (checkedDescriptor?.get && checkedDescriptor?.set) {
    Object.defineProperty(publishedToggle, "checked", {
      configurable: true,
      get() {
        return checkedDescriptor.get.call(this);
      },
      set(value) {
        const isEditing = Boolean(editingId?.value);
        checkedDescriptor.set.call(this, isEditing ? Boolean(value) : false);
      },
    });
  }
}

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
