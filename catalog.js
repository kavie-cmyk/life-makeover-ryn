/* Ryn Wardrobe Lab · Life Makeover Wiki integration
 * Primary source: https://lifemakeover.wiki.gg/
 * Wiki content is CC BY-SA 4.0. The app stores only data the user explicitly looks up.
 */
(() => {
  const WIKI_API = "https://lifemakeover.wiki.gg/api.php";
  const WIKI_BASE = "https://lifemakeover.wiki.gg/wiki/";
  const CACHE_KEY = "rynWardrobeLab.wikiCache.v1";
  const RATING_BASE = { SSS: 60, SS: 50, S: 40, A: 30, B: 20, C: 10 };
  let selectedWiki = null;
  let searchTimer = null;

  function loadRawExtras() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      const byId = new Map(raw.map(x => [x.id, x]));
      items.forEach(item => {
        const saved = byId.get(item.id);
        if (saved?.wiki) item.wiki = saved.wiki;
        if (saved?.dye) item.dye = saved.dye;
      });
    } catch (_) {}
  }

  function dyeMultiplier(item) {
    if (!item?.dye?.hasCharm) return 1;
    const charm = Math.max(0, Math.min(16, Number(item.dye.charm || 0)));
    if (charm >= 16) return 1.10;
    if (charm >= 8) return 1.05;
    return 1;
  }

  // Existing engine keeps score math in getScore(). Wrap it so Charm automatically
  // applies to every style score while leaving manual/non-dye items untouched.
  const baseGetScore = getScore;
  getScore = function(item, style) {
    const base = baseGetScore(item, style);
    return Math.round(base * dyeMultiplier(item));
  };

  function wikiIndex(rating, scale) {
    // The Wiki does not publish raw in-game points. This preserves the Wiki ordering:
    // rating is the major tier, scale is the within-tier value. Integer output keeps
    // the existing optimizer stable and makes totals comparable inside this app.
    const r = RATING_BASE[String(rating || "").trim().toUpperCase()] || 0;
    const s = Math.max(0, Number(scale || 0));
    return Math.round((r + s) * 10);
  }

  function cleanWikiText(value = "") {
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

  function param(text, name) {
    const re = new RegExp(`(?:^|\\n)\\s*\\|\\s*${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*=\\s*([^\\n]*)`, "i");
    return (text.match(re)?.[1] || "").trim();
  }

  function parseWikiFashion(title, text, thumbnail = "") {
    if (!/\{\{\s*Fashion Infobox/i.test(text)) throw new Error("Trang này không phải Fashion item.");
    const type = cleanWikiText(param(text, "type"));
    const rarity = Number(cleanWikiText(param(text, "rarity"))) || 3;
    const set = cleanWikiText(param(text, "set"));
    const source = cleanWikiText(param(text, "obtain"));
    const tagRaw = param(text, "tag");
    const tags = [...tagRaw.matchAll(/\{\{\s*Tag\s*\|\s*([^}|]+)[^}]*\}\}/gi)].map(m => m[1].trim());

    const statsBlock = text.match(/\{\{\s*Fashion Stats([\s\S]*?)\n?\}\}/i)?.[1] || "";
    const stats = {};
    const scores = Object.fromEntries(STYLES.map(s => [s, 0]));
    for (let i = 1; i <= 5; i++) {
      const style = cleanWikiText(param(statsBlock, `style${i}`));
      if (!STYLES.includes(style)) continue;
      const scale = Number(cleanWikiText(param(statsBlock, `scale${i}`))) || 0;
      const rating = cleanWikiText(param(statsBlock, `rating${i}`)).toUpperCase();
      const index = wikiIndex(rating, scale);
      stats[style] = { rating, scale, index };
      scores[style] = index;
    }

    return {
      title,
      page: title,
      url: `${WIKI_BASE}${encodeURIComponent(title.replace(/ /g, "_"))}`,
      type: TYPES.includes(type) ? type : type,
      rarity,
      set,
      source,
      tags,
      thumbnail,
      stats,
      scores,
      fetchedAt: new Date().toISOString()
    };
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); }
    catch (_) { return {}; }
  }

  function writeCache(title, data) {
    const cache = readCache();
    cache[title] = data;
    const keys = Object.keys(cache).sort((a,b) => new Date(cache[b]?.fetchedAt || 0) - new Date(cache[a]?.fetchedAt || 0));
    keys.slice(120).forEach(k => delete cache[k]);
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  }

  async function api(params) {
    const qs = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
    const res = await fetch(`${WIKI_API}?${qs}`, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`Wiki API ${res.status}`);
    return res.json();
  }

  async function searchWiki(query) {
    const q = query.trim();
    if (q.length < 2) return [];
    const data = await api({ action: "query", list: "prefixsearch", pssearch: q, psnamespace: "0", pslimit: "8" });
    return data?.query?.prefixsearch || [];
  }

  async function fetchFashion(title, force = false) {
    const cached = readCache()[title];
    if (cached && !force) return cached;
    const data = await api({
      action: "query",
      prop: "revisions|pageimages",
      rvprop: "content",
      rvslots: "main",
      titles: title,
      piprop: "thumbnail",
      pithumbsize: "360"
    });
    const page = data?.query?.pages?.[0];
    if (!page || page.missing) throw new Error("Không tìm thấy item trên Wiki.");
    const text = page.revisions?.[0]?.slots?.main?.content || "";
    const parsed = parseWikiFashion(page.title, text, page.thumbnail?.source || "");
    writeCache(title, parsed);
    return parsed;
  }

  function installStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .wiki-lookup{margin:14px 0 2px;padding:14px;border:1px solid #ddd3ee;border-radius:16px;background:linear-gradient(135deg,#fbf9ff,#fff)}
      .wiki-lookup-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:9px}.wiki-lookup-head strong{font-size:12px}.wiki-lookup-head span{font-size:9px;color:var(--muted)}
      .wiki-search-wrap{position:relative}.wiki-results{display:none;position:absolute;z-index:20;left:0;right:0;top:calc(100% + 5px);background:#fff;border:1px solid var(--line);border-radius:13px;box-shadow:0 16px 36px rgba(40,25,60,.16);max-height:260px;overflow:auto}.wiki-results.show{display:block}
      .wiki-result{width:100%;border:0;border-bottom:1px solid #f0ecf3;background:#fff;text-align:left;padding:11px 12px;font:inherit;cursor:pointer}.wiki-result:last-child{border-bottom:0}.wiki-result:hover{background:#faf8ff}.wiki-result strong{display:block;font-size:12px}.wiki-result span{display:block;font-size:9px;color:var(--muted);margin-top:2px}
      .wiki-selected{display:none;margin-top:10px;padding:11px;border-radius:12px;background:#f3efff}.wiki-selected.show{display:block}.wiki-selected-top{display:flex;justify-content:space-between;gap:10px}.wiki-selected strong{font-size:12px}.wiki-selected small{font-size:9px;color:var(--muted)}.wiki-stats{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.wiki-stat{padding:5px 7px;border-radius:999px;background:#fff;border:1px solid #e2daf0;font-size:9px;font-weight:700}.wiki-error{font-size:10px;color:var(--danger);margin-top:7px}.wiki-note{font-size:9px!important;color:var(--muted)!important;line-height:1.45;margin:8px 0 0!important}
      .dye-box{margin-top:18px;padding:14px;border:1px solid var(--line);border-radius:16px;background:#fffafc}.dye-head{display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:10px}.dye-head h3{font-size:14px;margin:3px 0 0}.dye-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}.dye-grid label{display:grid;gap:6px;font-size:10px;font-weight:750;color:#6e6677}.dye-grid input,.dye-grid select{height:40px;border:1px solid var(--line);border-radius:11px;background:#fff;padding:0 10px;font:inherit;font-size:13px}.check-row{display:flex!important;align-items:center;gap:8px!important}.check-row input{width:18px;height:18px}.dye-summary{margin-top:9px;font-size:10px;color:var(--muted)}
      @media(max-width:760px){.wiki-lookup{margin-top:12px}.dye-grid{grid-template-columns:1fr}.wiki-result{min-height:46px}.wiki-lookup input,.dye-grid input,.dye-grid select{font-size:16px}.wiki-results{position:fixed;left:12px;right:12px;top:auto;bottom:calc(82px + env(safe-area-inset-bottom));max-height:45vh}}
    `;
    document.head.appendChild(style);
  }

  function installUi() {
    const nameLabel = $("itemName")?.closest("label");
    if (!nameLabel || $("wikiSearch")) return;
    nameLabel.insertAdjacentHTML("afterend", `
      <div class="wiki-lookup" style="grid-column:1/-1">
        <div class="wiki-lookup-head"><strong>Tìm trong Life Makeover Wiki</strong><span>7.5k+ fashions · wiki.gg</span></div>
        <div class="wiki-search-wrap">
          <input id="wikiSearch" autocomplete="off" placeholder="Gõ tên món, ví dụ Dark Sakura..." />
          <div class="wiki-results" id="wikiResults"></div>
        </div>
        <div class="wiki-selected" id="wikiSelected"></div>
        <div class="wiki-error" id="wikiError"></div>
        <p class="wiki-note">Stat lấy từ Wiki dưới dạng rating + scale. App tạo “Wiki index” để so sánh/xếp hạng; đây không phải raw point hiển thị trong game.</p>
      </div>`);

    $("scoreInputs").insertAdjacentHTML("afterend", `
      <div class="dye-box">
        <div class="dye-head"><div><p class="eyebrow">DYE / CHARM</p><h3>Bonus của riêng món bạn đang có</h3></div><span class="status owned" id="dyeBonusBadge">+0%</span></div>
        <div class="dye-grid">
          <label class="check-row"><input id="dyeHasCharm" type="checkbox"> Món này có Charm bonus</label>
          <label>Charm / palette progress<input id="dyeCharm" type="number" min="0" max="16" step="1" inputmode="numeric" value="0"></label>
          <label class="check-row"><input id="dyeXPalette" type="checkbox"> Đã mở X Palette</label>
        </div>
        <div class="dye-summary" id="dyeSummary">Charm 0–7: chưa cộng bonus · 8–15: +5% · 16: +10%. X Palette được lưu để theo dõi nhưng chưa tự cộng thêm vì chưa có hệ số Wiki đáng tin cậy.</div>
      </div>`);

    const scoreHead = document.querySelector(".score-editor-head h3");
    if (scoreHead) scoreHead.textContent = "Wiki index theo thuộc tính";
    const scoreHint = document.querySelector(".score-editor-head .hint");
    if (scoreHint) scoreHint.textContent = "Chọn item từ Wiki để tự điền.";

    $("wikiSearch").addEventListener("input", onSearchInput);
    $("wikiSearch").addEventListener("focus", () => { if ($("wikiResults").children.length) $("wikiResults").classList.add("show"); });
    document.addEventListener("click", e => { if (!e.target.closest(".wiki-search-wrap")) $("wikiResults")?.classList.remove("show"); });
    $("dyeCharm").addEventListener("input", updateDyeUi);
    $("dyeHasCharm").addEventListener("change", updateDyeUi);
  }

  async function onSearchInput(e) {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    $("wikiError").textContent = "";
    if (q.length < 2) { $("wikiResults").classList.remove("show"); return; }
    searchTimer = setTimeout(async () => {
      try {
        $("wikiResults").innerHTML = `<button class="wiki-result" type="button"><span>Đang tìm…</span></button>`;
        $("wikiResults").classList.add("show");
        const results = await searchWiki(q);
        $("wikiResults").innerHTML = results.length ? results.map(r => `<button type="button" class="wiki-result" data-wiki-title="${esc(r.title)}"><strong>${esc(r.title)}</strong><span>Kiểm tra fashion data →</span></button>`).join("") : `<button class="wiki-result" type="button"><span>Không có kết quả.</span></button>`;
        qsa("[data-wiki-title]").forEach(btn => btn.addEventListener("click", () => chooseWiki(btn.dataset.wikiTitle)));
      } catch (err) {
        $("wikiResults").classList.remove("show");
        $("wikiError").textContent = `Không kết nối được Wiki: ${err.message}. Bạn vẫn có thể nhập tay.`;
      }
    }, 260);
  }

  async function chooseWiki(title) {
    $("wikiResults").classList.remove("show");
    $("wikiError").textContent = "Đang lấy stat…";
    try {
      const data = await fetchFashion(title);
      selectedWiki = data;
      $("wikiSearch").value = data.title;
      $("itemName").value = data.title;
      if (TYPES.includes(data.type)) $("itemType").value = data.type;
      $("itemRarity").value = String([3,4,5,6].includes(data.rarity) ? data.rarity : 3);
      $("itemSet").value = data.set || "";
      $("itemSource").value = data.source || "Life Makeover Wiki";
      if (data.thumbnail) $("itemImage").value = data.thumbnail;
      STYLES.forEach(style => { $(`score-${style}`).value = data.scores[style] || 0; });
      renderWikiSelected(data);
      // Set pieces normally have Charm; user can still turn it off if this item doesn't.
      $("dyeHasCharm").checked = Boolean(data.set);
      updateDyeUi();
      $("wikiError").textContent = "";
    } catch (err) {
      selectedWiki = null;
      $("wikiSelected").classList.remove("show");
      $("wikiError").textContent = err.message || "Không đọc được fashion data.";
    }
  }

  function renderWikiSelected(data) {
    const stats = Object.entries(data.stats).map(([style,s]) => `<span class="wiki-stat">${esc(style)} ${esc(s.rating)} · ${s.scale} → ${s.index}</span>`).join("");
    $("wikiSelected").innerHTML = `<div class="wiki-selected-top"><div><strong>${esc(data.title)}</strong><br><small>${esc(data.type || "?")} · ${data.rarity}★${data.set ? ` · ${esc(data.set)}` : " · Fashion piece"}</small></div><a href="${data.url}" target="_blank" rel="noopener" class="text-btn">Wiki ↗</a></div><div class="wiki-stats">${stats || "Chưa có stat trên Wiki"}</div>`;
    $("wikiSelected").classList.add("show");
  }

  function updateDyeUi() {
    const has = $("dyeHasCharm")?.checked;
    const charm = Math.max(0, Math.min(16, Number($("dyeCharm")?.value || 0)));
    const bonus = has ? (charm >= 16 ? 10 : charm >= 8 ? 5 : 0) : 0;
    if ($("dyeBonusBadge")) $("dyeBonusBadge").textContent = `+${bonus}%`;
  }

  // Wrap modal opening so Wiki + Dye fields track whichever item is being edited.
  const baseOpenItemModal = openItemModal;
  openItemModal = function(id = null) {
    baseOpenItemModal(id);
    const item = id ? items.find(i => i.id === id) : null;
    selectedWiki = item?.wiki || null;
    $("wikiSearch").value = item?.wiki?.title || item?.name || "";
    if (selectedWiki) renderWikiSelected(selectedWiki); else $("wikiSelected").classList.remove("show");
    $("wikiError").textContent = "";
    $("dyeHasCharm").checked = Boolean(item?.dye?.hasCharm);
    $("dyeCharm").value = Math.max(0, Math.min(16, Number(item?.dye?.charm || 0)));
    $("dyeXPalette").checked = Boolean(item?.dye?.xPalette);
    updateDyeUi();
  };

  function persistExtras(id, snapshot) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.wiki = snapshot.wiki || null;
    item.dye = snapshot.dye;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    renderAll();
  }

  // Ensure new items receive a known id before the original submit handler runs.
  // Then augment the item after the original handler has saved its core fields.
  $("itemForm")?.addEventListener("submit", () => {
    if (!$("itemId").value) $("itemId").value = uid();
    const id = $("itemId").value;
    const snapshot = {
      wiki: selectedWiki,
      dye: {
        hasCharm: Boolean($("dyeHasCharm")?.checked),
        charm: Math.max(0, Math.min(16, Number($("dyeCharm")?.value || 0))),
        xPalette: Boolean($("dyeXPalette")?.checked)
      }
    };
    setTimeout(() => persistExtras(id, snapshot), 0);
  }, true);

  function addDyeBadges() {
    qsa(".inventory-card").forEach(card => {
      const edit = card.querySelector("[data-edit]");
      const item = items.find(i => i.id === edit?.dataset.edit);
      if (!item?.dye?.hasCharm || Number(item.dye.charm || 0) < 8 || card.querySelector(".dye-mini")) return;
      const bonus = Number(item.dye.charm) >= 16 ? 10 : 5;
      card.querySelector(".inventory-card-bottom")?.insertAdjacentHTML("afterbegin", `<span class="status owned dye-mini">Dye +${bonus}%</span>`);
    });
  }

  const baseRenderInventory = renderInventory;
  renderInventory = function() { baseRenderInventory(); addDyeBadges(); };

  installStyles();
  installUi();
  loadRawExtras();
  renderAll();
})();
