/* Current Global catalog overrides for items that have reached the game before wiki.gg catches up.
 * These records are intentionally small and evidence-backed. They never overwrite account-specific Dye/Charm.
 * Numeric fallback uses rating tier base only when Wiki scale is unavailable; the UI labels this clearly.
 */
(() => {
  const RATING_BASE = { C:10, B:20, A:30, S:40, SS:50, SSS:60 };
  const RECORDS = [
    {
      name:"Cloud Wish",
      type:"Hairstyle",
      rarity:6,
      set:"Grace of Plume",
      source:"Limited Lightchase · Hymn of Feathers · Sep 9–29, 2026",
      sourceUrl:"https://steamcommunity.com/app/2626940",
      evidence:"In-game screenshot + official Global event",
      stats:{
        Pure:{rating:"SSS"},
        Simple:{rating:"S"},
        Sweet:{rating:"S"},
        Elegant:{rating:"S"},
        Fresh:{rating:"A"}
      }
    },
    {
      name:"Starlit Reverie",
      type:"Hairstyle",
      rarity:5,
      set:"Moonlit Isle",
      source:"Fashion Code · Moonlit Isle · Sep 9–Oct 20, 2026",
      sourceUrl:"https://steamcommunity.com/app/2626940",
      evidence:"In-game screenshot + official Global Fashion Code",
      stats:{
        Pure:{rating:"SS"},
        Sweet:{rating:"S"},
        Elegant:{rating:"A"},
        Gorgeous:{rating:"A"},
        Fresh:{rating:"B"}
      }
    },
    {
      name:"Moonlit Isle",
      type:"Dress",
      rarity:5,
      set:"Moonlit Isle",
      source:"Fashion Code · Moonlit Isle · Sep 9–Oct 20, 2026",
      sourceUrl:"https://steamcommunity.com/app/2626940",
      evidence:"In-game screenshot + official Global Fashion Code",
      stats:{
        Pure:{rating:"SS"},
        Sweet:{rating:"S"},
        Gorgeous:{rating:"A"},
        Elegant:{rating:"A"},
        Fresh:{rating:"B"}
      }
    }
  ];

  let activeRecord = null;

  const norm = value => String(value || "").normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
  const key = (name,type,rarity) => `${norm(name)}|${norm(type)}|${Number(rarity||0)}`;
  const byName = name => RECORDS.find(x => norm(x.name) === norm(name)) || null;

  function scoreFor(stat) {
    return RATING_BASE[String(stat?.rating || "").toUpperCase()] || 0;
  }

  function ensureUi() {
    const tools = document.getElementById("wikiTools");
    if (!tools) return null;
    let box = document.getElementById("globalCatalogCard");
    if (box) return box;
    box = document.createElement("div");
    box.id = "globalCatalogCard";
    box.className = "global-catalog-card";
    box.hidden = true;
    tools.insertAdjacentElement("afterend", box);
    return box;
  }

  function installStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .global-catalog-card{grid-column:1/-1;margin:-2px 0 4px;padding:12px 13px;border:1px solid #cfe4d4;border-radius:15px;background:#f4fbf6}.global-catalog-card[hidden]{display:none}.global-catalog-top{display:flex;justify-content:space-between;gap:12px;align-items:start}.global-catalog-card strong{font-size:12px}.global-catalog-badge{display:inline-flex;border-radius:999px;background:#dff3e5;color:#31704a;padding:4px 7px;font-size:8px;font-weight:850;white-space:nowrap}.global-catalog-meta{font-size:9px;color:var(--muted);line-height:1.5;margin-top:4px}.global-catalog-stats{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.global-catalog-stat{background:#fff;border:1px solid #d8eadc;border-radius:999px;padding:5px 7px;font-size:9px}.global-catalog-note{font-size:9px;line-height:1.45;color:#6c746e;margin-top:8px}.global-catalog-card a{color:var(--accent);font-size:9px;font-weight:800;text-decoration:none}
    `;
    document.head.appendChild(style);
  }

  function renderRecord(record) {
    const box = ensureUi();
    if (!box) return;
    if (!record) { box.hidden = true; box.innerHTML = ""; return; }
    const pills = Object.entries(record.stats || {}).map(([style,stat]) => `<span class="global-catalog-stat"><b>${style}</b> ${stat.rating} · index ${scoreFor(stat)}</span>`).join("");
    box.hidden = false;
    box.innerHTML = `<div class="global-catalog-top"><div><strong>${record.name}</strong><div class="global-catalog-meta">${record.type} · ${record.rarity}★ · ${record.set}<br>${record.source}</div></div><span class="global-catalog-badge">CURRENT GLOBAL</span></div><div class="global-catalog-stats">${pills}</div><div class="global-catalog-note">Wiki.gg chưa có scale cho record này. App tạm dùng <b>rating-tier index</b> (SSS 60 · SS 50 · S 40 · A 30 · B 20) để không bỏ trống item; đây không phải raw battle point. Dye/Charm của tài khoản vẫn nhập riêng.</div><a href="${record.sourceUrl}" target="_blank" rel="noopener">Nguồn event Global ↗</a>`;
  }

  function applyRecord(record) {
    if (!record) return;
    activeRecord = record;
    const set = (id,value) => { const el=document.getElementById(id); if(el) el.value=value ?? ""; };
    set("itemName", record.name);
    set("itemType", record.type);
    set("itemRarity", String(record.rarity));
    set("itemSet", record.set);
    set("itemSource", record.source);
    if (typeof STYLES !== "undefined") STYLES.forEach(style => {
      const input = document.getElementById(`score-${style}`);
      if (input) input.value = scoreFor(record.stats?.[style]);
      const box = input?.closest(".score-input");
      if (box) {
        if (record.stats?.[style]) box.dataset.wikiRating = `${record.stats[style].rating} · Global`;
        else delete box.dataset.wikiRating;
      }
    });
    renderRecord(record);
    const status = document.getElementById("wikiStatus");
    if (status) {
      status.className = "wiki-status good";
      status.textContent = "Đã match Current Global catalog · Wiki.gg chưa cập nhật item này.";
    }
    document.getElementById("wikiResults")?.classList.remove("show");
    setTimeout(() => document.getElementById("duplicateGuard") && document.getElementById("itemName")?.dispatchEvent(new Event("change",{bubbles:true})), 0);
  }

  function onNameCapture(event) {
    const record = byName(event.target.value);
    if (!record) {
      if (activeRecord && norm(activeRecord.name) !== norm(event.target.value)) activeRecord = null;
      renderRecord(null);
      return;
    }
    event.stopImmediatePropagation();
    applyRecord(record);
  }

  function onSyncCapture(event) {
    const record = byName(document.getElementById("itemName")?.value);
    if (!record) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    applyRecord(record);
  }

  function attachMetadataAfterSave() {
    if (!activeRecord || typeof items === "undefined") return;
    const record = activeRecord;
    const expected = key(record.name,record.type,record.rarity);
    setTimeout(() => {
      const item = items.find(x => key(x.name,x.type,x.rarity) === expected);
      if (!item) return;
      item.globalCatalog = {
        name:record.name,type:record.type,rarity:record.rarity,set:record.set,source:record.source,sourceUrl:record.sourceUrl,
        evidence:record.evidence,stats:record.stats,scoreMode:"rating-tier-only",updatedAt:new Date().toISOString()
      };
      if (typeof saveItems === "function") saveItems();
    }, 0);
  }

  function install() {
    installStyles();
    ensureUi();
    const name = document.getElementById("itemName");
    const sync = document.getElementById("wikiSyncBtn");
    name?.addEventListener("input", onNameCapture, true);
    sync?.addEventListener("click", onSyncCapture, true);
    document.getElementById("itemForm")?.addEventListener("submit", attachMetadataAfterSave, true);
    const modal = document.getElementById("itemModal");
    if (modal) new MutationObserver(() => {
      if (modal.hidden) { activeRecord = null; renderRecord(null); return; }
      const record = byName(document.getElementById("itemName")?.value);
      if (record) applyRecord(record);
    }).observe(modal,{attributes:true,attributeFilter:["hidden"]});
  }

  window.RYN_CURRENT_GLOBAL_CATALOG = RECORDS;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
