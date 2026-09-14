/* Prevent accidental duplicate wardrobe entries.
 * Canonical identity: normalized item name + slot/type + rarity.
 * Same-name variants are allowed, but surfaced as a warning.
 */
(() => {
  const normalizeName = value => String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

  const itemKey = (name, type, rarity) => `${normalizeName(name)}|${String(type || "").trim().toLowerCase()}|${Number(rarity || 0)}`;

  function currentDraft() {
    return {
      id: document.getElementById("itemId")?.value || "",
      name: document.getElementById("itemName")?.value || "",
      type: document.getElementById("itemType")?.value || "",
      rarity: Number(document.getElementById("itemRarity")?.value || 0)
    };
  }

  function otherItems() {
    const currentId = currentDraft().id;
    return (typeof items !== "undefined" ? items : []).filter(item => item.id !== currentId);
  }

  function findMatches() {
    const draft = currentDraft();
    const name = normalizeName(draft.name);
    if (!name || !draft.type || !draft.rarity) return { exact: null, sameName: [] };
    const key = itemKey(draft.name, draft.type, draft.rarity);
    const pool = otherItems();
    return {
      exact: pool.find(item => itemKey(item.name, item.type, item.rarity) === key) || null,
      sameName: pool.filter(item => normalizeName(item.name) === name && itemKey(item.name, item.type, item.rarity) !== key)
    };
  }

  function ensureUi() {
    let box = document.getElementById("duplicateGuard");
    if (box) return box;
    box = document.createElement("div");
    box.id = "duplicateGuard";
    box.className = "duplicate-guard";
    box.hidden = true;
    const wiki = document.getElementById("wikiTools");
    const nameLabel = document.getElementById("itemName")?.closest("label");
    if (wiki) wiki.insertAdjacentElement("afterend", box);
    else if (nameLabel) nameLabel.insertAdjacentElement("afterend", box);
    return box;
  }

  function submitButton() {
    return document.querySelector("#itemForm button[type='submit']");
  }

  function statusLabel(item) {
    return item?.status === "target" ? "Mục tiêu" : "Đang sở hữu";
  }

  function render() {
    const box = ensureUi();
    if (!box) return;
    const { exact, sameName } = findMatches();
    const submit = submitButton();

    if (exact) {
      box.hidden = false;
      box.className = "duplicate-guard exact";
      box.innerHTML = `
        <div class="duplicate-icon">!</div>
        <div class="duplicate-copy">
          <strong>Món này đã có trong Kho đồ</strong>
          <span>${escapeHtml(exact.name)} · ${escapeHtml(exact.type)} · ${exact.rarity}★ · ${statusLabel(exact)}${exact.set ? ` · ${escapeHtml(exact.set)}` : ""}</span>
          <small>Khóa nhận diện trùng: tên + slot + rarity. Không cần nhập lại; hãy mở món cũ để cập nhật Dye, điểm hoặc trạng thái.</small>
          <div class="duplicate-actions">
            <button type="button" data-dup-view="${escapeHtml(exact.id)}">Xem món</button>
            <button type="button" data-dup-edit="${escapeHtml(exact.id)}">Sửa món đã có</button>
          </div>
        </div>`;
      if (submit) {
        submit.disabled = true;
        submit.dataset.duplicateBlocked = "1";
        submit.title = "Món này đã có trong Kho đồ";
      }
      bindActions(box, exact);
      return;
    }

    if (submit?.dataset.duplicateBlocked === "1") {
      submit.disabled = false;
      delete submit.dataset.duplicateBlocked;
      submit.removeAttribute("title");
    }

    if (sameName.length) {
      box.hidden = false;
      box.className = "duplicate-guard variant";
      const variants = sameName.slice(0, 4).map(item => `<span>${escapeHtml(item.type)} · ${item.rarity}★${item.set ? ` · ${escapeHtml(item.set)}` : ""}</span>`).join("");
      box.innerHTML = `
        <div class="duplicate-icon">i</div>
        <div class="duplicate-copy">
          <strong>Tên này đã có phiên bản khác</strong>
          <div class="duplicate-variants">${variants}</div>
          <small>Bạn vẫn có thể lưu vì slot hoặc rarity khác. Kiểm tra lại để tránh chọn nhầm phiên bản.</small>
        </div>`;
      return;
    }

    box.hidden = true;
    box.innerHTML = "";
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  function bindActions(box, item) {
    box.querySelector("[data-dup-edit]")?.addEventListener("click", () => {
      if (typeof openItemModal === "function") openItemModal(item.id);
      setTimeout(render, 30);
    });
    box.querySelector("[data-dup-view]")?.addEventListener("click", () => {
      if (typeof closeItemModal === "function") closeItemModal();
      if (typeof goTo === "function") goTo("inventory");
      if (typeof renderInventory === "function") renderInventory();
      setTimeout(() => {
        const node = [...document.querySelectorAll("#view-inventory [data-view-item]")].find(el => el.dataset.viewItem === item.id);
        if (node) node.click();
        else if (typeof openItemModal === "function") openItemModal(item.id);
      }, 30);
    });
  }

  function installStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .duplicate-guard{grid-column:1/-1;display:grid;grid-template-columns:30px 1fr;gap:10px;padding:12px 13px;border-radius:14px;margin:-2px 0 4px;border:1px solid var(--line);background:#fff}.duplicate-guard[hidden]{display:none}.duplicate-guard.exact{background:#fff5f5;border-color:#efc6ca}.duplicate-guard.variant{background:#fffaf0;border-color:#ecd9a5}.duplicate-icon{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:12px}.exact .duplicate-icon{background:#f9dfe2;color:#a64450}.variant .duplicate-icon{background:#f5e8bd;color:#84661a}.duplicate-copy strong{display:block;font-size:11px}.duplicate-copy>span,.duplicate-variants span{display:block;font-size:9px;color:var(--muted);margin-top:3px;line-height:1.45}.duplicate-copy small{display:block;font-size:9px;color:var(--muted);line-height:1.45;margin-top:5px}.duplicate-actions{display:flex;gap:7px;margin-top:9px}.duplicate-actions button{border:1px solid #d9cdec;background:#fff;color:var(--accent);font:inherit;font-size:9px;font-weight:800;border-radius:9px;min-height:34px;padding:0 10px;cursor:pointer}.duplicate-variants{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}.duplicate-variants span{background:#fff;border:1px solid #eadfbd;border-radius:999px;padding:4px 7px;margin:0}.modal-actions .primary-btn:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
      @media(max-width:760px){.duplicate-guard{grid-template-columns:26px 1fr;padding:11px}.duplicate-icon{width:26px;height:26px}.duplicate-actions{display:grid;grid-template-columns:1fr 1fr}.duplicate-actions button{min-height:40px}}
    `;
    document.head.appendChild(style);
  }

  function install() {
    installStyles();
    ensureUi();
    ["itemName", "itemType", "itemRarity"].forEach(id => {
      const el = document.getElementById(id);
      el?.addEventListener(id === "itemName" ? "input" : "change", () => setTimeout(render, 0));
    });

    const modal = document.getElementById("itemModal");
    if (modal) new MutationObserver(() => { if (!modal.hidden) setTimeout(render, 30); }).observe(modal, { attributes:true, attributeFilter:["hidden"] });

    document.getElementById("itemForm")?.addEventListener("submit", event => {
      const { exact } = findMatches();
      if (!exact) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      render();
      if (typeof toast === "function") toast("Món này đã có trong Kho đồ");
    }, true);

    document.addEventListener("click", event => {
      if (event.target.closest("#quickAddBtn,[data-edit]")) setTimeout(render, 40);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
