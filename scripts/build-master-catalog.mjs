import fs from 'node:fs/promises';

const WIKI_API = 'https://lifemakeover.wiki.gg/api.php';
const WIKI_BASE = 'https://lifemakeover.wiki.gg/wiki/';
const BWIKI_BASE = 'https://wiki.biligame.com/yslzgame';
const STEAM_URL = 'https://steamcommunity.com/app/2626940/announcements/?l=english';
const OUT = 'data/master-catalog.json';

const STYLES = ['Cool','Elegant','Fresh','Gorgeous','Lively','Pure','Sexy','Simple','Sweet','Warm'];
const RATING_BASE = { C:10, B:20, A:30, S:40, SS:50, SSS:60 };
const TYPE_CN = {
  '发型':'Hairstyle','连衣裙':'Dress','外套':'Coat','上衣':'Top','下装':'Bottom','袜子':'Socks','鞋子':'Shoes',
  '帽子':'Hat','发饰':'Hair Accessory','面饰':'Face Accessory','耳饰':'Earrings','颈饰':'Necklace','腕饰':'Bracelet',
  '手套':'Gloves','戒指':'Ring','手持物':'Handheld','翅膀':'Wings','尾巴':'Tail','背饰':'Wings','包':'Bag','脚链':'Anklet',
  '斜挎':'Crossbody','悬浮':'Floating','纹身':'Tattoo','摩托':'Motor'
};
const STYLE_CN = {
  '简约':'Simple','华丽':'Gorgeous','清纯':'Pure','性感':'Sexy','跃动':'Lively','典雅':'Elegant','甜美':'Sweet','酷帅':'Cool','清凉':'Fresh','保暖':'Warm'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const keyOf = (name,type,rarity) => `${norm(name)}|${norm(type)}|${Number(rarity || 0)}`;
const uniq = arr => [...new Set(arr.filter(Boolean))];

async function fetchRetry(url, tries = 4, accept = 'text/html,*/*') {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {headers:{'user-agent':'RynWardrobeLab/2.0 (+GitHub catalog sync)','accept':accept}});
      if (res.ok) return res;
      last = new Error(`${res.status} ${res.statusText}`);
      if (![429,500,502,503,504].includes(res.status)) throw last;
      const retry = Number(res.headers.get('retry-after') || 0);
      await sleep(Math.max(retry * 1000, 500 * attempt));
    } catch (err) {
      last = err;
      if (attempt < tries) await sleep(500 * attempt);
    }
  }
  throw last || new Error(`fetch failed: ${url}`);
}

async function wikiApi(params) {
  const qs = new URLSearchParams({format:'json',formatversion:'2',origin:'*',...params});
  const res = await fetchRetry(`${WIKI_API}?${qs}`,4,'application/json');
  return res.json();
}

