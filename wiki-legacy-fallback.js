/* Collision guard for Wiki pages that do not expose current Fashion Stats.
 * Important: item names can be reused across versions/events. Never invent or estimate scores,
 * and never overwrite the user's slot/rarity from an old same-name Wiki record.
 */
(() => {
  const API = "https://lifemakeover.wiki.gg/api.php";
  const BASE = "https://lifemakeover.wiki.gg/wiki/";
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
      card.innerHTML = `<div class="wiki-card-top"><div><strong>${meta.title}</strong><div class="wiki-status bad">Record Wiki hiện tại: ${detail || "không đủ metadata"}</div></div><a href="${meta.url}" target="_blank" rel="noopener">Mở Wiki ↗</a></div><div class="wiki-score-help"><b>Có thể trùng tên item.</b> App sẽ không tự đổi slot, rarity hay tạo điểm ước tính từ record này. Nếu món trong game của bạn là phiên bản mới/event mới, hãy giữ metadata đúng theo game; điểm chỉ được dùng khi có nguồn stat tương ứng với đúng phiên bản.</div>`;
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
      // Keep catalog.js' original error. A failed secondary lookup must never alter user data.
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
