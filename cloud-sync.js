/* Ryn Wardrobe Lab · Supabase cross-device sync
 * Uses key-based RPCs. Secret stays in localStorage; server stores SHA-256 hash only.
 */
(() => {
  const SUPABASE_URL = 'https://gneneenxznyetcjhbytu.supabase.co';
  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImduZW5lZW54em55ZXRjamhieXR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MTgyODQsImV4cCI6MjEwNDk5NDI4NH0.YuDwOQuBQ23lx2WREnDqzMvfq_agp6AxEMPqKsJK5_0';
  const CLOUD_KEY = 'rynWardrobeLab.cloud.v1';
  const ITEMS_KEY = 'rynWardrobeLab.v1';
  const MODE_KEY = 'rynWardrobeLab.scoreMode';
  const POLL_MS = 20000;
  let applyingRemote = false;
  let pushTimer = null;
  let pulling = false;
  let state = loadState();

  const norm = v => String(v || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  const itemKey = x => `${norm(x?.name)}|${norm(x?.type)}|${Number(x?.rarity || 0)}`;
  const now = () => Date.now();

  function loadState() {
    try {
      const x = JSON.parse(localStorage.getItem(CLOUD_KEY) || 'null');
      return x && x.syncId && x.secret ? x : { syncId:'', secret:'', revision:0, itemClock:{}, tombstones:{}, lastSyncAt:0 };
    } catch (_) {
      return { syncId:'', secret:'', revision:0, itemClock:{}, tombstones:{}, lastSyncAt:0 };
    }
  }
  function saveState() { localStorage.setItem(CLOUD_KEY, JSON.stringify(state)); renderStatus(); }
  function getItems() {
    try { const x = JSON.parse(localStorage.getItem(ITEMS_KEY) || '[]'); return Array.isArray(x) ? x : []; } catch (_) { return []; }
  }
  function getMode() { return localStorage.getItem(MODE_KEY) === 'all' ? 'all' : 'eq'; }

  function encodeSecret(bytes) {
    let s=''; bytes.forEach(b=>s+=String.fromCharCode(b));
    return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function newSecret() { const b = new Uint8Array(32); crypto.getRandomValues(b); return encodeSecret(b); }
  function syncKey() { return state.syncId && state.secret ? `RYN1.${state.syncId}.${state.secret}` : ''; }
  function parseSyncKey(value) {
    const m = String(value || '').trim().match(/^RYN1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,})$/i);
    return m ? {syncId:m[1], secret:m[2]} : null;
  }

  async function rpc(name, body) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', apikey:ANON_KEY, Authorization:`Bearer ${ANON_KEY}` },
      body:JSON.stringify(body),
      cache:'no-store'
    });
    if (!res.ok) throw new Error(`Cloud ${res.status}`);
    return res.json();
  }

  function snapshot() {
    return {
      version:1,
      items:getItems(),
      scoreMode:getMode(),
      itemClock:state.itemClock || {},
      tombstones:state.tombstones || {},
      savedAt:new Date().toISOString()
    };
  }

  function noteLocalDiff(oldItems, newItems) {
    if (applyingRemote) return;
    const oldMap = new Map((oldItems || []).map(x=>[itemKey(x),JSON.stringify(x)]));
    const newMap = new Map((newItems || []).map(x=>[itemKey(x),JSON.stringify(x)]));
    const ts = now();
    newMap.forEach((json,k)=>{ if (oldMap.get(k) !== json) { state.itemClock[k]=ts; delete state.tombstones[k]; } });
    oldMap.forEach((_,k)=>{ if (!newMap.has(k)) { state.tombstones[k]=ts; delete state.itemClock[k]; } });
    saveState();
  }

  function mergePayload(local, remote) {
    local = local || {}; remote = remote || {};
    const lItems = Array.isArray(local.items) ? local.items : [];
    const rItems = Array.isArray(remote.items) ? remote.items : [];
    const lClock = local.itemClock || {}; const rClock = remote.itemClock || {};
    const lTomb = local.tombstones || {}; const rTomb = remote.tombstones || {};
    const keys = new Set([...lItems.map(itemKey),...rItems.map(itemKey),...Object.keys(lTomb),...Object.keys(rTomb)]);
    const lMap = new Map(lItems.map(x=>[itemKey(x),x]));
    const rMap = new Map(rItems.map(x=>[itemKey(x),x]));
    const items=[]; const itemClock={}; const tombstones={};

    keys.forEach(k=>{
      const lt=Number(lTomb[k]||0), rt=Number(rTomb[k]||0), lc=Number(lClock[k]||0), rc=Number(rClock[k]||0);
      const newestDelete=Math.max(lt,rt), newestItem=Math.max(lc,rc);
      if (newestDelete > newestItem) { tombstones[k]=newestDelete; return; }
      let chosen;
      if (lc > rc) chosen=lMap.get(k);
      else if (rc > lc) chosen=rMap.get(k);
      else chosen=rMap.get(k) || lMap.get(k);
      if (chosen) { items.push(chosen); itemClock[k]=Math.max(lc,rc,1); }
    });

    return {
      version:1,
      items,
      scoreMode: remote.scoreMode || local.scoreMode || 'eq',
      itemClock,
      tombstones,
      savedAt:new Date().toISOString()
    };
  }

  function applyPayload(payload) {
    if (!payload) return;
    applyingRemote = true;
    try {
      localStorage.setItem(ITEMS_KEY, JSON.stringify(Array.isArray(payload.items) ? payload.items : []));
      if (payload.scoreMode) localStorage.setItem(MODE_KEY, payload.scoreMode === 'all' ? 'all' : 'eq');
      state.itemClock = payload.itemClock || {};
      state.tombstones = payload.tombstones || {};
      if (typeof window.loadItems === 'function') window.items = window.loadItems();
      else if (typeof items !== 'undefined') items = getItems();
      if (typeof renderAll === 'function') renderAll();
    } finally { applyingRemote = false; }
  }

  async function createCloud() {
    setCloudStatus('syncing','Đang tạo Cloud…');
    const secret = newSecret();
    const existing = getItems();
    const ts=now();
    const itemClock={}; existing.forEach(x=>itemClock[itemKey(x)]=ts);
    state = {syncId:'',secret,revision:0,itemClock,tombstones:{},lastSyncAt:0};
    const out = await rpc('ryn_sync_create',{p_secret:secret,p_payload:snapshot()});
    if (!out?.ok) throw new Error(out?.error || 'create failed');
    state.syncId=out.sync_id; state.revision=Number(out.revision||1); state.lastSyncAt=now(); saveState();
    await copyKey();
    setCloudStatus('ok','Cloud ✓');
    renderPanel();
  }

  async function joinCloud(keyText) {
    const parsed=parseSyncKey(keyText);
    if (!parsed) throw new Error('Sync Key không hợp lệ');
    setCloudStatus('syncing','Đang kết nối…');
    const out=await rpc('ryn_sync_pull',{p_sync_id:parsed.syncId,p_secret:parsed.secret});
    if (!out?.ok) throw new Error('Sync Key không đúng hoặc đã hết hiệu lực');
    const localPayload=snapshot();
    state.syncId=parsed.syncId; state.secret=parsed.secret; state.revision=Number(out.revision||1);
    const merged=mergePayload(localPayload,out.payload||{});
    state.itemClock=merged.itemClock; state.tombstones=merged.tombstones; saveState();
    applyPayload(merged);
    const pushed=await rpc('ryn_sync_push',{p_sync_id:state.syncId,p_secret:state.secret,p_payload:merged,p_expected_revision:state.revision});
    if (pushed?.ok) state.revision=Number(pushed.revision); else if (pushed?.error==='conflict') state.revision=Number(pushed.revision||state.revision);
    state.lastSyncAt=now(); saveState(); setCloudStatus('ok','Cloud ✓'); renderPanel();
  }

  async function pullCloud({silent=false}={}) {
    if (!state.syncId || !state.secret || pulling || !navigator.onLine) return;
    pulling=true; if(!silent) setCloudStatus('syncing','Đang sync…');
    try {
      const out=await rpc('ryn_sync_pull',{p_sync_id:state.syncId,p_secret:state.secret});
      if (!out?.ok) throw new Error('invalid key');
      const remoteRev=Number(out.revision||0);
      if (remoteRev > Number(state.revision||0)) {
        const merged=mergePayload(snapshot(),out.payload||{});
        state.revision=remoteRev; state.itemClock=merged.itemClock; state.tombstones=merged.tombstones;
        applyPayload(merged);
      }
      state.lastSyncAt=now(); saveState(); setCloudStatus('ok','Cloud ✓');
    } catch (e) { setCloudStatus('error','Cloud lỗi'); }
    finally { pulling=false; }
  }

  async function pushCloud() {
    if (!state.syncId || !state.secret || applyingRemote || !navigator.onLine) { renderStatus(); return; }
    setCloudStatus('syncing','Đang sync…');
    try {
      let payload=snapshot();
      let out=await rpc('ryn_sync_push',{p_sync_id:state.syncId,p_secret:state.secret,p_payload:payload,p_expected_revision:Number(state.revision||1)});
      if (out?.error==='conflict') {
        const remote=await rpc('ryn_sync_pull',{p_sync_id:state.syncId,p_secret:state.secret});
        if (!remote?.ok) throw new Error('pull conflict failed');
        payload=mergePayload(payload,remote.payload||{});
        state.revision=Number(remote.revision||state.revision); state.itemClock=payload.itemClock; state.tombstones=payload.tombstones;
        applyPayload(payload);
        out=await rpc('ryn_sync_push',{p_sync_id:state.syncId,p_secret:state.secret,p_payload:payload,p_expected_revision:state.revision});
      }
      if (!out?.ok) throw new Error(out?.error||'push failed');
      state.revision=Number(out.revision||state.revision); state.lastSyncAt=now(); saveState(); setCloudStatus('ok','Cloud ✓');
    } catch (e) { setCloudStatus('error',navigator.onLine?'Cloud lỗi':'Offline'); }
  }

  function schedulePush() { clearTimeout(pushTimer); pushTimer=setTimeout(pushCloud,900); }
  async function copyKey() {
    const key=syncKey(); if(!key) return;
    try { await navigator.clipboard.writeText(key); toastCloud('Đã copy Sync Key'); }
    catch (_) { prompt('Copy Sync Key này:',key); }
  }
  function disconnect() {
    if (!confirm('Ngắt Cloud trên thiết bị này? Dữ liệu local vẫn được giữ.')) return;
    localStorage.removeItem(CLOUD_KEY); state=loadState(); renderPanel(); renderStatus();
  }
  function toastCloud(msg){ if(typeof showToast==='function') showToast(msg); }

  function ensureStatus() {
    let el=document.getElementById('cloudStatusPill');
    if(el) return el;
    const top=document.querySelector('.topbar'); if(!top) return null;
    el=document.createElement('button'); el.id='cloudStatusPill'; el.type='button'; el.className='cloud-pill';
    el.addEventListener('click',()=>{ if(typeof goTo==='function') goTo('data'); document.getElementById('cloudSyncPanel')?.scrollIntoView({behavior:'smooth',block:'center'}); });
    top.insertBefore(el,top.lastElementChild); return el;
  }
  function setCloudStatus(kind,text){ const el=ensureStatus(); if(!el)return; el.dataset.kind=kind; el.textContent=text; }
  function renderStatus(){
    if(!navigator.onLine) return setCloudStatus('offline','Offline');
    if(!state.syncId) return setCloudStatus('off','Cloud off');
    setCloudStatus('ok','Cloud ✓');
  }

  function ensurePanel() {
    let panel=document.getElementById('cloudSyncPanel'); if(panel) return panel;
    const grid=document.querySelector('#view-data .data-grid'); if(!grid) return null;
    panel=document.createElement('article'); panel.className='panel'; panel.id='cloudSyncPanel'; grid.prepend(panel); return panel;
  }
  function renderPanel(){
    const panel=ensurePanel(); if(!panel)return;
    if(state.syncId){
      const time=state.lastSyncAt?new Date(state.lastSyncAt).toLocaleString('vi-VN'):'chưa sync';
      panel.innerHTML=`<p class="eyebrow">CLOUD SYNC</p><h3>Đã kết nối đa thiết bị</h3><p class="muted">Mobile và PC dùng cùng Sync Key sẽ tự đồng bộ. Lần cuối: ${time}.</p><div class="button-row"><button class="secondary-btn" id="cloudCopyBtn">Copy Sync Key</button><button class="secondary-btn" id="cloudNowBtn">Sync ngay</button><button class="danger-btn" id="cloudDisconnectBtn">Ngắt thiết bị</button></div><p class="muted" style="margin-top:10px;font-size:12px">Giữ Sync Key riêng tư. Ai có key này có thể đọc/ghi wardrobe của bạn.</p>`;
      panel.querySelector('#cloudCopyBtn')?.addEventListener('click',copyKey);
      panel.querySelector('#cloudNowBtn')?.addEventListener('click',async()=>{await pullCloud(); await pushCloud();});
      panel.querySelector('#cloudDisconnectBtn')?.addEventListener('click',disconnect);
    }else{
      panel.innerHTML=`<p class="eyebrow">CLOUD SYNC</p><h3>Đồng bộ mobile ↔ PC</h3><p class="muted">Tạo Cloud trên thiết bị đang có dữ liệu, rồi copy Sync Key sang thiết bị còn lại.</p><div class="button-row"><button class="primary-btn" id="cloudCreateBtn">Tạo Cloud từ dữ liệu này</button></div><div style="margin-top:12px"><label style="display:block;font-weight:700;font-size:13px">Hoặc nhập Sync Key từ thiết bị khác<input id="cloudJoinInput" type="text" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="RYN1.…" style="margin-top:6px;width:100%"></label><div class="button-row" style="margin-top:8px"><button class="secondary-btn" id="cloudJoinBtn">Kết nối thiết bị này</button></div></div>`;
      panel.querySelector('#cloudCreateBtn')?.addEventListener('click',()=>createCloud().catch(e=>{setCloudStatus('error','Cloud lỗi'); alert(e.message);}));
      panel.querySelector('#cloudJoinBtn')?.addEventListener('click',()=>joinCloud(panel.querySelector('#cloudJoinInput')?.value).catch(e=>{setCloudStatus('error','Cloud lỗi'); alert(e.message);}));
    }
  }

  function installStyles(){
    if(document.getElementById('cloudSyncStyles')) return;
    const s=document.createElement('style'); s.id='cloudSyncStyles'; s.textContent=`.cloud-pill{margin-left:auto;margin-right:8px;border:1px solid #e5ddf4;background:#fff;border-radius:999px;padding:8px 11px;font:inherit;font-size:12px;font-weight:800;color:#6f6680;white-space:nowrap}.cloud-pill[data-kind="ok"]{color:#32734b;background:#f0faf3;border-color:#d3ead9}.cloud-pill[data-kind="syncing"]{color:#6f55c9;background:#f5f1ff;border-color:#ddd2ff}.cloud-pill[data-kind="error"]{color:#b24b55;background:#fff3f4;border-color:#f0d0d4}.cloud-pill[data-kind="offline"]{color:#766f65;background:#f7f5f1}@media(max-width:720px){.cloud-pill{font-size:10px;padding:7px 9px;margin-right:4px}.topbar .primary-btn{margin-left:0}}`;
    document.head.appendChild(s);
  }

  function hookStorage(){
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k,v){
      let oldItems=null;
      if(this===localStorage && k===ITEMS_KEY && !applyingRemote){ try{oldItems=JSON.parse(this.getItem(k)||'[]')}catch(_){oldItems=[]} }
      const out=original.apply(this,arguments);
      if(this===localStorage && !applyingRemote && (k===ITEMS_KEY || k===MODE_KEY)) {
        if(k===ITEMS_KEY){ let next=[]; try{next=JSON.parse(v||'[]')}catch(_){} noteLocalDiff(oldItems,next); }
        schedulePush();
      }
      return out;
    };
  }

  function install(){
    installStyles(); ensureStatus(); ensurePanel(); renderPanel(); renderStatus(); hookStorage();
    window.addEventListener('online',()=>{renderStatus(); pullCloud({silent:true}).then(pushCloud)});
    window.addEventListener('offline',renderStatus);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden) pullCloud({silent:true});});
    if(state.syncId) pullCloud({silent:true});
    setInterval(()=>pullCloud({silent:true}),POLL_MS);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install); else install();
})();