function escRe(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
function param(src,name) {
  const re = new RegExp(`\\|\\s*${escRe(name)}\\s*=\\s*([\\s\\S]*?)(?=\\s*\\|\\s*[A-Za-z0-9_]+\\s*=|\\n\\s*\\}\\}|$)`,'i');
  return (String(src || '').match(re)?.[1] || '').trim();
}
function cleanWiki(value='') {
  return String(value)
    .replace(/<!--([\s\S]*?)-->/g,'')
    .replace(/<br\s*\/?>/gi,' · ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,'$2')
    .replace(/\[\[([^\]]+)\]\]/g,'$1')
    .replace(/\{\{(?:Style|Tag|Rarity)\|([^}|]+)[^}]*\}\}/gi,'$1')
    .replace(/\{\{[^}]+\}\}/g,'')
    .replace(/'''?/g,'').replace(/\s+/g,' ').trim();
}
function templateBlock(src,name) {
  const start = String(src || '').search(new RegExp(`\\{\\{\\s*${escRe(name)}`,'i'));
  if (start < 0) return '';
  const tail = src.slice(start);
  let depth = 0;
  for (let i=0; i<tail.length-1; i++) {
    const pair = tail.slice(i,i+2);
    if (pair === '{{') { depth++; i++; continue; }
    if (pair === '}}') { depth--; i++; if (depth === 0) return tail.slice(0,i+1); }
  }
  return tail;
}
function wikiScore(rating,scale) {
  const base = RATING_BASE[String(rating || '').trim().toUpperCase()] || 0;
  const s = Math.max(0,Number(scale || 0));
  return base ? Number((base + s).toFixed(1)) : 0;
}
function decodeHtml(s='') {
  return String(s)
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
}
function htmlText(html='') {
  return decodeHtml(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|section|article)>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/[\t\r ]+/g,' ')
    .replace(/\n\s+/g,'\n')
    .replace(/\n{3,}/g,'\n\n')).trim();
}
function parseWikiFashion(title,wikitext,thumbnail='') {
  if (!/\{\{\s*Fashion Infobox/i.test(wikitext)) return null;
  const info = templateBlock(wikitext,'Fashion Infobox') || wikitext;
  const statsBlock = templateBlock(wikitext,'Fashion Stats');
  const type = cleanWiki(param(info,'type'));
  const rarity = Number(cleanWiki(param(info,'rarity'))) || 0;
  if (!type || !rarity) return null;
  const set = cleanWiki(param(info,'set'));
  const source = cleanWiki(param(info,'obtain'));
  const stats = {}; const scores = Object.fromEntries(STYLES.map(s=>[s,0]));
  for (let i=1; i<=5; i++) {
    const style = cleanWiki(param(statsBlock,`style${i}`));
    const scale = Number(cleanWiki(param(statsBlock,`scale${i}`))) || 0;
    const rating = cleanWiki(param(statsBlock,`rating${i}`)).toUpperCase();
    if (!STYLES.includes(style) || !rating) continue;
    const score = wikiScore(rating,scale);
    stats[style] = {rating,scale,score};
    scores[style] = score;
  }
  const tags = [...param(info,'tag').matchAll(/\{\{\s*Tag\s*\|\s*([^}|]+)[^}]*\}\}/gi)].map(m=>m[1].trim());
  return {
    key:keyOf(title,type,rarity),name:title,type,rarity,set,source,tags,stats,scores,image:thumbnail,
    url:`${WIKI_BASE}${encodeURIComponent(title.replace(/ /g,'_'))}`,
    confidence:Object.keys(stats).length ? 'verified' : 'metadata-only',
    sourceRefs:['wiki.gg'],updatedAt:new Date().toISOString()
  };
}

async function latestWikiRecords(limit = 1200) {
  const titles = [];
  let cont = null;
  while (titles.length < limit) {
    const data = await wikiApi({action:'query',list:'categorymembers',cmtitle:'Category:Fashions',cmnamespace:'0',cmlimit:'500',cmsort:'timestamp',cmdir:'desc',...(cont?{cmcontinue:cont}:{})});
    for (const row of data?.query?.categorymembers || []) {
      if (!titles.includes(row.title)) titles.push(row.title);
      if (titles.length >= limit) break;
    }
    cont = data?.continue?.cmcontinue;
    if (!cont) break;
  }
  const records = [];
  for (let i=0; i<titles.length; i+=40) {
    const batch = titles.slice(i,i+40);
    const data = await wikiApi({action:'query',prop:'revisions|pageimages',rvprop:'content',rvslots:'main',piprop:'thumbnail',pithumbsize:'320',redirects:'1',titles:batch.join('|')});
    for (const page of data?.query?.pages || []) {
      const src = page.revisions?.[0]?.slots?.main?.content || '';
      const parsed = parseWikiFashion(page.title,src,page.thumbnail?.source || '');
      if (parsed) records.push(parsed);
    }
    await sleep(120);
  }
  return records;
}

function normalizeFarmable(entry) {
  if (!entry?.name || !entry?.type || !entry?.rarity) return null;
  const scores = Object.fromEntries(STYLES.map(s=>[s,Number(entry.scores?.[s] || 0)]));
  return {
    key:keyOf(entry.name,entry.type,entry.rarity),name:entry.name,type:entry.type,rarity:Number(entry.rarity),set:entry.set || '',
    source:entry.source || entry.route || '',tags:entry.tags || [],stats:entry.styles || entry.stats || {},scores,image:entry.image || '',url:entry.url || '',
    confidence:'verified',sourceRefs:['wiki.gg','farmable-catalog'],availability:{tier:Number(entry.sourceTier||0),label:entry.sourceLabel||''},
    updatedAt:new Date().toISOString()
  };
}

async function loadFarmable() {
  try {
    const data = JSON.parse(await fs.readFile('data/farmable-catalog.json','utf8'));
    return (data.items || []).map(normalizeFarmable).filter(Boolean);
  } catch { return []; }
}

function parseOfficialSnapshot(text) {
  const top = text.slice(0,50000);
  const sets = [];
  for (const m of top.matchAll(/([4-6])-Star Set\s*[-–:]\s*\[?([^\]\n\r]+)/gi)) {
    const name = m[2].trim().replace(/[.。]+$/,'');
    if (name && !sets.some(x=>norm(x.name)===norm(name))) sets.push({name,rarity:Number(m[1])});
  }
  const fashionCode = top.match(/New Fashion Code[\s\S]{0,900}?5-Star Set\s*\[([^\]]+)\]/i)?.[1]?.trim() || '';
  const lightchase = top.match(/Limited-Time Lightchase\s*[-–]\s*([^\n\r]+)/i)?.[1]?.trim().replace(/\[|\]/g,'') || '';
  const explicitPieces = [];
  const typePattern = 'Hairstyle|Dress|Coat|Top|Bottom|Socks|Shoes|Hat|Hair Accessory|Face Accessory|Earrings|Necklace|Bracelet|Gloves|Ring|Handheld|Wings|Tail|Bag|Anklet|Crossbody|Floating|Tattoo|Motor';
  const re = new RegExp(`([3-6])-Star(?: limited)? (${typePattern})\\s*[-–:]?\\s*\\[([^\\]]+)\\]`,'gi');
  for (const m of top.matchAll(re)) {
    const rec = {name:m[3].trim(),type:m[2],rarity:Number(m[1])};
    if (!explicitPieces.some(x=>keyOf(x.name,x.type,x.rarity)===keyOf(rec.name,rec.type,rec.rarity))) explicitPieces.push(rec);
  }
  return {lightchase,sets,fashionCode,explicitPieces};
}

async function officialGlobal() {
  try {
    const res = await fetchRetry(STEAM_URL,4);
    const html = await res.text();
    const text = htmlText(html);
    return {ok:true,url:STEAM_URL,checkedAt:new Date().toISOString(),...parseOfficialSnapshot(text)};
  } catch (error) {
    return {ok:false,url:STEAM_URL,checkedAt:new Date().toISOString(),error:String(error.message || error),sets:[],explicitPieces:[]};
  }
}

function dateValue(s='') {
  const m = String(s).match(/(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})/);
  return m ? Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])) : NaN;
}
function parseBwikiSchedule(text) {
  const rows = [];
  const re = /追光·([^\n|]+)\n([^\n|]+?)\s*(?:\||\n)\s*(20\d{2}\/\d{1,2}\/\d{1,2})[\s\S]{0,80}?(20\d{2}\/\d{1,2}\/\d{1,2})/g;
  for (const m of text.matchAll(re)) {
    const sets = m[2].trim().split(/\s+/).filter(x=>x && !/版本/.test(x));
    rows.push({event:m[1].trim(),sets,start:m[3],end:m[4]});
  }
  const now = Date.now();
  const current = rows.find(r => dateValue(r.start) <= now && now <= dateValue(r.end)+86400000) || rows[0] || null;
  return {rows:rows.slice(0,8),current};
}

async function fetchBwikiPage(title) {
  const url = `${BWIKI_BASE}/${encodeURIComponent(title)}`;
  const res = await fetchRetry(url,3);
  return {url,html:await res.text()};
}

function parseBwikiSetPage(html,setCn) {
  const text = htmlText(html);
  const lines = text.split('\n').map(x=>x.trim()).filter(Boolean);
  const rarity = Number(text.match(/([3-6])\s*星/)?.[1] || 0);
  const sourceChunk = text.match(/获取途径\s*([\s\S]{0,140}?)(?:套装集齐加成|奖励预览|所属套装|取自)/)?.[1]?.replace(/\n+/g,' · ').trim() || '';
  const pieces = [];
  for (let i=0; i<lines.length-1; i++) {
    const type = TYPE_CN[lines[i]];
    if (!type) continue;
    const name = lines[i+1];
    if (!name || TYPE_CN[name] || STYLE_CN[name] || name.length > 32) continue;
    const style = STYLE_CN[lines[i-1]] || '';
    const k = `${name}|${type}`;
    if (!pieces.some(x=>`${x.cnName}|${x.type}`===k)) pieces.push({cnName:name,type,primaryStyle:style});
  }
  return {setCn,rarity,source:sourceChunk,pieces};
}

function parseBwikiItemStats(html) {
  const text = htmlText(html);
  const stats = {}; const scores = Object.fromEntries(STYLES.map(s=>[s,0]));
  const re = /(简约|华丽|清纯|性感|跃动|典雅|甜美|酷帅|清凉|保暖)\s*(SSS|SS|S|A|B|C)\b/g;
  for (const m of text.matchAll(re)) {
    const style = STYLE_CN[m[1]];
    if (!style || stats[style]) continue;
    const rating = m[2].toUpperCase();
    stats[style] = {rating,scale:null,score:RATING_BASE[rating] || 0};
    scores[style] = RATING_BASE[rating] || 0;
    if (Object.keys(stats).length >= 5) break;
  }
  return {stats,scores};
}

async function bwikiSnapshot(official) {
  const result = {ok:false,checkedAt:new Date().toISOString(),scheduleUrl:`${BWIKI_BASE}/${encodeURIComponent('限时追光排期表')}`,current:null,provisional:[],errors:[]};
  try {
    const page = await fetchBwikiPage('限时追光排期表');
    const schedule = parseBwikiSchedule(htmlText(page.html));
    result.current = schedule.current;
    result.rows = schedule.rows;
    result.ok = true;
    if (!schedule.current?.sets?.length) return result;

    const setDetails = [];
    for (const setCn of schedule.current.sets.slice(0,4)) {
      try {
        const setPage = await fetchBwikiPage(`套装·${setCn}`);
        setDetails.push({...parseBwikiSetPage(setPage.html,setCn),url:setPage.url});
        await sleep(250);
      } catch (e) { result.errors.push(`set ${setCn}: ${e.message}`); }
    }

    const officialByRarity = new Map();
    for (const set of official.sets || []) {
      if (!officialByRarity.has(set.rarity)) officialByRarity.set(set.rarity,[]);
      officialByRarity.get(set.rarity).push(set.name);
    }
    const bwikiByRarity = new Map();
    for (const set of setDetails) {
      if (!bwikiByRarity.has(set.rarity)) bwikiByRarity.set(set.rarity,[]);
      bwikiByRarity.get(set.rarity).push(set);
    }
    const setGlobalMap = new Map();
    for (const [rarity,bsets] of bwikiByRarity.entries()) {
      const gsets = officialByRarity.get(rarity) || [];
      if (bsets.length === 1 && gsets.length === 1) setGlobalMap.set(bsets[0].setCn,gsets[0]);
    }

    for (const set of setDetails) {
      const setGlobal = setGlobalMap.get(set.setCn) || '';
      for (const piece of set.pieces.slice(0,18)) {
        try {
          const p = await fetchBwikiPage(piece.cnName);
          const {stats,scores} = parseBwikiItemStats(p.html);
          result.provisional.push({
            key:`cn:${norm(piece.cnName)}|${norm(piece.type)}|${set.rarity}`,
            name:'',cnName:piece.cnName,type:piece.type,rarity:set.rarity,set:setGlobal,setCn:set.setCn,
            source:`BWIKI · ${schedule.current.event}${set.source?` · ${set.source}`:''}`,
            stats,scores,url:p.url,setUrl:set.url,primaryStyle:piece.primaryStyle,
            confidence:setGlobal ? 'provisional-set-mapped' : 'provisional-cn',sourceRefs:['BWIKI'],updatedAt:new Date().toISOString()
          });
          await sleep(180);
        } catch (e) { result.errors.push(`piece ${piece.cnName}: ${e.message}`); }
      }
    }
  } catch (error) {
    result.error = String(error.message || error);
  }
  return result;
}

function mergeRecord(map, record) {
  if (!record?.name || !record?.type || !record?.rarity) return;
  const key = record.key || keyOf(record.name,record.type,record.rarity);
  const prev = map.get(key);
  if (!prev) { map.set(key,{...record,key}); return; }
  const prevStats = Object.keys(prev.stats || {}).length;
  const newStats = Object.keys(record.stats || {}).length;
  const preferNew = newStats > prevStats || (record.sourceRefs || []).includes('wiki.gg');
  const base = preferNew ? {...prev,...record} : {...record,...prev};
  base.key = key;
  base.sourceRefs = uniq([...(prev.sourceRefs || []),...(record.sourceRefs || [])]);
  base.aliases = uniq([...(prev.aliases || []),...(record.aliases || [])]);
  map.set(key,base);
}

await fs.mkdir('data',{recursive:true});
const generatedAt = new Date().toISOString();
const [farmable, official, wikiLatest] = await Promise.all([
  loadFarmable(),
  officialGlobal(),
  latestWikiRecords(Number(process.env.RYN_WIKI_LATEST_LIMIT || 1200)).catch(error => ({error,records:[]}))
]);
const wikiRecords = Array.isArray(wikiLatest) ? wikiLatest : [];
const bwiki = await bwikiSnapshot(official);

const map = new Map();
for (const record of farmable) mergeRecord(map,record);
for (const record of wikiRecords) mergeRecord(map,record);
for (const piece of official.explicitPieces || []) {
  mergeRecord(map,{
    ...piece,key:keyOf(piece.name,piece.type,piece.rarity),set:'',source:`Official Global announcement${official.lightchase?` · ${official.lightchase}`:''}`,
    stats:{},scores:Object.fromEntries(STYLES.map(s=>[s,0])),url:STEAM_URL,confidence:'official-metadata',sourceRefs:['Official Global'],updatedAt:generatedAt
  });
}

const output = {
  schemaVersion:1,generatedAt,count:map.size,provisionalCount:bwiki.provisional?.length || 0,
  records:[...map.values()].sort((a,b)=>a.name.localeCompare(b.name)),
  provisional:bwiki.provisional || [],
  sources:{
    wiki:{ok:true,label:'Life Makeover Wiki (wiki.gg)',latestScanned:wikiRecords.length,url:'https://lifemakeover.wiki.gg/'},
    official:{...official,label:'Official Global / Steam announcements'},
    bwiki:{ok:bwiki.ok,label:'以闪亮之名 BWIKI',checkedAt:bwiki.checkedAt,current:bwiki.current,rows:bwiki.rows || [],errors:bwiki.errors || [],url:bwiki.scheduleUrl}
  },
  notes:[
    'Exact English records prefer wiki.gg or explicit Official Global metadata.',
    'BWIKI-only records remain provisional and are never matched to an English item name by name alone.',
    'When BWIKI and Official Global each have exactly one current set of the same rarity, set names may be paired provisionally; item names remain unpaired until an English source exists.'
  ]
};
if (!output.count && !output.provisionalCount) throw new Error('Master catalog sync produced no records; refusing to publish an empty catalog.');
await fs.writeFile(OUT,JSON.stringify(output,null,2));
console.log(`master catalog: ${output.count} exact + ${output.provisionalCount} provisional · ${generatedAt}`);
