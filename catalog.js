/* Ryn Wardrobe Lab · Life Makeover Wiki integration
 * Source: https://lifemakeover.wiki.gg/ (CC BY-SA 4.0)
 * Wiki publishes rating + scale, not the game's raw final battle points.
 * We expose a transparent numeric "Wiki score" = rating tier base + scale
 * so items can be compared consistently inside this wardrobe tool.
 */
(() => {
  const WIKI_API = "https://lifemakeover.wiki.gg/api.php";
  const WIKI_BASE = "https://lifemakeover.wiki.gg/wiki/";
  const CACHE_KEY = "rynWardrobeLab.wikiCache.v2";
  const RATING_BASE = { C: 10, B: 20, A: 30, S: 40, SS: 50, SSS: 60 };
  let selectedWiki = null;
  let searchTimer = null;

  const rawGetScore = getScore;

  function wikiScore(rating, scale) {
    const base = RATING_BASE[String(rating || "").trim().toUpperCase()] || 0;
    const s = Math.max(0, Number(scale || 0));
    return base ? Number((base + s).toFixed(1)) : 0;
  }

  function dyeMultiplier(item) {
    if (!item?.dye?.enabled) return 1;
    const charm = Math.max(0, Math.min(16, Number(item.dye.charm || 0)));
    if (charm >= 16) return 1.10;
    if (charm >= 8) return 1.05;
    return 1;
  }

  getScore = function(item, style) {
    const base = rawGetScore(item, style);
    return Number((base * dyeMultiplier(item)).toFixed(1));
  };

  function loadRawExtras() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      const rows = Array.isArray(raw) ? raw : raw?.items || [];
      const byId = new Map(rows.map(x => [x.id, x]));
      items.forEach(item => {
        const saved = byId.get(item.id);
        if (saved?.wiki) item.wiki = saved.wiki;
        if (saved?.dye) item.dye = saved.dye;
      });
    } catch (_) {}
  }

  function escRe(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Wiki's Fashion Stats template commonly puts several params on one line:
  // |style1 = Elegant | scale1 = 3 | rating1 = SSS
  // This parser stops at the next "| key =" rather than the next newline.
  function param(text, name) {
    const re = new RegExp(`\\|\\s*${escRe(name)}\\s*=\\s*([\\s\\S]*?)(?=\\s*\\|\\s*[A-Za-z0-9_]+\\s*=|\\n\\s*\\}\\}|$)`, "i");
    return (String(text || "").match(re)?.[1] || "").trim();
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

  function templateBlock(text, templateName) {
    const src = String(text || "");
    const start = src.search(new RegExp(`\\{\\{\\s*${escRe(templateName)}`, "i"));
    if (start < 0) return "";
    const end = src.indexOf("\n}}", start);
    if (end >= 0) return src.slice(start, end + 3);
    return src.slice(start);
  }

  function parseWikiFashion(title, text, thumbnail = "") {
    if (!/\{\{\s*Fashion Infobox/i.test(text)) throw new Error("Trang này không phải Fashion item.");
    const infobox = templateBlock(text, "Fashion Infobox") || text;
    const statsBlock = templateBlock(text, "Fashion Stats");
    const type = cleanWikiText(param(infobox, "type"));
    const rarity = Number(cleanWikiText(param(infobox, "rarity"))) || 3;
    const set = cleanWikiText(param(infobox, "set"));
    const source = cleanWikiText(param(infobox, "obtain"));
    const tagRaw = param(infobox, "tag");
    const tags = [...tagRaw.matchAll(/\{\{\s*Tag\s*\|\s*([^}|]+)[^}]*\}\}/gi)].map(m => m[1].trim());

    const stats = {};
    const scores = Object.fromEntries(STYLES.map(s => [s, 0]));
    for (let i = 1; i <= 5; i++) {
      const style = cleanWikiText(param(statsBlock, `style${i}`));
      const scale = Number(cleanWikiText(param(statsBlock, `scale${i}`))) || 0;
      const rating = cleanWikiText(param(statsBlock, `rating${i}`)).toUpperCase();
      if (!STYLES.includes(style) || !rating) continue;
      const score = wikiScore(rating, scale);
      stats[style] = { rating, scale, score };
      scores[style] = score;
    }

    if (!Object.keys(stats).length) throw new Error("Wiki item có trang nhưng chưa đọc được Fashion Stats.");

    return {
      title,
      page: title,
      url: `${WIKI_BASE}${encodeURIComponent(title.replace(/ /g, "_"))}`,
      type,
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
    keys.slice(150).forEach(k => delete cache[k]);
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  }

  async function api(params) {
    const qs = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
    const res = await fetch(`${WIKI_API}?${qs}`);
    if (!res.ok) throw new Error(`Wiki API ${res.status}`);
    return res.json();
  }

  async function searchWiki(query) {
    const q = String(query || "").trim();
    if (q.length < 2) return [];
    const data = await api({ action: "query", list: "prefixsearch", pssearch: q, psnamespace: "0", pslimit: "10" });
    return data?.query?.prefixsearch || [];
  }

  async function fetchFashion(title, force = false) {
    const cached = readCache()[title];
    if (cached && !force && cached?.stats && Object.keys(cached.stats).length) return cached;
    const data = await api({
      action: "query",
      prop: "revisions|pageimages",
      rvprop: "content",
      rvslots: "main",
      titles: title,
      piprop: "thumbnail",
      pithumbsize: "500"
    });
    const page = data?.query?.pages?.[0];
    if (!page || page.missing) throw new Error("Không tìm thấy item trên Wiki.");
    const text = page.revisions?.[0]?.slots?.main?.content || "";
    const parsed = parseWikiFashion(page.title, text, page.thumbnail?.source || "");
    writeCache(title, parsed);
    return parsed;
  }

  function formatWikiNumber(n) {
    const x = Number(n || 0);
    return Number.isInteger(x) ? String(x) : x.toFixed(1);
  }

  function installStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .wiki-tools{grid-column:1/-1;margin:-2px 0 4px;padding:12px;border:1px solid #ded4ee;border-radius:15px;background:#fbf9ff;position:relative}.wiki-tools-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.wiki-tools-head strong{font-size:11px}.wiki-sync-btn{border:1px solid var(--line);background:#fff;border-radius:10px;padding:7px 10px;font:inherit;font-size:10px;font-weight:750;cursor:pointer}.wiki-status{font-size:10px;color:var(--muted);line-height:1.45;margin-top:7px}.wiki-status.good{color:var(--good)}.wiki-status.bad{color:var(--danger)}
      .wiki-results{display:none;position:absolute;z-index:40;left:12px;right:12px;top:calc(100% - 2px);background:#fff;border:1px solid var(--line);border-radius:13px;box-shadow:0 16px 36px rgba(40,25,60,.16);max-height:270px;overflow:auto}.wiki-results.show{display:block}.wiki-result{width:100%;border:0;border-bottom:1px solid #f0ecf3;background:#fff;text-align:left;padding:11px 12px;font:inherit;cursor:pointer}.wiki-result:last-child{border-bottom:0}.wiki-result:hover{background:#faf8ff}.wiki-result strong{display:block;font-size:12px}.wiki-result span{display:block;font-size:9px;color:var(--muted);margin-top:2px}
      .wiki-card{display:none;margin-top:10px;padding:12px;border-radius:13px;background:#f1edff;border:1px solid #e0d6f5}.wiki-card.show{display:block}.wiki-card-top{display:flex;align-items:start;justify-content:space-between;gap:10px}.wiki-card strong{font-size:12px}.wiki-card a{font-size:10px;color:var(--accent);font-weight:750}.wiki-stat-pills{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.wiki-stat-pill{background:#fff;border:1px solid #dfd7ee;border-radius:999px;padding:6px 8px;font-size:9px}.wiki-stat-pill b{font-size:10px}.wiki-score-help{font-size:9px;color:var(--muted);line-height:1.45;margin-top:8px}
      .dye-box{grid-column:1/-1;margin-top:4px;padding:14px;border:1px solid var(--line);border-radius:16px;background:#fffafc}.dye-head{display:flex;align-items:start;justify-content:space-between;gap:10px}.dye-head h3{font-size:14px;margin:3px 0 0}.dye-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:11px}.dye-grid label{display:grid;gap:6px;font-size:10px;font-weight:750;color:#6e6677}.dye-grid input,.dye-grid select{height:40px;border:1px solid var(--line);border-radius:11px;background:#fff;padding:0 10px;font:inherit;font-size:13px}.check-row{display:flex!important;align-items:center;gap:8px!important}.check-row input{width:18px;height:18px}.dye-summary{font-size:9px;color:var(--muted);line-height:1.45;margin-top:9px}.score-input[data-wiki-rating] label:after{content:" · " attr(data-wiki-rating);color:var(--accent);font-weight:850}
      .inventory-table tbody tr[data-view-item]{cursor:pointer}.inventory-table tbody tr[data-view-item]:hover{background:#faf8ff}.inventory-card[data-view-item]{cursor:pointer}.item-linkish{color:var(--ink);text-decoration:none}.item-linkish:hover{color:var(--accent)}.wiki-mini{display:inline-flex;margin-left:5px;font-size:8px;padding:2px 5px;border-radius:999px;background:#f0ebff;color:var(--accent);font-weight:800}
      .detail-backdrop{position:fixed;inset:0;z-index:130;background:rgba(30,24,37,.46);backdrop-filter:blur(7px);display:grid;place-items:center;padding:18px}.detail-backdrop[hidden]{display:none}.detail-modal{width:min(720px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:24px;box-shadow:0 30px 80px rgba(31,20,42,.24)}.detail-hero{padding:22px 22px 18px;display:grid;grid-template-columns:90px 1fr auto;gap:16px;align-items:start;border-bottom:1px solid var(--line)}.detail-img{width:90px;height:90px;border-radius:16px;background:#f3eff7;overflow:hidden;display:grid;place-items:center;font-weight:850;color:#8e7da1}.detail-img img{width:100%;height:100%;object-fit:cover}.detail-hero h2{margin:4px 0 5px;font-size:22px}.detail-meta{font-size:11px;color:var(--muted);line-height:1.55}.detail-body{padding:18px 22px}.detail-section+.detail-section{margin-top:19px}.detail-section h3{margin:0 0 10px;font-size:14px}.detail-score-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.detail-score{border:1px solid var(--line);border-radius:13px;padding:10px}.detail-score-top{display:flex;justify-content:space-between;gap:8px;align-items:center}.detail-score strong{font-size:12px}.detail-score b{font-size:16px}.detail-score small{display:block;color:var(--muted);font-size:9px;margin-top:5px}.detail-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.detail-info{background:#faf8fc;border-radius:12px;padding:10px}.detail-info span{display:block;color:var(--muted);font-size:9px}.detail-info strong{display:block;font-size:11px;margin-top:4px;line-height:1.4}.detail-actions{position:sticky;bottom:0;padding:13px 22px calc(13px + env(safe-area-inset-bottom));background:rgba(255,255,255,.94);backdrop-filter:blur(10px);border-top:1px solid var(--line);display:flex;gap:9px;justify-content:flex-end}.detail-wiki-link{color:var(--accent);font-weight:800;text-decoration:none;font-size:11px}
      @media(max-width:760px){.wiki-results{position:fixed;left:12px;right:12px;top:auto;bottom:calc(86px + env(safe-area-inset-bottom));max-height:42vh}.dye-grid{grid-template-columns:1fr}.wiki-tools input,.dye-grid input,.dye-grid select{font-size:16px}.detail-backdrop{padding:0;align-items:end}.detail-modal{width:100%;max-height:94vh;border-radius:22px 22px 0 0}.detail-hero{grid-template-columns:70px 1fr auto;padding:18px 16px 15px;gap:12px}.detail-img{width:70px;height:70px;border-radius:14px}.detail-hero h2{font-size:19px}.detail-body{padding:16px}.detail-score-grid,.detail-info-grid{grid-template-columns:1fr 1fr}.detail-actions{padding-left:16px;padding-right:16px}.detail-actions .primary-btn,.detail-actions .secondary-btn{min-height:44px}}
      @media(max-width:390px){.detail-score-grid{grid-template-columns:1fr}.detail-info-grid{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(style);
  }

  function installUi() {
    const nameLabel = $("itemName")?.closest("label");
    if (!nameLabel || $("wikiTools")) return;
    nameLabel.insertAdjacentHTML("afterend", `
      <div class="wiki-tools" id="wikiTools">
        <div class="wiki-tools-head"><strong>Life Makeover Wiki</strong><button class="wiki-sync-btn" id="wikiSyncBtn" type="button">Tra / đồng bộ Wiki</button></div>
        <div class="wiki-status" id="wikiStatus">Gõ tên món. Nếu tên khớp Wiki, app sẽ tự lấy thông tin và gắn link.</div>
        <div class="wiki-results" id="wikiResults"></div>
        <div class="wiki-card" id="wikiCard"></div>
      </div>`);

    $("scoreInputs").insertAdjacentHTML("afterend", `
      <div class="dye-box">
        <div class="dye-head"><div><p class="eyebrow">DYE / CHARM</p><h3>Thông tin dye của món này</h3></div><span class="status owned" id="dyeBonusBadge">+0%</span></div>
        <div class="dye-grid">
          <label class="check-row"><input id="dyeEnabled" type="checkbox"> Có áp dụng Dye / Charm</label>
          <label>Charm progress (0–16)<input id="dyeCharm" type="number" min="0" max="16" step="1" inputmode="numeric" value="0"></label>
          <label class="check-row"><input id="dyeXPalette" type="checkbox"> Đã mở X Palette</label>
        </div>
        <div class="dye-summary" id="dyeSummary">Charm 0–7: +0% · 8–15: +5% · 16: +10%. X Palette chỉ lưu trạng thái, chưa tự cộng thêm điểm.</div>
      </div>`);

    const scoreHead = document.querySelector(".score-editor-head h3");
    if (scoreHead) scoreHead.textContent = "Điểm Wiki theo thuộc tính";
    const scoreHint = document.querySelector(".score-editor-head .hint");
    if (scoreHint) scoreHint.textContent = "Tự điền khi match item trên Wiki; vẫn có thể sửa tay.";
    qsa(".score-input input").forEach(input => input.step = "0.5");

    $("itemName").addEventListener("input", onNameInput);
    $("wikiSyncBtn").addEventListener("click", () => syncTypedName(true));
    $("dyeEnabled").addEventListener("change", updateDyeUi);
    $("dyeCharm").addEventListener("input", updateDyeUi);
    document.addEventListener("click", e => {
      if (!e.target.closest("#wikiTools") && e.target !== $("itemName")) $("wikiResults")?.classList.remove("show");
    });
  }

  function installDetailModal() {
    if ($("itemDetailModal")) return;
    document.body.insertAdjacentHTML("beforeend", `
      <div class="detail-backdrop" id="itemDetailModal" hidden>
        <article class="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detailTitle">
          <div id="itemDetailContent"></div>
        </article>
      </div>`);
    $("itemDetailModal").addEventListener("click", e => { if (e.target === $("itemDetailModal")) closeItemDetail(); });
  }

  function renderWikiCard(data) {
    const card = $("wikiCard");
    if (!card) return;
    if (!data) { card.classList.remove("show"); card.innerHTML = ""; return; }
    const pills = STYLES.filter(s => data.stats?.[s]).map(style => {
      const st = data.stats[style];
      return `<span class="wiki-stat-pill"><b>${style}</b> ${esc(st.rating)} ×${formatWikiNumber(st.scale)} = <b>${formatWikiNumber(st.score)}</b></span>`;
    }).join("");
    card.innerHTML = `<div class="wiki-card-top"><div><strong>${esc(data.title)}</strong><div class="wiki-status good">${esc(data.type || "Fashion")} · ${data.rarity}★${data.set ? ` · ${esc(data.set)}` : ""}</div></div><a href="${esc(data.url)}" target="_blank" rel="noopener">Mở Wiki ↗</a></div><div class="wiki-stat-pills">${pills}</div><div class="wiki-score-help">Số đậm là <b>điểm Wiki</b> dùng trong app. Ví dụ SSS ×3 → 63. Wiki không công bố raw final point của game.</div>`;
    card.classList.add("show");
  }

  function renderScoreLabels(data) {
    qsa(".score-input").forEach(box => {
      delete box.dataset.wikiRating;
      const label = box.querySelector("label");
      if (label) box.removeAttribute("data-wiki-rating");
    });
    if (!data) return;
    STYLES.forEach(style => {
      const input = $(`score-${style}`);
      const box = input?.closest(".score-input");
      const st = data.stats?.[style];
      if (box && st) box.dataset.wikiRating = `${st.rating} ×${formatWikiNumber(st.scale)}`;
    });
  }

  function onNameInput() {
    selectedWiki = null;
    renderWikiCard(null);
    renderScoreLabels(null);
    const q = $("itemName").value.trim();
    $("wikiStatus").className = "wiki-status";
    $("wikiStatus").textContent = q.length >= 2 ? "Đang tìm tên gần khớp…" : "Gõ tên món. Nếu tên khớp Wiki, app sẽ tự lấy thông tin và gắn link.";
    clearTimeout(searchTimer);
    if (q.length < 2) { $("wikiResults").classList.remove("show"); return; }
    searchTimer = setTimeout(() => suggestForName(q), 320);
  }

  async function suggestForName(q) {
    try {
      const results = await searchWiki(q);
      const exact = results.find(r => r.title.toLowerCase() === q.toLowerCase());
      if (exact) {
        await chooseWiki(exact.title);
        return;
      }
      $("wikiResults").innerHTML = results.length ? results.map(r => `<button type="button" class="wiki-result" data-wiki-title="${esc(r.title)}"><strong>${esc(r.title)}</strong><span>Chọn để lấy điểm + thông tin Wiki</span></button>`).join("") : `<button class="wiki-result" type="button"><span>Không tìm thấy tên gần khớp.</span></button>`;
      $("wikiResults").classList.toggle("show", !!results.length);
      qsa("[data-wiki-title]").forEach(btn => btn.addEventListener("click", () => chooseWiki(btn.dataset.wikiTitle)));
      $("wikiStatus").textContent = results.length ? "Chọn đúng món trong danh sách bên dưới." : "Chưa match Wiki. Bạn vẫn có thể nhập tay.";
    } catch (err) {
      $("wikiStatus").className = "wiki-status bad";
      $("wikiStatus").textContent = `Không gọi được Wiki: ${err.message}`;
    }
  }

  async function syncTypedName(force = false) {
    const q = $("itemName").value.trim();
    if (!q) return;
    $("wikiStatus").className = "wiki-status";
    $("wikiStatus").textContent = "Đang đồng bộ Wiki…";
    try {
      const results = await searchWiki(q);
      const exact = results.find(r => r.title.toLowerCase() === q.toLowerCase()) || (results.length === 1 ? results[0] : null);
      if (!exact) {
        await suggestForName(q);
        if (force) $("wikiStatus").textContent = "Có nhiều kết quả. Chọn đúng món trong danh sách.";
        return;
      }
      await chooseWiki(exact.title, force);
    } catch (err) {
      $("wikiStatus").className = "wiki-status bad";
      $("wikiStatus").textContent = `Không đồng bộ được: ${err.message}`;
    }
  }

  async function chooseWiki(title, force = false) {
    $("wikiResults").classList.remove("show");
    $("wikiStatus").className = "wiki-status";
    $("wikiStatus").textContent = "Đang lấy Fashion Stats…";
    try {
      const data = await fetchFashion(title, force);
      selectedWiki = data;
      $("itemName").value = data.title;
      if (TYPES.includes(data.type)) $("itemType").value = data.type;
      $("itemRarity").value = String(data.rarity || 3);
      $("itemSet").value = data.set || "";
      $("itemSource").value = data.source || "";
      if (data.thumbnail) $("itemImage").value = data.thumbnail;
      STYLES.forEach(style => { $(`score-${style}`).value = data.scores?.[style] || 0; });
      renderScoreLabels(data);
      renderWikiCard(data);
      $("wikiStatus").className = "wiki-status good";
      $("wikiStatus").innerHTML = `Đã gắn Wiki · <a href="${esc(data.url)}" target="_blank" rel="noopener">${esc(data.title)} ↗</a> · ${Object.keys(data.stats).length} stat`;
    } catch (err) {
      selectedWiki = null;
      $("wikiStatus").className = "wiki-status bad";
      $("wikiStatus").textContent = `Không đọc được stat: ${err.message}`;
    }
  }

  function updateDyeUi() {
    const enabled = !!$("dyeEnabled")?.checked;
    const charm = Math.max(0, Math.min(16, Number($("dyeCharm")?.value || 0)));
    if ($("dyeCharm")) $("dyeCharm").disabled = !enabled;
    const bonus = enabled ? (charm >= 16 ? 10 : charm >= 8 ? 5 : 0) : 0;
    if ($("dyeBonusBadge")) $("dyeBonusBadge").textContent = `+${bonus}%`;
  }

  function getExistingRawItem(id) {
    return items.find(i => i.id === id) || null;
  }

  function enhancedSubmit(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const id = $("itemId").value || uid();
    const old = getExistingRawItem(id);
    const scoreMap = {};
    STYLES.forEach(style => scoreMap[style] = Math.max(0, Number($(`score-${style}`).value || 0)));
    const base = normalizeItem({
      id,
      name: $("itemName").value.trim(),
      set: $("itemSet").value.trim(),
      type: $("itemType").value,
      rarity: Number($("itemRarity").value),
      status: $("itemStatus").value,
      source: $("itemSource").value.trim(),
      image: $("itemImage").value.trim(),
      note: $("itemNote").value.trim(),
      scores: scoreMap
    });
    const wiki = selectedWiki || old?.wiki || null;
    if (wiki && wiki.title.toLowerCase() === base.name.toLowerCase()) base.wiki = wiki;
    base.dye = {
      enabled: !!$("dyeEnabled")?.checked,
      charm: Math.max(0, Math.min(16, Number($("dyeCharm")?.value || 0))),
      xPalette: !!$("dyeXPalette")?.checked
    };
    const idx = items.findIndex(i => i.id === id);
    if (idx >= 0) items[idx] = base; else items.push(base);
    saveItems();
    closeItemModal();
    toast(idx >= 0 ? "Đã cập nhật món đồ" : "Đã thêm món đồ");
  }

  function patchFormSubmit() {
    $("itemForm").removeEventListener("submit", handleItemSubmit);
    $("itemForm").addEventListener("submit", enhancedSubmit);
  }

  const baseOpenItemModal = openItemModal;
  openItemModal = function(id = null) {
    baseOpenItemModal(id);
    const item = id ? items.find(i => i.id === id) : null;
    selectedWiki = item?.wiki || null;
    // app.js fills effective score; editor must show raw/base score to avoid applying dye twice on save.
    STYLES.forEach(style => { $(`score-${style}`).value = Number(item?.scores?.[style] || 0); });
    if ($("dyeEnabled")) $("dyeEnabled").checked = !!item?.dye?.enabled;
    if ($("dyeCharm")) $("dyeCharm").value = Number(item?.dye?.charm || 0);
    if ($("dyeXPalette")) $("dyeXPalette").checked = !!item?.dye?.xPalette;
    renderWikiCard(selectedWiki);
    renderScoreLabels(selectedWiki);
    if ($("wikiStatus")) {
      if (selectedWiki) {
        $("wikiStatus").className = "wiki-status good";
        $("wikiStatus").innerHTML = `Đã gắn Wiki · <a href="${esc(selectedWiki.url)}" target="_blank" rel="noopener">${esc(selectedWiki.title)} ↗</a>`;
      } else {
        $("wikiStatus").className = "wiki-status";
        $("wikiStatus").textContent = "Gõ tên món. Nếu tên khớp Wiki, app sẽ tự lấy thông tin và gắn link.";
      }
    }
    $("wikiResults")?.classList.remove("show");
    updateDyeUi();
  };

  function renderInventoryEnhanced() {
    const data = filteredInventory();
    $("inventoryMeta").textContent = `${data.length} / ${items.length} món · ${ownedItems().length} sở hữu · ${targetItems().length} mục tiêu`;
    $("inventoryBody").innerHTML = data.length ? data.map(item => {
      const best = strongestScore(item);
      const wiki = item.wiki ? `<span class="wiki-mini">WIKI</span>` : "";
      return `<tr data-view-item="${item.id}" tabindex="0"><td><div class="item-cell"><div class="item-thumb">${item.image ? `<img src="${esc(item.image)}" alt="">` : esc(item.type.slice(0,2).toUpperCase())}</div><div><strong class="item-linkish">${esc(item.name)}${wiki}</strong><span>${esc(item.set || "Không thuộc set")}</span></div></div></td><td>${esc(item.type)}</td><td><span class="star">${item.rarity}★</span></td><td><span class="status ${item.status}">${item.status === "owned" ? "Sở hữu" : "Mục tiêu"}</span></td><td>${best.score ? `${best.style} · ${formatWikiNumber(best.score)}` : "—"}</td><td><div class="row-actions"><button class="tiny-btn" data-edit="${item.id}">Sửa</button></div></td></tr>`;
    }).join("") : `<tr><td colspan="6"><div class="empty-state">Không có item phù hợp bộ lọc.</div></td></tr>`;

    $("inventoryCards").innerHTML = data.map(item => {
      const best = strongestScore(item);
      return `<div class="inventory-card" data-view-item="${item.id}" tabindex="0"><div class="inventory-card-top"><div><strong>${esc(item.name)}${item.wiki ? `<span class="wiki-mini">WIKI</span>` : ""}</strong><p>${esc(item.type)} · ${esc(item.set || "Không thuộc set")}</p></div><span class="star">${item.rarity}★</span></div><div class="inventory-card-bottom"><span class="status ${item.status}">${item.status === "owned" ? "Sở hữu" : "Mục tiêu"}</span><span>${best.score ? `${best.style} ${formatWikiNumber(best.score)}` : "—"}</span><button class="tiny-btn" data-edit="${item.id}">Sửa</button></div></div>`;
    }).join("");

    qsa("[data-view-item]").forEach(el => {
      el.addEventListener("click", e => { if (!e.target.closest("[data-edit]")) openItemDetail(el.dataset.viewItem); });
      el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openItemDetail(el.dataset.viewItem); } });
    });
    qsa("[data-edit]").forEach(btn => btn.addEventListener("click", e => { e.stopPropagation(); openItemModal(btn.dataset.edit); }));
  }

  renderInventory = renderInventoryEnhanced;

  function openItemDetail(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const wikiStats = item.wiki?.stats || {};
    const scoreCards = STYLES.filter(style => Number(item.scores?.[style] || 0) > 0).map(style => {
      const base = Number(item.scores?.[style] || 0);
      const effective = getScore(item, style);
      const st = wikiStats[style];
      const extra = st ? `${esc(st.rating)} ×${formatWikiNumber(st.scale)} · Wiki base ${formatWikiNumber(base)}` : `Điểm base ${formatWikiNumber(base)}`;
      const dyeText = effective !== base ? ` · sau dye ${formatWikiNumber(effective)}` : "";
      return `<div class="detail-score"><div class="detail-score-top"><strong>${style}</strong><b>${formatWikiNumber(effective)}</b></div><small>${extra}${dyeText}</small></div>`;
    }).join("") || `<div class="empty-state">Món này chưa có điểm thuộc tính.</div>`;

    const charm = Number(item.dye?.charm || 0);
    const dyeBonus = item.dye?.enabled ? (charm >= 16 ? 10 : charm >= 8 ? 5 : 0) : 0;
    const image = item.image ? `<img src="${esc(item.image)}" alt="${esc(item.name)}">` : esc(item.type.slice(0,2).toUpperCase());
    const wikiLink = item.wiki?.url ? `<a class="detail-wiki-link" href="${esc(item.wiki.url)}" target="_blank" rel="noopener">Mở trang Wiki ↗</a>` : `<span class="muted">Chưa gắn Wiki</span>`;
    $("itemDetailContent").innerHTML = `
      <div class="detail-hero"><div class="detail-img">${image}</div><div><p class="eyebrow">ITEM DETAIL</p><h2 id="detailTitle">${esc(item.name)}</h2><div class="detail-meta">${esc(item.type)} · ${item.rarity}★ · ${item.status === "owned" ? "Đang sở hữu" : "Mục tiêu"}${item.set ? ` · ${esc(item.set)}` : ""}</div><div style="margin-top:7px">${wikiLink}</div></div><button class="icon-btn" id="detailCloseBtn" aria-label="Đóng">×</button></div>
      <div class="detail-body">
        <section class="detail-section"><h3>Điểm theo thuộc tính</h3><div class="detail-score-grid">${scoreCards}</div><p class="wiki-score-help">Điểm Wiki là chỉ số quy đổi minh bạch từ rating + scale của Wiki để app xếp hạng. Nó không phải raw final battle point trong game.</p></section>
        <section class="detail-section"><h3>Thông tin món</h3><div class="detail-info-grid"><div class="detail-info"><span>Set</span><strong>${esc(item.set || "Không thuộc set")}</strong></div><div class="detail-info"><span>Nguồn</span><strong>${esc(item.source || "—")}</strong></div><div class="detail-info"><span>Dye / Charm</span><strong>${item.dye?.enabled ? `Charm ${charm}/16 · +${dyeBonus}%` : "Chưa áp dụng"}</strong></div><div class="detail-info"><span>X Palette</span><strong>${item.dye?.xPalette ? "Đã mở" : "Chưa / không nhập"}</strong></div>${item.wiki?.tags?.length ? `<div class="detail-info"><span>Tags</span><strong>${item.wiki.tags.map(esc).join(" · ")}</strong></div>` : ""}<div class="detail-info"><span>Ghi chú</span><strong>${esc(item.note || "—")}</strong></div></div></section>
      </div>
      <div class="detail-actions"><button class="secondary-btn" id="detailCloseBtn2">Đóng</button><button class="primary-btn" id="detailEditBtn">Sửa món</button></div>`;
    $("itemDetailModal").hidden = false;
    $("detailCloseBtn").addEventListener("click", closeItemDetail);
    $("detailCloseBtn2").addEventListener("click", closeItemDetail);
    $("detailEditBtn").addEventListener("click", () => { closeItemDetail(); openItemModal(id); });
  }

  function closeItemDetail() { if ($("itemDetailModal")) $("itemDetailModal").hidden = true; }

  document.addEventListener("keydown", e => { if (e.key === "Escape" && $("itemDetailModal") && !$("itemDetailModal").hidden) closeItemDetail(); });

  loadRawExtras();
  installStyles();
  installUi();
  installDetailModal();
  patchFormSubmit();
  updateDyeUi();
  renderAll();
})();
