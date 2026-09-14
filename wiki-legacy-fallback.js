/* Wiki collision guard + canonical item identity.
 * Canonical identity: normalized item name + fashion slot/type + rarity.
 * Set/event stays metadata only. This prevents same-name items from being merged incorrectly.
 */
(() => {
  const API = "https://lifemakeover.wiki.gg/api.php";
  const BASE = "https://lifemakeover.wiki.gg/wiki/";
  const IDENTITY_MIGRATION = "rynWardrobeLab.identity.name-type-rarity.v1";
  let timer = null;
  let resolving = false;

  function normalizeToken(value) {
    return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function identityKey(valueOrName, type, rarity) {
    const item = typeof valueOrName === "object" && valueOrName !== null
      ? valueOrName
      : { name: valueOrName, type, rarity };
    return `${normalizeToken(item.name)}|${normalizeToken(item.type)}|${Number(item.rarity || 0)}`;
  }

  window.itemIdentityKey = identityKey;

  // Keep normalizeItem as the single normalization entry point, but preserve extras
  // added by catalog.js and attach the canonical identity for exports/debugging.
  const rawNormalizeItem = normalizeItem;
  normalizeItem = function(item) {
    const out = rawNormalizeItem(item);
    if (item?.wiki) out.wiki = item.wiki;
    if (item?.dye) out.dye = item.dye;
    out.identityKey = identityKey(out);
    return out;
  };

  function mergeDuplicate(base, incoming) {
    const ownedWins = base.status === "owned" || incoming.status === "owned";
    const scores = {};
    STYLES.forEach(style => scores[style] = Math.max(Number(base.scores?.[style] || 0), Number(incoming.scores?.[style] || 0)));
    const richerWiki = Object.keys(incoming.wiki?.stats || {}).length > Object.keys(base.wiki?.stats || {}).length ? incoming.wiki : base.wiki;
    const strongerDye = Number(incoming.dye?.charm || 0) > Number(base.dye?.charm || 0) ? incoming.dye : base.dye;
    return normalizeItem({
      ...base,
      status: ownedWins ? "owned" : "target",
      set: base.set || incoming.set || "",
      source: base.source || incoming.source || "",
      image: base.image || incoming.image || "",
      note: [base.note, incoming.note].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join(" · "),
      scores,
      wiki: richerWiki || undefined,
      dye: strongerDye || base.dye || incoming.dye || undefined
    });
  }

  function dedupeByIdentity(list) {
    const map = new Map();
    for (const raw of list || []) {
      const item = normalizeItem(raw);
      const key = identityKey(item);
      if (!map.has(key)) map.set(key, item);
      else map.set(key, mergeDuplicate(map.get(key), item));
    }
    return [...map.values()];
  }

  window.dedupeWardrobeByIdentity = dedupeByIdentity;

  // One-time migration of existing browser data. Same name is NOT enough to merge;
  // only the exact name+slot+rarity composite is considered the same item.
  try {
    const before = items.length;
    items = dedupeByIdentity(items);
    const changed = before !== items.length || !localStorage.getItem(IDENTITY_MIGRATION);
    if (changed) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      localStorage.setItem(IDENTITY_MIGRATION, "1");
      renderAll();
    }
  } catch (err) {
    console.warn("Identity migration skipped", err);
  }

  // JSON import: retain the existing replace-all behavior, but canonicalize and
  // deduplicate using name+slot+rarity instead of name or set.
  importJson = async function(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(incoming)) throw new Error("File không có mảng items");
      items = dedupeByIdentity(incoming);
      if (parsed?.scoreMode) activeScoreMode = parsed.scoreMode === "all" ? "all" : "eq";
      localStorage.setItem(MODE_KEY, activeScoreMode);
      saveItems();
      toast(`Đã nhập ${items.length} món · key: tên + slot + rarity`);
    } catch (err) {
      alert(`Không thể nhập JSON: ${err.message}`);
    }
  };

  // CSV upsert uses the same canonical key. Set/event may change without creating
  // a duplicate record, while a same-name item with another slot or rarity stays separate.
  importCsv = async function(file) {
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error("CSV không có dữ liệu");
      const headers = rows[0].map(h => h.trim());
      const idx = name => headers.indexOf(name);
      if (idx("name") < 0 || idx("type") < 0 || idx("rarity") < 0) throw new Error("Thiếu cột name/type/rarity");
      let added = 0, updated = 0;
      rows.slice(1).forEach(cols => {
        const name = (cols[idx("name")] || "").trim();
        if (!name) return;
        const scores = {};
        STYLES.forEach(style => {
          const p = idx(`score_${style}`);
          scores[style] = p >= 0 ? Number(cols[p] || 0) : 0;
        });
        const raw = {
          name,
          set: idx("set") >= 0 ? cols[idx("set")] : "",
          type: cols[idx("type")],
          rarity: Number(cols[idx("rarity")] || 3),
          status: idx("status") >= 0 ? cols[idx("status")] : "owned",
          source: idx("source") >= 0 ? cols[idx("source")] : "",
          image: idx("image") >= 0 ? cols[idx("image")] : "",
          note: idx("note") >= 0 ? cols[idx("note")] : "",
          scores
        };
        const key = identityKey(raw);
        const existing = items.findIndex(item => identityKey(item) === key);
        if (existing >= 0) {
          items[existing] = normalizeItem({ ...raw, id: items[existing].id, wiki: items[existing].wiki, dye: items[existing].dye });
          updated++;
        } else {
          items.push(normalizeItem({ ...raw, id: uid() }));
          added++;
        }
      });
      saveItems();
      toast(`CSV: +${added} mới, ${updated} cập nhật · tên + slot + rarity`);
    } catch (err) {
      alert(`Không thể nhập CSV: ${err.message}`);
    }
  };

  // Run before catalog.js' bubble submit handler. New entries with the same canonical
  // identity update the existing item. Editing into another item's identity is blocked.
  function enforceFormIdentity(event) {
    const form = event.target;
    if (form?.id !== "itemForm") return;
    const currentId = document.getElementById("itemId")?.value || "";
    const draft = {
      name: document.getElementById("itemName")?.value || "",
      type: document.getElementById("itemType")?.value || "",
      rarity: Number(document.getElementById("itemRarity")?.value || 0)
    };
    const key = identityKey(draft);
    const duplicate = items.find(item => item.id !== currentId && identityKey(item) === key);
    if (duplicate && currentId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      alert(`Đã có “${duplicate.name}” ${duplicate.type} ${duplicate.rarity}★ trong kho. Tên + slot + rarity được xem là cùng một món.`);
      return;
    }
    if (duplicate && !currentId) document.getElementById("itemId").value = duplicate.id;

    const finalId = document.getElementById("itemId")?.value || currentId;
    setTimeout(() => {
      const saved = items.find(item => item.id === finalId) || items.find(item => identityKey(item) === key);
      if (!saved) return;
      saved.identityKey = identityKey(saved);
      // A Wiki record is attached only when it describes the same composite identity.
      if (saved.wiki) {
        const wikiKey = identityKey({ name: saved.wiki.title || saved.name, type: saved.wiki.type, rarity: saved.wiki.rarity });
        if (wikiKey !== saved.identityKey) delete saved.wiki;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }, 0);
  }
  document.addEventListener("submit", enforceFormIdentity, true);

  // Farm recommendation buttons also resolve by name+slot+rarity. The old farm scan
  // used name only, which could open a different same-name item.
  let farmCatalogPromise = null;
  function farmCatalog() {
    if (!farmCatalogPromise) farmCatalogPromise = fetch("data/farmable-catalog.json", { cache: "no-store" }).then(r => {
      if (!r.ok) throw new Error(`catalog ${r.status}`);
      return r.json();
    });
    return farmCatalogPromise;
  }

  function openSavedItem(item) {
    if (!item) return;
    if (typeof openItemDetail === "function") {
      try { openItemDetail(item.id); return; } catch (_) {}
    }
    if (typeof openItemModal === "function") openItemModal(item.id);
  }

  document.addEventListener("click", async event => {
    const button = event.target.closest?.("[data-farm-add]");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const name = button.dataset.farmAdd || "";
    const line = button.closest(".farm-card")?.querySelector(".farm-main p")?.textContent || "";
    const match = line.match(/^(.+?)\s*·\s*([3-6])★/);
    const type = match?.[1]?.trim() || "";
    const rarity = Number(match?.[2] || 0);
    const key = identityKey({ name, type, rarity });
    const existing = items.find(item => identityKey(item) === key);
    if (existing) {
      openSavedItem(existing);
      return;
    }
    try {
      const data = await farmCatalog();
      const entry = (data.items || []).find(row => identityKey({ name: row.name, type: row.type, rarity: row.rarity }) === key);
      if (!entry) throw new Error("Không tìm thấy đúng phiên bản trong catalog");
      const base = normalizeItem({
        id: uid(), name: entry.name, set: entry.set || "", type: entry.type,
        rarity: Number(entry.rarity || 3), status: "target", source: entry.source || entry.route || "",
        image: entry.image || "", note: `Auto recommendation · ${entry.route || entry.source || "Wiki"}`,
        scores: Object.fromEntries(STYLES.map(style => [style, Number(entry.scores?.[style] || 0)]))
      });
      base.wiki = {
        title: entry.name, page: entry.name, url: entry.url, type: entry.type, rarity: Number(entry.rarity || 3),
        set: entry.set || "", source: entry.source || "", tags: entry.tags || [], thumbnail: entry.image || "",
        stats: entry.styles || {}, scores: entry.scores || {}, fetchedAt: new Date().toISOString()
      };
      base.dye = { enabled: false, charm: 0, xPalette: false };
      base.identityKey = identityKey(base);
      items.push(base);
      saveItems();
      toast(`Đã thêm ${entry.name} · ${entry.type} · ${entry.rarity}★ vào Mục tiêu`);
    } catch (err) {
      alert(`Không thể thêm đúng phiên bản: ${err.message}`);
    }
  }, true);

  function escRe(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function param(text, name) {
    const re = new RegExp(`\\|\\s*${escRe(name)}\\s*=\\s*([\\s\\S]*?)(?=\\s*\\|\\s*[A-Za-z0-9_]+\\s*=|\\n\\s*\\}\\}|$)`, "i");
    return (String(text || "").match(re)?.[1] || "").trim();
  }

  function templateBlock(text, templateName) {
    const src = String(text || "");
    const start = src.search(new RegExp(`\\{\\{\\s*${escRe(templateName)}`, "i"));
    if (start < 0) return "";
    const tail = src.slice(start);
    let depth = 0;
    for (let i = 0; i < tail.length - 1; i++) {
      const pair = tail.slice(i, i + 2);
      if (pair === "{{") { depth++; i++; continue; }
      if (pair === "}}") {
        depth--; i++;
        if (depth === 0) return tail.slice(0, i + 1);
      }
    }
    return tail;
  }

  function cleanWiki(value = "") {
    return String(value)
      .replace(/<!--([\s\S]*?)-->/g, "")
      .replace(/<br\s*\/?>/gi, " · ")
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/\{\{(?:Style|Tag|Rarity)\|([^}|]+)[^}]*\}\}/gi, "$1")
      .replace(/\{\{[^}]+\}\}/g, "")
      .replace(/'''?/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function api(params) {
    const qs = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
    const res = await fetch(`${API}?${qs}`);
    if (!res.ok) throw new Error(`Wiki API ${res.status}`);
    return res.json();
  }

  async function legacyMeta(title) {
    const data = await api({
      action: "query",
      prop: "revisions|pageimages",
      rvprop: "content",
      rvslots: "main",
      titles: title,
      piprop: "thumbnail",
      pithumbsize: "420",
      redirects: "1"
    });
    const page = data?.query?.pages?.[0];
    if (!page || page.missing) return null;
    const raw = page.revisions?.[0]?.slots?.main?.content || "";
    if (!/\{\{\s*Fashion Infobox/i.test(raw)) return null;
    const info = templateBlock(raw, "Fashion Infobox") || raw;
    return {
      title: page.title,
      url: `${BASE}${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
      type: cleanWiki(param(info, "type")),
      rarity: Number(cleanWiki(param(info, "rarity"))) || null,
      set: cleanWiki(param(info, "set")),
      source: cleanWiki(param(info, "obtain")),
      thumbnail: page.thumbnail?.source || ""
    };
  }

  function showCollision(meta) {
    const status = document.getElementById("wikiStatus");
    const card = document.getElementById("wikiCard");
    if (!status || !meta) return;
    const detail = [meta.type, meta.rarity ? `${meta.rarity}★` : "", meta.set, meta.source].filter(Boolean).join(" · ");
    status.className = "wiki-status bad";
    status.innerHTML = `Wiki có một record cùng tên nhưng không có stat dùng được. <a href="${meta.url}" target="_blank" rel="noopener">Xem record ↗</a>`;
    if (card) {
      card.innerHTML = `<div class="wiki-card-top"><div><strong>${meta.title}</strong><div class="wiki-status bad">Record Wiki hiện tại: ${detail || "không đủ metadata"}</div></div><a href="${meta.url}" target="_blank" rel="noopener">Mở Wiki ↗</a></div><div class="wiki-score-help"><b>Có thể trùng tên item.</b> App sẽ không tự đổi slot, rarity hay tạo điểm ước tính từ record này. Khóa item trong kho là <b>tên + slot + rarity</b>; set/event chỉ là metadata.</div>`;
      card.classList.add("show");
    }
  }

  async function inspectBadMatch() {
    if (resolving) return;
    const name = document.getElementById("itemName")?.value.trim();
    const status = document.getElementById("wikiStatus");
    if (!name || !status) return;
    const bad = status.classList.contains("bad") || /chưa đọc được Fashion Stats|không đọc được stat/i.test(status.textContent || "");
    if (!bad) return;
    resolving = true;
    try {
      const meta = await legacyMeta(name);
      if (meta && document.getElementById("itemName")?.value.trim().toLowerCase() === name.toLowerCase()) showCollision(meta);
    } catch (_) {
      // A failed secondary lookup must never alter user data.
    } finally {
      resolving = false;
    }
  }

  function scheduleInspect() {
    clearTimeout(timer);
    timer = setTimeout(inspectBadMatch, 850);
  }

  function install() {
    const input = document.getElementById("itemName");
    const sync = document.getElementById("wikiSyncBtn");
    const status = document.getElementById("wikiStatus");
    if (!input || !status) return;
    input.addEventListener("input", scheduleInspect);
    sync?.addEventListener("click", () => setTimeout(inspectBadMatch, 700));
    const observer = new MutationObserver(() => {
      if (status.classList.contains("bad")) setTimeout(inspectBadMatch, 100);
    });
    observer.observe(status, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
