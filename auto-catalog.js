/* Ryn Wardrobe Lab · auto-synced multi-source catalog.
 * Exact English name match: wiki.gg / Official Global.
 * BWIKI-only rows stay provisional and may only fill stats when Set + Slot + Rarity identify one unique piece.
 */
(() => {
  const MASTER_URL = 'data/master-catalog.json?v=auto';
  let masterPromise = null;
  let activeRecord = null;
  let provisionalRecord = null;

  const norm = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  const key = (name,type,rarity) => `${norm(name)}|${norm(type)}|${Number(rarity || 0)}`;
  const nice = n => Number.isInteger(Number(n || 0)) ? String(Number(n || 0)) : Number(n || 0).toFixed(1);

  async function loadMaster() {
    if (!masterPromise) {
      masterPromise = fetch(MASTER_URL,{cache:'no-store'}).then(async res => {
        if (!res.ok) throw new Error(`master catalog ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data.records) || !Array.isArray(data.provisional)) throw new Error('master catalog invalid');
        return data;
      });
    }
    return masterPromise;
  }

  function ensureUi() {
    const tools = document.getElementById('wikiTools');
    if (!tools) return null;
    let box = document.getElementById('autoCatalogCard');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'autoCatalogCard';
    box.className = 'auto-catalog-card';
    box.hidden = true;
    const global = document.getElementById('globalCatalogCard');
    (global || tools).insertAdjacentElement('afterend',box);
    return box;
  }

  function installStyles() {
    if (document.getElementById('autoCatalogStyles')) return;
    const style = document.createElement('style');
    style.id = 'autoCatalogStyles';
    style.textContent = `
      .auto-catalog-card{grid-column:1/-1;margin:-2px 0 4px;padding:12px 13px;border:1px solid #d9e2f2;border-radius:15px;background:#f6f9ff}.auto-catalog-card[hidden]{display:none}.auto-catalog-top{display:flex;justify-content:space-between;gap:10px;align-items:start}.auto-catalog-card strong{font-size:12px}.auto-catalog-meta{font-size:9px;color:var(--muted);line-height:1.5;margin-top:4px}.auto-catalog-badge{display:inline-flex;border-radius:999px;padding:4px 7px;font-size:8px;font-weight:850;background:#e5efff;color:#35649a;white-space:nowrap}.auto-catalog-badge.provisional{background:#fff2d5;color:#83641a}.auto-catalog-stats{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.auto-catalog-stat{background:#fff;border:1px solid #dce5f3;border-radius:999px;padding:5px 7px;font-size:9px}.auto-catalog-note{font-size:9px;line-height:1.45;color:#6f7887;margin-top:8px}.auto-catalog-actions{display:flex;gap:8px;margin-top:8px}.auto-catalog-actions button{border:1px solid #d7dfef;background:#fff;color:var(--accent);font:inherit;font-size:9px;font-weight:850;border-radius:9px;min-height:34px;padding:0 10px}.catalog-freshness{display:block;font-size:8px;color:var(--muted);margin-top:5px}
    `;
    document.head.appendChild(style);
  }

  function recordStats(record) {
    return Object.entries(record?.stats || {}).filter(([,v]) => v && (v.rating || v.score));
  }

  function render(record,{provisional=false,message=''}={}) {
    const box = ensureUi();
    if (!box) return;
    if (!record) { box.hidden = true; box.innerHTML = ''; return; }
    const pills = recordStats(record).map(([style,stat]) => `<span class="auto-catalog-stat"><b>${style}</b> ${stat.rating || ''}${stat.score ? ` · ${nice(stat.score)}` : ''}</span>`).join('');
    const sourceRefs = (record.sourceRefs || []).join(' + ') || (provisional ? 'BWIKI' : 'Auto Catalog');
    const title = provisional ? (record.cnName || record.name || 'BWIKI item') : record.name;
    const set = record.set || record.setCn || '';
    box.hidden = false;
    box.innerHTML = `<div class="auto-catalog-top"><div><strong>${esc(title)}</strong><div class="auto-catalog-meta">${esc(record.type || '')} · ${record.rarity || '?'}★${set ? ` · ${esc(set)}` : ''}<br>${esc(record.source || sourceRefs)}</div></div><span class="auto-catalog-badge ${provisional ? 'provisional' : ''}">${provisional ? 'PROVISIONAL BWIKI' : 'AUTO SYNC'}</span></div>${pills ? `<div class="auto-catalog-stats">${pills}</div>` : ''}<div class="auto-catalog-note">${esc(message || (provisional ? 'Tên item Global chưa có nguồn English đáng tin cậy. App chỉ dùng record này khi Set + Slot + Rarity match duy nhất; tên bạn nhập được giữ nguyên.' : `Record tự đồng bộ từ ${sourceRefs}.`))}</div>${provisional ? `<div class="auto-catalog-actions"><button type="button" id="applyProvisionalCatalogBtn">Dùng stat này</button></div>` : ''}`;
    if (provisional) box.querySelector('#applyProvisionalCatalogBtn')?.addEventListener('click',()=>applyProvisional(record));
  }

  function setField(id,value) {
    const el = document.getElementById(id);
    if (el && value !== undefined && value !== null && value !== '') el.value = value;
  }

  function applyScores(record,label) {
    if (typeof STYLES === 'undefined') return;
    STYLES.forEach(style => {
      const input = document.getElementById(`score-${style}`);
      if (!input) return;
      const score = Number(record?.scores?.[style] || record?.stats?.[style]?.score || 0);
      input.value = score || 0;
      const box = input.closest('.score-input');
      if (!box) return;
      const rating = record?.stats?.[style]?.rating;
      if (rating) box.dataset.wikiRating = `${rating} · ${label}`;
      else delete box.dataset.wikiRating;
    });
  }

  function statusGood(text) {
    const status = document.getElementById('wikiStatus');
    if (!status) return;
    status.className = 'wiki-status good';
    status.textContent = text;
  }

  function applyExact(record) {
    if (!record) return;
    activeRecord = record; provisionalRecord = null;
    setField('itemName',record.name);
    setField('itemType',record.type);
    setField('itemRarity',String(record.rarity));
    setField('itemSet',record.set || '');
    setField('itemSource',record.source || '');
    setField('itemImage',record.image || '');
    applyScores(record,(record.sourceRefs || []).includes('wiki.gg') ? 'Wiki sync' : 'Official sync');
    render(record,{message:`Đã match master catalog · confidence: ${record.confidence || 'verified'}.`});
    document.getElementById('wikiResults')?.classList.remove('show');
    statusGood('Đã match Auto Catalog · dữ liệu được đồng bộ định kỳ.');
    document.getElementById('itemName')?.dispatchEvent(new Event('change',{bubbles:true}));
  }

  function applyProvisional(record) {
    if (!record) return;
    provisionalRecord = record; activeRecord = null;
    setField('itemType',record.type);
    setField('itemRarity',String(record.rarity));
    if (!document.getElementById('itemSet')?.value.trim()) setField('itemSet',record.set || record.setCn || '');
    if (!document.getElementById('itemSource')?.value.trim()) setField('itemSource',record.source || 'BWIKI provisional');
    applyScores(record,'BWIKI provisional');
    render(record,{provisional:true,message:'Đã dùng stat BWIKI theo match duy nhất Set + Slot + Rarity. Tên Global bạn nhập vẫn được giữ nguyên.'});
    statusGood('Đã match provisional theo Set + Slot + Rarity · chưa claim đây là English Wiki record.');
  }

  function exactByName(master,name) {
    const n = norm(name);
    if (!n) return null;
    const matches = master.records.filter(r => norm(r.name) === n || (r.aliases || []).some(a=>norm(a)===n));
    if (matches.length === 1) return matches[0];
    const type = document.getElementById('itemType')?.value || '';
    const rarity = Number(document.getElementById('itemRarity')?.value || 0);
    return matches.find(r => (!type || r.type === type) && (!rarity || Number(r.rarity) === rarity)) || null;
  }

  function provisionalByFields(master) {
    const set = norm(document.getElementById('itemSet')?.value);
    const type = document.getElementById('itemType')?.value || '';
    const rarity = Number(document.getElementById('itemRarity')?.value || 0);
    if (!set || !type || !rarity) return null;
    const matches = master.provisional.filter(r => (norm(r.set)===set || norm(r.setCn)===set) && r.type===type && Number(r.rarity)===rarity);
    return matches.length === 1 ? matches[0] : null;
  }

  async function resolveExact({stopEvent=null}={}) {
    const name = document.getElementById('itemName')?.value || '';
    if (name.trim().length < 2) return null;
    try {
      const master = await loadMaster();
      const record = exactByName(master,name);
      if (!record) return null;
      stopEvent?.stopImmediatePropagation?.();
      applyExact(record);
      return record;
    } catch (_) { return null; }
  }

  async function resolveProvisional() {
    try {
      const master = await loadMaster();
      const name = document.getElementById('itemName')?.value || '';
      if (exactByName(master,name)) return;
      const record = provisionalByFields(master);
      if (record) {
        provisionalRecord = record;
        render(record,{provisional:true});
      } else if (!activeRecord) {
        provisionalRecord = null;
        render(null);
      }
    } catch (_) {}
  }

  function attachMetadataAfterSave() {
    const record = activeRecord || provisionalRecord;
    if (!record || typeof items === 'undefined') return;
    const expectedName = document.getElementById('itemName')?.value || record.name || '';
    const expected = key(expectedName,document.getElementById('itemType')?.value || record.type,Number(document.getElementById('itemRarity')?.value || record.rarity));
    setTimeout(()=>{
      const item = items.find(x=>key(x.name,x.type,x.rarity)===expected);
      if (!item) return;
      item.masterCatalog = {
        confidence:record.confidence || (record.cnName ? 'provisional-cn' : 'verified'),sourceRefs:record.sourceRefs || [],url:record.url || '',setUrl:record.setUrl || '',cnName:record.cnName || '',setCn:record.setCn || '',updatedAt:new Date().toISOString()
      };
      if (record.url && !item.wiki) {
        item.wiki = {
          title:item.name,page:item.name,url:record.url,type:item.type,rarity:item.rarity,set:item.set || '',source:item.source || '',tags:record.tags || [],thumbnail:item.image || '',stats:record.stats || {},scores:record.scores || {},fetchedAt:new Date().toISOString(),sourceKind:record.cnName ? 'bwiki-provisional' : 'auto-master'
        };
      }
      if (typeof saveItems === 'function') saveItems();
    },0);
  }

  async function showFreshness() {
    try {
      const master = await loadMaster();
      const tools = document.getElementById('wikiTools');
      if (!tools || document.getElementById('catalogFreshness')) return;
      const el = document.createElement('small');
      el.id = 'catalogFreshness'; el.className = 'catalog-freshness';
      const when = master.generatedAt ? new Date(master.generatedAt).toLocaleString('vi-VN') : 'unknown';
      el.textContent = `Auto Catalog: ${master.count || master.records.length} exact + ${master.provisionalCount || master.provisional.length} provisional · sync ${when}`;
      tools.appendChild(el);
    } catch (_) {}
  }

  function install() {
    installStyles(); ensureUi(); loadMaster().catch(()=>{}); showFreshness();
    const name = document.getElementById('itemName');
    const sync = document.getElementById('wikiSyncBtn');
    name?.addEventListener('input',event=>{
      const value = event.target.value;
      if (value.trim().length < 2) { activeRecord=null; provisionalRecord=null; render(null); return; }
      resolveExact().then(found=>{ if (!found) resolveProvisional(); });
    },true);
    sync?.addEventListener('click',event=>{
      resolveExact({stopEvent:event}).then(found=>{ if (!found) resolveProvisional(); });
    },true);
    ['itemSet','itemType','itemRarity'].forEach(id=>document.getElementById(id)?.addEventListener('change',resolveProvisional));
    document.getElementById('itemForm')?.addEventListener('submit',attachMetadataAfterSave,true);
    const modal = document.getElementById('itemModal');
    if (modal) new MutationObserver(()=>{
      if (modal.hidden) { activeRecord=null; provisionalRecord=null; render(null); return; }
      resolveExact().then(found=>{ if (!found) resolveProvisional(); });
    }).observe(modal,{attributes:true,attributeFilter:['hidden']});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',install);
  else install();
})();
