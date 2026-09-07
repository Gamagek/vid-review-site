(() => {
  const original = globalThis.renderModerationItem;
  if (typeof original !== "function") return;

  globalThis.renderModerationItem = function renderModerationItemWithImage(comment) {
    const item = original(comment);
    if (!comment?.image_url) return item;
    const image = document.createElement("img");
    image.src = comment.image_url;
    image.alt = "Picture attached to this pending comment";
    image.loading = "lazy";
    image.style.width = "100%";
    image.style.maxHeight = "260px";
    image.style.objectFit = "contain";
    image.style.borderRadius = "12px";
    image.style.margin = "8px 0";
    const actions = item.querySelector(".admin-item-actions");
    item.insertBefore(image, actions || null);
    return item;
  };
})();
