/* Exact free/grindable item recommendation from the generated Life Makeover Wiki catalog. */
(() => {
  const CATALOG_URL = "data/farmable-catalog.json?v=20260915-0018";
  let catalogPromise = null;
  let refreshTimer = null;

  function nice(n) {
    const x = Number(n || 0);
    return Number.isInteger(x) ? String(x) : x.toFixed(1);
  }

  function weakestStyle() {
    return STYLES.map(style => {
      const out = bestOutfit(style);
      return { style, total: out.total, outfit: out };
    }).sort((a,b) => a.total - b.total || a.outfit.selected.length - b.outfit.selected.length || a.style.localeCompare(b.style))[0];
  }

  function huntBrief(style) {
    const out = bestOutfit(style);
    if (activeScoreMode === "eq" && out.countedAccessories.length < 5) {
      return { slot:"Accessory", accessory:true, rarity:5, threshold:0, reason:`Best set mới có ${out.countedAccessories.length}/5 accessory được tính điểm.` };
    }
    const main = out.selected.filter(x => !isAccessory(x)).map(item => ({item,score:getScore(item,style)}))
      .sort((a,b) => a.item.rarity-b.item.rarity || a.score-b.score);
    const low = main.find(x => x.item.rarity < 6);
    if (low) return { slot:low.item.type, accessory:false, rarity:low.item.rarity <= 4 ? 5 : 6, threshold:low.score, reason:`${low.item.name} (${low.item.rarity}★) là main piece nên nâng trước.` };
    if (activeScoreMode === "eq" && out.countedAccessories.length) {
      const weakAcc=[...out.countedAccessories].sort((a,b)=>getScore(a,style)-getScore(b,style))[0];
      return { slot:"Accessory", accessory:true, rarity:weakAcc.rarity < 5 ? 5 : 6, threshold:getScore(weakAcc,style), reason:`Cần vượt accessory cutoff hiện tại ${nice(getScore(weakAcc,style))}.` };
    }
    const weak=main.sort((a,b)=>a.score-b.score)[0];
    if (weak) return {slot:weak.item.type,accessory:false,rarity:6,threshold:weak.score,reason:`${weak.item.name} là main piece có điểm ${style} thấp nhất.`};
    return {slot:"Dress",accessory:false,rarity:5,threshold:0,reason:`Chưa có main piece đóng góp điểm ${style}.`};
  }

  async function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = fetch(CATALOG_URL, {cache:"no-store"}).then(async res => {
        if (!res.ok) throw new Error(`catalog ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data.items)) throw new Error("catalog invalid");
        return data;
      });
    }
    return catalogPromise;
  }

  function simulate(entry, style) {
    const candidate = {
      id:`farm:${entry.name}`,
      name:entry.name,
      type:entry.type,
      rarity:Number(entry.rarity||3),
      status:"owned",
      source:entry.source||"",
      image:entry.image||"",
      set:entry.set||"",
      note:"",
      scores:Object.fromEntries(STYLES.map(s=>[s,Number(entry.scores?.[s]||0)]))
    };
    const base=bestOutfit(style);
    const after=bestOutfit(style,[...items,candidate]);
    return {entry,candidate,base,after,gain:Number((after.total-base.total).toFixed(1))};
  }

  function ownedNameSet() { return new Set(items.filter(x=>x.status==="owned").map(x=>x.name.trim().toLowerCase())); }

  function findCandidates(catalog, style, brief) {
    const owned=ownedNameSet();
    const strict=catalog.items.filter(entry => {
      if (owned.has(String(entry.name||"").trim().toLowerCase())) return false;
      const score=Number(entry.scores?.[style]||0);
      if (score <= Number(brief.threshold||0)) return false;
      if (Number(entry.sourceTier||0) < 3) return false;
      if (brief.accessory) { if (!entry.accessory) return false; }
      else if (entry.type !== brief.slot) return false;
      if (Number(entry.rarity||0) < Number(brief.rarity||0)) return false;
      return true;
    }).map(x=>simulate(x,style)).filter(x=>x.gain>0);

    let rows=strict;
    if (!rows.length) {
      rows=catalog.items.filter(entry => {
        if (owned.has(String(entry.name||"").trim().toLowerCase())) return false;
        if (Number(entry.sourceTier||0) < 3) return false;
        if (brief.accessory) { if (!entry.accessory) return false; }
        else if (entry.type !== brief.slot) return false;
        return Number(entry.scores?.[style]||0) > Number(brief.threshold||0);
      }).map(x=>simulate(x,style)).filter(x=>x.gain>0);
    }

    return rows.sort((a,b) =>
      Number(b.entry.sourceTier||0)-Number(a.entry.sourceTier||0) ||
      b.gain-a.gain || Number(b.entry.rarity||0)-Number(a.entry.rarity||0) ||
      Number(b.entry.scores?.[style]||0)-Number(a.entry.scores?.[style]||0)
    ).slice(0,5);
  }

  function sourceBadge(entry) {
    const tier=Number(entry.sourceTier||0);
    const cls=tier>=5?"permanent":tier>=4?"currency":"check";
    return `<span class="farm-source ${cls}">${esc(entry.sourceLabel||entry.source||"Wiki source")}</span>`;
  }

  function existingItem(name) { return items.find(x=>x.name.trim().toLowerCase()===String(name||"").trim().toLowerCase()); }

  function openSaved(item) {
    if (!item) return;
    let node=[...document.querySelectorAll("#view-inventory [data-view-item]")].find(x=>x.dataset.viewItem===item.id);
    if (!node && typeof renderInventory === "function") { renderInventory(); node=[...document.querySelectorAll("#view-inventory [data-view-item]")].find(x=>x.dataset.viewItem===item.id); }
    node?.click();
  }

  function addTarget(entry) {
    const existing=existingItem(entry.name);
    if (existing) { openSaved(existing); return; }
    const base=normalizeItem({
      id:uid(),name:entry.name,set:entry.set||"",type:entry.type,rarity:Number(entry.rarity||3),status:"target",
      source:entry.source||entry.route||"",image:entry.image||"",note:`Auto recommendation · ${entry.route||entry.source||"Wiki"}`,
      scores:Object.fromEntries(STYLES.map(s=>[s,Number(entry.scores?.[s]||0)]))
    });
    base.wiki={title:entry.name,page:entry.name,url:entry.url,type:entry.type,rarity:entry.rarity,set:entry.set||"",source:entry.source||"",tags:entry.tags||[],thumbnail:entry.image||"",stats:entry.styles||{},scores:entry.scores||{},fetchedAt:new Date().toISOString()};
    base.dye={enabled:false,charm:0,xPalette:false};
    items.push(base); saveItems(); toast(`Đã thêm ${entry.name} vào Mục tiêu`);
  }

  function cardHtml(row,style,index) {
    const e=row.entry; const score=Number(e.scores?.[style]||0); const saved=existingItem(e.name);
    return `<article class="farm-card">
      <div class="farm-rank">#${index+1}</div>
      <div class="farm-thumb">${e.image?`<img src="${esc(e.image)}" alt="">`:esc(String(e.type||"?").slice(0,2).toUpperCase())}</div>
      <div class="farm-main"><div class="farm-title"><strong>${esc(e.name)}</strong>${sourceBadge(e)}</div>
        <p>${esc(e.type)} · ${e.rarity}★ · ${style} <b>${nice(score)}</b> · dự kiến <b>+${nice(row.gain)}</b></p>
        <small>${esc(e.route||e.source||"Xem Wiki để kiểm tra cách lấy")}</small>
        <div class="farm-links"><a href="${esc(e.url)}" target="_blank" rel="noopener">Item Wiki ↗</a>${e.setUrl?`<a href="${esc(e.setUrl)}" target="_blank" rel="noopener">Set / route ↗</a>`:""}</div>
      </div>
      <button type="button" class="farm-target-btn" data-farm-add="${esc(e.name)}">${saved ? "Xem món" : "+ Mục tiêu"}</button>
    </article>`;
  }

  async function renderInto(host) {
    const weak=weakestStyle(); if (!weak || !host) return;
    const brief=huntBrief(weak.style);
    const signature=`${weak.style}|${brief.slot}|${brief.rarity}|${brief.threshold}|${items.length}`;
    let box=host.querySelector(":scope > .farm-auto");
    if (!box) { box=document.createElement("section"); box.className="farm-auto"; host.appendChild(box); }
    if (box.dataset.signature===signature && box.dataset.ready==="1") return;
    box.dataset.signature=signature;
    box.innerHTML=`<div class="farm-auto-head"><div><span>AUTO WIKI SCAN</span><strong>Đang tìm món free/cày được cho ${weak.style}…</strong></div><i></i></div>`;
    try {
      const catalog=await loadCatalog();
      const rows=findCandidates(catalog,weak.style,brief);
      if (box.dataset.signature!==signature) return;
      box.dataset.ready="1";
      box.innerHTML=`<div class="farm-auto-head"><div><span>AUTO WIKI SCAN · ${catalog.count||catalog.items.length} ITEMS</span><strong>Món cụ thể nên cày cho ${weak.style}</strong><p>Ưu tiên ${esc(brief.slot)} · mục tiêu ${brief.rarity}★+ · ${esc(brief.reason)}</p></div><i>${new Date(catalog.generatedAt).toLocaleDateString("vi-VN")}</i></div>
        ${rows.length?`<div class="farm-list">${rows.map((r,i)=>cardHtml(r,weak.style,i)).join("")}</div>`:`<div class="farm-empty">Catalog chưa tìm được món permanent/free phù hợp vượt mốc hiện tại. App sẽ không bịa tên món; thử cày thêm hoặc xem lại khi catalog Wiki được cập nhật.</div>`}
        <div class="farm-foot">Nguồn: Life Makeover Wiki · chỉ ưu tiên nguồn được phân loại permanent/current grind/exchange. Shop theo mùa vẫn nên kiểm tra stock trong game.</div>`;
      box.querySelectorAll("[data-farm-add]").forEach(btn=>btn.addEventListener("click",()=>{
        const entry=catalog.items.find(x=>x.name===btn.dataset.farmAdd); if(entry) addTarget(entry);
      }));
    } catch(err) {
      box.dataset.ready="1";
      box.innerHTML=`<div class="farm-empty">Không tải được catalog farmable (${esc(err.message)}). Recommendation tổng quát phía trên vẫn hoạt động.</div>`;
    }
  }

  function refresh() {
    document.querySelectorAll("#upgradePreview .weakest-recommend, #weakestFirstTarget .weakest-recommend").forEach(renderInto);
  }

  function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer=setTimeout(refresh,120); }
  new MutationObserver(scheduleRefresh).observe(document.body,{childList:true,subtree:true});

  const style=document.createElement("style");
  style.textContent=`
    .farm-auto{margin-top:12px;border-top:1px solid #e7def2;padding-top:12px}.farm-auto-head{display:flex;justify-content:space-between;gap:12px;align-items:start;margin-bottom:8px}.farm-auto-head span{display:block;font-size:8px;letter-spacing:.1em;font-weight:850;color:var(--accent);margin-bottom:3px}.farm-auto-head strong{font-size:12px}.farm-auto-head p{font-size:9px;color:var(--muted);margin:3px 0 0;line-height:1.4}.farm-auto-head i{font-style:normal;font-size:8px;color:var(--muted)}.farm-list{display:grid;gap:7px}.farm-card{display:grid;grid-template-columns:25px 46px 1fr auto;gap:9px;align-items:center;background:#fff;border:1px solid #e5dced;border-radius:13px;padding:8px}.farm-rank{font-size:9px;font-weight:850;color:var(--muted)}.farm-thumb{width:46px;height:46px;border-radius:10px;background:#f4f0f8;overflow:hidden;display:grid;place-items:center;font-size:10px;font-weight:800}.farm-thumb img{width:100%;height:100%;object-fit:cover}.farm-title{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.farm-title strong{font-size:11px}.farm-main p{margin:3px 0 0;font-size:9px;color:var(--muted)}.farm-main small{display:block;margin-top:3px;font-size:8px;color:#756c7e}.farm-links{display:flex;gap:9px;margin-top:4px}.farm-links a{font-size:8px;color:var(--accent);font-weight:800;text-decoration:none}.farm-source{display:inline-flex;border-radius:999px;padding:2px 5px;font-size:7px;font-weight:850}.farm-source.permanent{background:#e7f7e9;color:#327044}.farm-source.currency{background:#eaf2ff;color:#35649a}.farm-source.check{background:#fff4d8;color:#8a6917}.farm-target-btn{border:1px solid #d9cdec;background:#f6f2ff;color:var(--accent);font:inherit;font-size:9px;font-weight:850;border-radius:9px;min-height:34px;padding:0 9px;cursor:pointer}.farm-empty{font-size:9px;line-height:1.5;color:var(--muted);background:#faf8fc;border-radius:10px;padding:10px}.farm-foot{font-size:8px;line-height:1.45;color:var(--muted);margin-top:8px}
    @media(max-width:760px){.farm-card{grid-template-columns:22px 42px 1fr}.farm-thumb{width:42px;height:42px}.farm-target-btn{grid-column:2/-1;width:100%;min-height:38px}.farm-auto-head{display:block}.farm-auto-head i{display:block;margin-top:4px}}
  `;
  document.head.appendChild(style);
  scheduleRefresh();
})();
