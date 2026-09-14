const STYLES = ["Cool","Elegant","Fresh","Gorgeous","Lively","Pure","Sexy","Simple","Sweet","Warm"];
const TYPES = [
  "Hairstyle","Dress","Coat","Top","Bottom","Socks","Shoes","Hat","Hair Accessory","Face Accessory",
  "Earrings","Necklace","Bracelet","Gloves","Ring","Handheld","Wings","Tail","Bag","Anklet",
  "Crossbody","Floating","Tattoo","Motor"
];
const STORAGE_KEY = "rynWardrobeLab.v1";
const STYLE_ACCENTS = {
  Cool:"#6787d8", Elegant:"#9a6fc2", Fresh:"#65a995", Gorgeous:"#d09b50", Lively:"#e57c79",
  Pure:"#70a7cf", Sexy:"#c75f86", Simple:"#7c8d9e", Sweet:"#d983ad", Warm:"#d58c61"
};

let items = loadItems();
let currentView = "dashboard";
let activeOptimizerStyle = "Cool";
let activeTargetStyle = "Cool";

const $ = (id) => document.getElementById(id);
const qsa = (sel) => [...document.querySelectorAll(sel)];
const fmt = (num) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(num || 0));
const esc = (value = "") => String(value).replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[ch]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}-${Math.random().toString(16).slice(2)}`);

function loadItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeItem) : [];
  } catch (err) {
    console.warn("Cannot load wardrobe data", err);
    return [];
  }
}

function normalizeItem(item) {
  const scores = {};
  STYLES.forEach(style => scores[style] = Math.max(0, Number(item?.scores?.[style] || 0)));
  return {
    id: item.id || uid(), name: String(item.name || "Untitled"), set: String(item.set || ""),
    type: TYPES.includes(item.type) ? item.type : "Hairstyle", rarity: [3,4,5,6].includes(Number(item.rarity)) ? Number(item.rarity) : 3,
    status: item.status === "target" ? "target" : "owned", source: String(item.source || ""), image: String(item.image || ""),
    note: String(item.note || ""), scores
  };
}

function saveItems() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  renderAll();
}

function getScore(item, style) { return Number(item?.scores?.[style] || 0); }
function ownedItems(source = items) { return source.filter(i => i.status === "owned"); }
function targetItems(source = items) { return source.filter(i => i.status === "target"); }

function bestOutfit(style, source = items) {
  const owned = ownedItems(source);
  const bestByType = new Map();
  owned.forEach(item => {
    const score = getScore(item, style);
    const current = bestByType.get(item.type);
    if (!current || score > getScore(current, style) || (score === getScore(current, style) && item.rarity > current.rarity)) {
      bestByType.set(item.type, item);
    }
  });

  const selected = [];
  TYPES.filter(t => !["Dress","Top","Bottom"].includes(t)).forEach(type => {
    const item = bestByType.get(type);
    if (item && getScore(item, style) > 0) selected.push(item);
  });

  const dress = bestByType.get("Dress");
  const top = bestByType.get("Top");
  const bottom = bestByType.get("Bottom");
  const dressScore = getScore(dress, style);
  const separatesScore = getScore(top, style) + getScore(bottom, style);
  let coreMode = "none";
  if (dressScore > 0 || separatesScore > 0) {
    if (dressScore >= separatesScore) {
      if (dress && dressScore > 0) selected.push(dress);
      coreMode = "dress";
    } else {
      if (top && getScore(top, style) > 0) selected.push(top);
      if (bottom && getScore(bottom, style) > 0) selected.push(bottom);
      coreMode = "separates";
    }
  }

  selected.sort((a,b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type));
  const total = selected.reduce((sum, item) => sum + getScore(item, style), 0);
  const rarity = {6:0,5:0,4:0,3:0};
  selected.forEach(item => rarity[item.rarity] = (rarity[item.rarity] || 0) + 1);
  return { style, selected, total, rarity, coreMode };
}

function simulateCandidate(candidate, style) {
  const base = bestOutfit(style);
  const simulatedItems = items.map(i => i.id === candidate.id ? {...i, status:"owned"} : i);
  const after = bestOutfit(style, simulatedItems);
  const beforeIds = new Set(base.selected.map(i => i.id));
  const afterIds = new Set(after.selected.map(i => i.id));
  const added = after.selected.filter(i => !beforeIds.has(i.id));
  const removed = base.selected.filter(i => !afterIds.has(i.id));
  return { candidate, base, after, gain: after.total - base.total, used: afterIds.has(candidate.id), added, removed };
}

function candidateRanking(style) {
  return targetItems().map(item => simulateCandidate(item, style)).sort((a,b) => b.gain - a.gain || b.candidate.rarity - a.candidate.rarity || getScore(b.candidate, style) - getScore(a.candidate, style));
}

function fallbackWeakSlots(style) {
  const outfit = bestOutfit(style);
  if (!outfit.selected.length) return [];
  return [...outfit.selected]
    .sort((a,b) => a.rarity - b.rarity || getScore(a,style) - getScore(b,style))
    .slice(0,5)
    .map(item => ({ item, threshold:getScore(item,style), reason:item.rarity < 6 ? `${item.rarity}★ trong best set` : "Điểm thấp trong nhóm 6★ hiện tại" }));
}

function bestStyleSummary() {
  return STYLES.map(style => bestOutfit(style)).sort((a,b) => b.total - a.total)[0] || bestOutfit("Cool");
}

function renderAll() {
  renderSidebar();
  renderDashboard();
  renderOptimizer();
  renderInventory();
  renderTargets();
}

function renderSidebar() {
  $("sidebarOwned").textContent = ownedItems().length;
  $("sidebarTargets").textContent = targetItems().length;
}

function renderDashboard() {
  const best = bestStyleSummary();
  $("heroBestScore").textContent = fmt(best.total);
  $("heroBestStyle").textContent = best.total ? `${best.style} · ${best.selected.length} món` : "Chưa có dữ liệu";

  $("styleGrid").innerHTML = STYLES.map(style => {
    const out = bestOutfit(style);
    return `<button class="style-card" data-style-card="${style}" style="--accent:${STYLE_ACCENTS[style]}">
      <div class="style-card-top"><span class="name">${style}</span><i class="style-dot"></i></div>
      <div class="score">${fmt(out.total)}</div>
      <div class="rarity-line">6★ ${out.rarity[6]} · 5★ ${out.rarity[5]} · ${out.selected.length} món</div>
    </button>`;
  }).join("");
  qsa("[data-style-card]").forEach(btn => btn.addEventListener("click", () => {
    activeOptimizerStyle = btn.dataset.styleCard;
    $("optimizerStyle").value = activeOptimizerStyle;
    goTo("optimizer");
    renderOptimizer();
  }));

  const allUpgrades = STYLES.flatMap(style => candidateRanking(style).filter(x => x.gain > 0).slice(0,1).map(x => ({...x, style})))
    .sort((a,b) => b.gain - a.gain).slice(0,3);
  if (allUpgrades.length) {
    $("upgradePreview").innerHTML = allUpgrades.map((u,idx) => `<div class="upgrade-row">
      <div class="rank-badge">#${idx+1}</div><div><strong>${esc(u.candidate.name)}</strong><span>${u.style} · ${esc(u.candidate.type)} · ${u.candidate.rarity}★</span></div>
      <div class="gain">+${fmt(u.gain)}</div></div>`).join("");
  } else {
    const style = best.total ? best.style : "Cool";
    const weak = fallbackWeakSlots(style).slice(0,3);
    $("upgradePreview").innerHTML = weak.length ? weak.map((w,idx) => `<div class="upgrade-row">
      <div class="rank-badge">#${idx+1}</div><div><strong>${esc(w.item.type)} · cần vượt ${fmt(w.threshold)}</strong><span>${style} · hiện tại ${esc(w.item.name)} (${w.item.rarity}★)</span></div>
      <div class="gain">Săn</div></div>`).join("") : `<div class="empty-state">Thêm item để bắt đầu phân tích.</div>`;
  }

  const counts = {6:0,5:0,4:0,3:0};
  ownedItems().forEach(i => counts[i.rarity]++);
  const max = Math.max(1, ...Object.values(counts));
  $("raritySummary").innerHTML = [6,5,4,3].map(r => `<div class="rarity-bar-row"><strong>${r}★</strong><div class="bar"><i style="width:${(counts[r]/max)*100}%"></i></div><span>${counts[r]}</span></div>`).join("");
}

function renderOptimizer() {
  if (!$("optimizerStyle").options.length) $("optimizerStyle").innerHTML = STYLES.map(s => `<option>${s}</option>`).join("");
  $("optimizerStyle").value = activeOptimizerStyle;
  const out = bestOutfit(activeOptimizerStyle);
  $("outfitTitle").textContent = `${activeOptimizerStyle} best set`;
  $("optimizerSummary").innerHTML = [
    ["Tổng điểm",fmt(out.total)], ["Số món",out.selected.length], ["6★ / 5★",`${out.rarity[6]} / ${out.rarity[5]}`], ["Body",out.coreMode === "dress" ? "Dress" : out.coreMode === "separates" ? "Top + Bottom" : "—"]
  ].map(([label,val]) => `<div class="metric-card"><span>${label}</span><strong>${val}</strong></div>`).join("");

  $("outfitList").innerHTML = out.selected.length ? out.selected.map(item => `<div class="outfit-item">
    <div class="item-thumb">${item.image ? `<img src="${esc(item.image)}" alt="">` : esc(item.type.slice(0,2).toUpperCase())}</div>
    <div><strong>${esc(item.name)}</strong><span>${esc(item.type)} · ${item.rarity}★${item.set ? ` · ${esc(item.set)}` : ""}</span></div>
    <div class="item-score">${fmt(getScore(item,activeOptimizerStyle))}</div></div>`).join("") : `<div class="empty-state">Chưa có món sở hữu nào có điểm ${activeOptimizerStyle}.</div>`;

  const ranking = candidateRanking(activeOptimizerStyle).filter(x => x.gain > 0);
  const weak = fallbackWeakSlots(activeOptimizerStyle);
  let html = "";
  if (ranking.length) {
    const top = ranking[0];
    html += `<div class="insight-card good"><strong>Candidate tốt nhất: ${esc(top.candidate.name)}</strong><p>+${fmt(top.gain)} điểm. ${replacementText(top)}</p></div>`;
  }
  weak.slice(0,4).forEach(w => {
    html += `<div class="insight-card warn"><strong>${esc(w.item.type)} · ${w.item.rarity}★</strong><p>${esc(w.item.name)} đang đóng góp ${fmt(w.threshold)} điểm. Tìm món ${activeOptimizerStyle} vượt mức này để mở cơ hội tăng tổng điểm.</p></div>`;
  });
  $("optimizerInsights").innerHTML = html || `<div class="empty-state">Chưa đủ dữ liệu để phân tích khoảng trống.</div>`;
}

function replacementText(sim) {
  const removed = sim.removed.map(i => i.name);
  if (!sim.used || sim.gain <= 0) return "Không làm tăng best set hiện tại.";
  if (!removed.length) return `Bổ sung vào best set ${sim.after.style}.`;
  return `Thay ${removed.map(esc).join(" + ")}.`;
}

function filteredInventory() {
  const query = $("inventorySearch")?.value?.trim().toLowerCase() || "";
  const status = $("inventoryStatusFilter")?.value || "all";
  const rarity = $("inventoryRarityFilter")?.value || "all";
  return items.filter(item => {
    const qmatch = !query || `${item.name} ${item.set} ${item.type} ${item.source}`.toLowerCase().includes(query);
    return qmatch && (status === "all" || item.status === status) && (rarity === "all" || String(item.rarity) === rarity);
  }).sort((a,b) => Number(b.status === "owned") - Number(a.status === "owned") || b.rarity-a.rarity || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

function strongestScore(item) {
  return STYLES.map(style => ({style,score:getScore(item,style)})).sort((a,b) => b.score-a.score)[0];
}

function renderInventory() {
  const data = filteredInventory();
  $("inventoryMeta").textContent = `${data.length} / ${items.length} món · ${ownedItems().length} sở hữu · ${targetItems().length} mục tiêu`;
  const rows = data.map(item => {
    const best = strongestScore(item);
    return `<tr><td><div class="item-cell"><div class="item-thumb">${item.image ? `<img src="${esc(item.image)}" alt="">` : esc(item.type.slice(0,2).toUpperCase())}</div><div><strong>${esc(item.name)}</strong><span>${esc(item.set || "Không thuộc set")}</span></div></div></td>
      <td>${esc(item.type)}</td><td><span class="star">${item.rarity}★</span></td><td><span class="status ${item.status}">${item.status === "owned" ? "Sở hữu" : "Mục tiêu"}</span></td>
      <td>${best.score ? `${best.style} · ${fmt(best.score)}` : "—"}</td><td><div class="row-actions"><button class="tiny-btn" data-edit="${item.id}">Sửa</button></div></td></tr>`;
  }).join("");
  $("inventoryBody").innerHTML = rows || `<tr><td colspan="6"><div class="empty-state">Không có item phù hợp bộ lọc.</div></td></tr>`;
  $("inventoryCards").innerHTML = data.map(item => {
    const best = strongestScore(item);
    return `<div class="inventory-card"><div class="inventory-card-top"><div><strong>${esc(item.name)}</strong><p>${esc(item.type)} · ${esc(item.set || "Không thuộc set")}</p></div><span class="star">${item.rarity}★</span></div><div class="inventory-card-bottom"><span class="status ${item.status}">${item.status === "owned" ? "Sở hữu" : "Mục tiêu"}</span><span>${best.score ? `${best.style} ${fmt(best.score)}` : "—"}</span><button class="tiny-btn" data-edit="${item.id}">Sửa</button></div></div>`;
  }).join("");
  qsa("[data-edit]").forEach(btn => btn.addEventListener("click", () => openItemModal(btn.dataset.edit)));
}

function renderTargets() {
  if (!$("targetStyle").options.length) $("targetStyle").innerHTML = STYLES.map(s => `<option>${s}</option>`).join("");
  $("targetStyle").value = activeTargetStyle;
  const ranking = candidateRanking(activeTargetStyle);
  const positive = ranking.filter(x => x.gain > 0);
  if (positive.length) {
    const top = positive[0];
    $("targetHero").innerHTML = `<div class="target-hero"><div><span class="kicker">ƯU TIÊN #1 · ${activeTargetStyle.toUpperCase()}</span><h3>${esc(top.candidate.name)}</h3><p>${esc(top.candidate.type)} · ${top.candidate.rarity}★${top.candidate.set ? ` · ${esc(top.candidate.set)}` : ""} · ${replacementText(top)}</p></div><div class="target-gain"><strong>+${fmt(top.gain)}</strong><span>${fmt(top.base.total)} → ${fmt(top.after.total)}</span></div></div>`;
    $("targetList").innerHTML = positive.map((sim,idx) => `<div class="target-row"><div class="rank">#${idx+1}</div><div><strong>${esc(sim.candidate.name)}</strong><span>${esc(sim.candidate.type)} · ${sim.candidate.rarity}★ · điểm ${activeTargetStyle}: ${fmt(getScore(sim.candidate,activeTargetStyle))} · ${replacementText(sim)}</span></div><div class="gain">+${fmt(sim.gain)}</div></div>`).join("");
  } else {
    $("targetHero").innerHTML = `<div class="target-hero"><div><span class="kicker">CHƯA CÓ CANDIDATE TĂNG ĐIỂM</span><h3>${activeTargetStyle}: cần thêm mục tiêu</h3><p>Thêm các món bạn đang cân nhắc săn với trạng thái “Mục tiêu / chưa có”. App sẽ tự giả lập và xếp hạng.</p></div></div>`;
    $("targetList").innerHTML = ranking.length ? ranking.slice(0,8).map((sim,idx) => `<div class="target-row"><div class="rank">#${idx+1}</div><div><strong>${esc(sim.candidate.name)}</strong><span>${esc(sim.candidate.type)} · ${sim.candidate.rarity}★ · chưa vượt best set</span></div><div class="gain">+0</div></div>`).join("") : "";
  }

  const weak = fallbackWeakSlots(activeTargetStyle);
  $("fallbackTargetPanel").innerHTML = `<div class="panel-head"><div><p class="eyebrow">NẾU CHƯA BIẾT MÓN CỤ THỂ</p><h3>Slot nên đi tìm trước</h3></div></div>${weak.length ? weak.map((w,idx) => `<div class="upgrade-row"><div class="rank-badge">#${idx+1}</div><div><strong>${esc(w.item.type)} · cần > ${fmt(w.threshold)}</strong><span>${esc(w.item.name)} · ${w.item.rarity}★ · ${esc(w.reason)}</span></div><div class="gain">${activeTargetStyle}</div></div>`).join("") : `<div class="empty-state">Chưa có best set để xác định khoảng trống.</div>`}`;
}

