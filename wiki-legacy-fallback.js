/* Legacy Wiki fallback for fashion pages without the newer {{Fashion Stats}} rating+scale template.
 * Uses metadata and ordered style names from Life Makeover Wiki. Because those legacy pages do not
 * publish rating+scale, the numeric value is explicitly marked as an estimated Wiki index.
 */
(() => {
  const API = "https://lifemakeover.wiki.gg/api.php";
  const BASE = "https://lifemakeover.wiki.gg/wiki/";
  const RATING_BASE = { C: 10, B: 20, A: 30, S: 40, SS: 50, SSS: 60 };
  const LEGACY_LADDER = {
    6: ["SSS", "SS", "S", "A", "B"],
    5: ["SS", "S", "A", "A", "B"],
    4: ["S", "A", "A", "B", "C"],
    3: ["A", "B", "B", "C", "C"]
  };
  const LEGACY_SCALE = [2, 1.5, 1, 0.5, 0];
  let pending = null;
  let timer = null;
  let resolving = false;

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

  function styleTokens(text) {
    const found = [];
    const add = value => {
      const s = String(value || "").trim();
      if (typeof STYLES !== "undefined" && STYLES.includes(s) && !found.includes(s)) found.push(s);
    };
    for (const m of String(text || "").matchAll(/\{\{\s*Style\s*\|\s*([^}|]+)[^}]*\}\}/gi)) add(m[1]);
    for (const s of (typeof STYLES !== "undefined" ? STYLES : [])) {
      const re = new RegExp(`(?:^|[^A-Za-z])${escRe(s)}(?:[^A-Za-z]|$)`, "i");
      if (re.test(String(text || ""))) add(s);
    }
    return found;
  }

  function stylesFromRendered(html) {
    const src = String(html || "");
    let chunk = src;
    const marker = src.search(/id=["']Stats["']|>Stats<\/span>/i);
    if (marker >= 0) {
      chunk = src.slice(marker);
      const next = chunk.slice(20).search(/<h2\b|<h3\b/i);
      if (next >= 0) chunk = chunk.slice(0, next + 20);
    }
    const out = [];
    const plain = chunk.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ");
    for (const style of (typeof STYLES !== "undefined" ? STYLES : [])) {
      const idx = plain.search(new RegExp(`\\b${escRe(style)}\\b`, "i"));
      if (idx >= 0) out.push({ style, idx });
    }
    return out.sort((a, b) => a.idx - b.idx).map(x => x.style).slice(0, 5);
  }

  function estimatedStats(styles, rarity) {
    const ladder = LEGACY_LADDER[rarity] || LEGACY_LADDER[4];
    const stats = {};
    const scores = Object.fromEntries((typeof STYLES !== "undefined" ? STYLES : []).map(s => [s, 0]));
    styles.slice(0, 5).forEach((style, index) => {
      const rating = ladder[index] || "C";
      const scale = LEGACY_SCALE[index] || 0;
      const score = Number(((RATING_BASE[rating] || 0) + scale).toFixed(1));
      stats[style] = { rating: `~${rating}`, scale, score, legacyEstimate: true, rank: index + 1 };
      scores[style] = score;
    });
    return { stats, scores };
  }

  async function resolveLegacy(title) {
    const data = await api({
      action: "query",
      prop: "revisions|pageimages",
      rvprop: "content",
      rvslots: "main",
      titles: title,
      piprop: "thumbnail",
      pithumbsize: "500",
      redirects: "1"
    });
    const page = data?.query?.pages?.[0];
    if (!page || page.missing) throw new Error("Không tìm thấy item trên Wiki.");
    const raw = page.revisions?.[0]?.slots?.main?.content || "";
    if (!/\{\{\s*Fashion Infobox/i.test(raw)) throw new Error("Trang này không phải fashion item.");
    const info = templateBlock(raw, "Fashion Infobox") || raw;
    const type = cleanWiki(param(info, "type"));
    const rarity = Number(cleanWiki(param(info, "rarity"))) || 0;
    const set = cleanWiki(param(info, "set"));
    const source = cleanWiki(param(info, "obtain"));
    const tags = [...param(info, "tag").matchAll(/\{\{\s*Tag\s*\|\s*([^}|]+)[^}]*\}\}/gi)].map(m => m[1].trim());
    const primaryStyles = styleTokens(param(info, "style"));

    let rendered = "";
    try {
      const parsed = await api({ action: "parse", page: page.title, prop: "text", redirects: "1" });
      rendered = parsed?.parse?.text || "";
    } catch (_) {}

    let styles = stylesFromRendered(rendered);
    if (!styles.length) styles = primaryStyles;
    primaryStyles.forEach(s => { if (!styles.includes(s)) styles.unshift(s); });
    styles = [...new Set(styles)].slice(0, 5);
    if (!styles.length) throw new Error("Wiki legacy page không có đủ style để fallback.");

    const { stats, scores } = estimatedStats(styles, rarity || 4);
    return {
      title: page.title,
      page: page.title,
      url: `${BASE}${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
      type,
      rarity: rarity || 4,
      set,
      source,
      tags,
      thumbnail: page.thumbnail?.source || "",
      stats,
      scores,
      legacy: true,
      legacyEstimate: true,
      styleOrder: styles,
      fetchedAt: new Date().toISOString()
    };
  }

  function fillForm(data) {
    const name = document.getElementById("itemName");
    const type = document.getElementById("itemType");
    const rarity = document.getElementById("itemRarity");
    const set = document.getElementById("itemSet");
    const source = document.getElementById("itemSource");
    const image = document.getElementById("itemImage");
    const status = document.getElementById("wikiStatus");
    const card = document.getElementById("wikiCard");
    if (!name || name.value.trim().toLowerCase() !== data.title.toLowerCase()) return;

    if (data.type && typeof TYPES !== "undefined" && TYPES.includes(data.type)) type.value = data.type;
    rarity.value = String(data.rarity);
    set.value = data.set || "";
    source.value = data.source || "";
    if (data.thumbnail) image.value = data.thumbnail;
    (typeof STYLES !== "undefined" ? STYLES : []).forEach(style => {
      const input = document.getElementById(`score-${style}`);
      if (input) input.value = data.scores?.[style] || 0;
      const box = input?.closest(".score-input");
      const st = data.stats?.[style];
      if (box && st) box.dataset.wikiRating = `legacy #${st.rank} · ~${String(st.rating).replace(/^~/, "")}`;
    });

    pending = data;
    if (status) {
      status.className = "wiki-status good";
      status.innerHTML = `Đã đọc trang Wiki legacy · <a href="${data.url}" target="_blank" rel="noopener">${data.title} ↗</a> · ${data.type} · ${data.rarity}★`;
    }
    if (card) {
      const pills = data.styleOrder.map(style => {
        const st = data.stats[style];
        return `<span class="wiki-stat-pill"><b>${style}</b> #${st.rank} → <b>~${st.score}</b></span>`;
      }).join("");
      card.innerHTML = `<div class="wiki-card-top"><div><strong>${data.title}</strong><div class="wiki-status good">${data.type} · ${data.rarity}★${data.set ? ` · ${data.set}` : ""}</div></div><a href="${data.url}" target="_blank" rel="noopener">Mở Wiki ↗</a></div><div class="wiki-stat-pills">${pills}</div><div class="wiki-score-help"><b>Trang Wiki legacy:</b> Wiki chỉ có thứ tự style, không có rating + scale. Số có dấu ~ là <b>index ước tính</b> để app vẫn xếp hạng; không phải điểm Wiki chính xác hay raw point trong game.</div>`;
      card.classList.add("show");
    }
  }

  async function tryFallback() {
    if (resolving) return;
    const name = document.getElementById("itemName")?.value.trim();
    const status = document.getElementById("wikiStatus");
    if (!name || !status) return;
    const bad = status.classList.contains("bad") || /chưa đọc được Fashion Stats|không đọc được stat/i.test(status.textContent || "");
    if (!bad) return;
    resolving = true;
    try {
      const data = await resolveLegacy(name);
      fillForm(data);
    } catch (err) {
      if (status.classList.contains("bad")) status.textContent = `Không đọc được stat: ${err.message}`;
    } finally {
      resolving = false;
    }
  }

  function scheduleFallback() {
    clearTimeout(timer);
    pending = null;
    timer = setTimeout(tryFallback, 850);
  }

  function persistPendingAfterSubmit() {
    if (!pending) return;
    const snapshot = pending;
    setTimeout(() => {
      try {
        const id = document.getElementById("itemId")?.value;
        const name = snapshot.title.toLowerCase();
        const item = (typeof items !== "undefined" ? items : []).find(x => (id && x.id === id) || x.name?.toLowerCase() === name);
        if (!item) return;
        item.wiki = snapshot;
        if (!item.image && snapshot.thumbnail) item.image = snapshot.thumbnail;
        if (!item.source) item.source = snapshot.source || "";
        if (!item.set) item.set = snapshot.set || "";
        if (snapshot.type) item.type = snapshot.type;
        if (snapshot.rarity) item.rarity = snapshot.rarity;
        if (typeof saveItems === "function") saveItems();
        if (typeof renderAll === "function") renderAll();
        pending = null;
      } catch (_) {}
    }, 0);
  }

  function install() {
    const input = document.getElementById("itemName");
    const sync = document.getElementById("wikiSyncBtn");
    const form = document.getElementById("itemForm");
    const status = document.getElementById("wikiStatus");
    if (!input || !form || !status) return;

    input.addEventListener("input", scheduleFallback);
    sync?.addEventListener("click", () => setTimeout(tryFallback, 700));
    form.addEventListener("submit", persistPendingAfterSubmit, true);

    const observer = new MutationObserver(() => {
      if (status.classList.contains("bad")) setTimeout(tryFallback, 80);
    });
    observer.observe(status, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