function goTo(view) {
  currentView = view;
  qsa(".view").forEach(v => v.classList.toggle("active", v.id === `view-${view}`));
  qsa(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  const labels = {dashboard:"Tổng quan",optimizer:"Best set",inventory:"Kho đồ",targets:"Nên săn gì?",data:"Dữ liệu"};
  $("pageTitle").textContent = labels[view] || "Ryn Wardrobe Lab";
  $("sidebar").classList.remove("open");
  window.scrollTo({top:0,behavior:"smooth"});
}

function setupModal() {
  $("itemType").innerHTML = TYPES.map(t => `<option>${t}</option>`).join("");
  $("scoreInputs").innerHTML = STYLES.map(style => `<div class="score-input"><label for="score-${style}">${style}</label><input id="score-${style}" type="number" min="0" step="1" inputmode="numeric" value="0"></div>`).join("");
}

function openItemModal(id = null) {
  const item = id ? items.find(i => i.id === id) : null;
  $("modalTitle").textContent = item ? "Sửa món đồ" : "Thêm món đồ";
  $("itemId").value = item?.id || "";
  $("itemName").value = item?.name || "";
  $("itemSet").value = item?.set || "";
  $("itemType").value = item?.type || "Hairstyle";
  $("itemRarity").value = String(item?.rarity || 6);
  $("itemStatus").value = item?.status || "owned";
  $("itemSource").value = item?.source || "";
  $("itemImage").value = item?.image || "";
  $("itemNote").value = item?.note || "";
  STYLES.forEach(style => $(`score-${style}`).value = getScore(item,style));
  $("deleteItemBtn").hidden = !item;
  $("itemModal").hidden = false;
  setTimeout(() => $("itemName").focus(), 20);
}

function closeItemModal() { $("itemModal").hidden = true; }

function handleItemSubmit(event) {
  event.preventDefault();
  const id = $("itemId").value || uid();
  const scoreMap = {};
  STYLES.forEach(style => scoreMap[style] = Math.max(0,Number($(`score-${style}`).value || 0)));
  const item = normalizeItem({
    id, name:$("itemName").value.trim(), set:$("itemSet").value.trim(), type:$("itemType").value,
    rarity:Number($("itemRarity").value), status:$("itemStatus").value, source:$("itemSource").value.trim(),
    image:$("itemImage").value.trim(), note:$("itemNote").value.trim(), scores:scoreMap
  });
  const idx = items.findIndex(i => i.id === id);
  if (idx >= 0) items[idx] = item; else items.push(item);
  saveItems(); closeItemModal(); toast(idx >= 0 ? "Đã cập nhật món đồ" : "Đã thêm món đồ");
}

function deleteCurrentItem() {
  const id = $("itemId").value;
  if (!id) return;
  const item = items.find(i => i.id === id);
  if (!confirm(`Xóa “${item?.name || "món này"}”?`)) return;
  items = items.filter(i => i.id !== id); saveItems(); closeItemModal(); toast("Đã xóa món đồ");
}

function exportJson() {
  const payload = {version:1, exportedAt:new Date().toISOString(), items};
  downloadBlob(`ryn-wardrobe-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(payload,null,2), "application/json");
}

async function importJson(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(incoming)) throw new Error("File không có mảng items");
    items = incoming.map(normalizeItem); saveItems(); toast(`Đã nhập ${items.length} món từ JSON`);
  } catch (err) { alert(`Không thể nhập JSON: ${err.message}`); }
}

function csvEscape(v) { const s=String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }
function csvHeaders() { return ["name","set","type","rarity","status","source","image","note",...STYLES.map(s => `score_${s}`)]; }
function exportCsvTemplate() {
  const headers = csvHeaders();
  const example = ["Tên món","Tên set","Hairstyle","6","owned","Lightchase","","",...STYLES.map((s,i)=> i===0?"1200":"0")];
  downloadBlob("ryn-wardrobe-template.csv", `${headers.join(",")}\n${example.map(csvEscape).join(",")}\n`, "text/csv;charset=utf-8");
}

function parseCsv(text) {
  const rows=[]; let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i],next=text[i+1];
    if(quoted){ if(ch==='"'&&next==='"'){field+='"';i++;} else if(ch==='"'){quoted=false;} else field+=ch; }
    else { if(ch==='"') quoted=true; else if(ch===','){row.push(field);field="";} else if(ch==='\n'){row.push(field.replace(/\r$/,""));rows.push(row);row=[];field="";} else field+=ch; }
  }
  if(field.length||row.length){row.push(field.replace(/\r$/,""));rows.push(row);} return rows.filter(r=>r.some(c=>c.trim()));
}

async function importCsv(file) {
  try {
    const rows=parseCsv(await file.text()); if(rows.length<2) throw new Error("CSV không có dữ liệu");
    const headers=rows[0].map(h=>h.trim()); const idx=name=>headers.indexOf(name);
    if(idx("name")<0||idx("type")<0||idx("rarity")<0) throw new Error("Thiếu cột name/type/rarity");
    let added=0,updated=0;
    rows.slice(1).forEach(cols=>{
      const name=(cols[idx("name")]||"").trim(); if(!name) return;
      const scores={}; STYLES.forEach(style=>{const p=idx(`score_${style}`);scores[style]=p>=0?Number(cols[p]||0):0;});
      const raw={name,set:idx("set")>=0?cols[idx("set")]:"",type:cols[idx("type")],rarity:Number(cols[idx("rarity")]||3),status:idx("status")>=0?cols[idx("status")]:"owned",source:idx("source")>=0?cols[idx("source")]:"",image:idx("image")>=0?cols[idx("image")]:"",note:idx("note")>=0?cols[idx("note")]:"",scores};
      const key=`${name.toLowerCase()}|${String(raw.type).toLowerCase()}|${String(raw.set).toLowerCase()}`;
      const existing=items.findIndex(i=>`${i.name.toLowerCase()}|${i.type.toLowerCase()}|${i.set.toLowerCase()}`===key);
      if(existing>=0){items[existing]=normalizeItem({...raw,id:items[existing].id});updated++;} else {items.push(normalizeItem({...raw,id:uid()}));added++;}
    });
    saveItems(); toast(`CSV: +${added} mới, ${updated} cập nhật`);
  } catch(err){alert(`Không thể nhập CSV: ${err.message}`);}
}

function downloadBlob(filename, content, type) {
  const blob=new Blob([content],{type}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
}

let toastTimer;
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2200);}

function bindEvents() {
  qsa(".nav-btn").forEach(btn => btn.addEventListener("click", () => goTo(btn.dataset.view)));
  qsa("[data-go]").forEach(btn => btn.addEventListener("click", () => goTo(btn.dataset.go)));
  $("menuBtn").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  $("quickAddBtn").addEventListener("click", () => openItemModal());
  $("closeModalBtn").addEventListener("click", closeItemModal); $("cancelModalBtn").addEventListener("click", closeItemModal);
  $("itemModal").addEventListener("click", e => { if(e.target === $("itemModal")) closeItemModal(); });
  $("itemForm").addEventListener("submit", handleItemSubmit); $("deleteItemBtn").addEventListener("click", deleteCurrentItem);
  $("optimizerStyle").addEventListener("change", e => { activeOptimizerStyle=e.target.value;renderOptimizer(); });
  $("targetStyle").addEventListener("change", e => { activeTargetStyle=e.target.value;renderTargets(); });
  ["inventorySearch","inventoryStatusFilter","inventoryRarityFilter"].forEach(id => $(id).addEventListener(id==="inventorySearch"?"input":"change",renderInventory));
  $("exportJsonBtn").addEventListener("click", exportJson); $("csvTemplateBtn").addEventListener("click", exportCsvTemplate);
  $("importJsonInput").addEventListener("change", e => { if(e.target.files[0]) importJson(e.target.files[0]); e.target.value=""; });
  $("importCsvInput").addEventListener("change", e => { if(e.target.files[0]) importCsv(e.target.files[0]); e.target.value=""; });
  $("resetBtn").addEventListener("click", () => { if(confirm("Xóa toàn bộ inventory và target đang lưu trên trình duyệt này?")){items=[];saveItems();toast("Đã xóa dữ liệu");} });
  document.addEventListener("keydown", e => { if(e.key==="Escape"&&!$("itemModal").hidden) closeItemModal(); });
}

setupModal();
bindEvents();
renderAll();
