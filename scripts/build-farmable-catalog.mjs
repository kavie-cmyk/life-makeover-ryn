import fs from "node:fs/promises";

const API = "https://lifemakeover.wiki.gg/api.php";
const BASE = "https://lifemakeover.wiki.gg/wiki/";
const STYLES = ["Cool","Elegant","Fresh","Gorgeous","Lively","Pure","Sexy","Simple","Sweet","Warm"];
const ACCESSORIES = new Set(["Hat","Hair Accessory","Face Accessory","Earrings","Necklace","Bracelet","Gloves","Ring","Handheld","Wings","Tail","Bag","Anklet","Crossbody","Floating","Tattoo","Motor"]);
const RATING_BASE = { C:10, B:20, A:30, S:40, SS:50, SSS:60 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(params, tries = 4) {
  const qs = new URLSearchParams({ format:"json", formatversion:"2", origin:"*", ...params });
  for (let attempt = 1; attempt <= tries; attempt++) {
    const res = await fetch(`${API}?${qs}`, { headers: { "user-agent":"RynWardrobeLab/1.0 (GitHub Pages catalog builder)" } });
    if (res.ok) return res.json();
    if (attempt === tries) throw new Error(`Wiki API ${res.status} for ${params.page || params.titles || params.action}`);
    await sleep(400 * attempt);
  }
}

function decodeHtml(s="") {
  return String(s)
    .replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"')
    .replace(/&#039;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
}

function text(html="") {
  return decodeHtml(String(html).replace(/<br\s*\/?>/gi," · ").replace(/<[^>]+>/g," ").replace(/\s+/g," ")).trim();
}

function linkTitle(html="") {
  const re = /href=["']\/wiki\/([^"'#?]+)[^"']*["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let title = decodeURIComponent(m[1]).replace(/_/g," ");
    if (/^(File|Category|Template|Help|Special|User|Life Makeover Wiki):/i.test(title)) continue;
    return title;
  }
  return "";
}

function escRe(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }
function param(src,name) {
  const re = new RegExp(`\\|\\s*${escRe(name)}\\s*=\\s*([\\s\\S]*?)(?=\\s*\\|\\s*[A-Za-z0-9_]+\\s*=|\\n\\s*\\}\\}|$)`,"i");
  return (String(src||"").match(re)?.[1]||"").trim();
}
function cleanWiki(value="") {
  return String(value)
    .replace(/<!--([\s\S]*?)-->/g,"")
    .replace(/<br\s*\/?>/gi," · ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,"$2")
    .replace(/\[\[([^\]]+)\]\]/g,"$1")
    .replace(/\{\{(?:Style|Tag|Rarity)\|([^}|]+)[^}]*\}\}/gi,"$1")
    .replace(/\{\{[^}]+\}\}/g,"")
    .replace(/'''?/g,"").replace(/\s+/g," ").trim();
}
function templateBlock(src,name) {
  const start = String(src||"").search(new RegExp(`\\{\\{\\s*${escRe(name)}`,"i"));
  if (start < 0) return "";
  const tail = src.slice(start);
  let depth = 0;
  for (let i=0;i<tail.length-1;i++) {
    const pair = tail.slice(i,i+2);
    if (pair === "{{") { depth++; i++; continue; }
    if (pair === "}}") { depth--; i++; if (depth===0) return tail.slice(0,i+1); }
  }
  return tail;
}
function wikiScore(rating,scale) {
  const base = RATING_BASE[String(rating||"").trim().toUpperCase()]||0;
  const s = Math.max(0,Number(scale||0));
  return base ? Number((base+s).toFixed(1)) : 0;
}

function classifySource(source="") {
  const s = source.toLowerCase();
  const paid = ["lightchase","fashion code","top-up","top up","rebate gifts","super rebate","purchase","pack","wonder box"];
  if (paid.some(k=>s.includes(k))) return { tier:0, key:"limited", label:"Limited / paid / gacha" };
  if (/story quest.*stage\s*\d/i.test(source)) return { tier:5, key:"story-drop", label:"Story stage · farm được" };
  if (s.includes("mind travel")) return { tier:5, key:"mind-travel", label:"Mind Travel · permanent" };
  if (s.includes("fashion studio")) return { tier:5, key:"fashion-studio", label:"Fashion Studio · permanent" };
  if (s.includes("permanent shop")) return { tier:5, key:"permanent-shop", label:"Permanent Shop · exchange" };
  if (s.includes("guild shop") || s.includes("beauty course")) return { tier:5, key:"guild", label:"Guild · cày được" };
  if (s.includes("clothing store")) return { tier:5, key:"clothing-store", label:"Clothing Store" };
  if (s.includes("achievement") || s.includes("vvanna challenge")) return { tier:5, key:"achievement", label:"Permanent reward" };
  if (s.includes("fashion shop")) return { tier:4, key:"fashion-shop", label:"Fashion Shop · currency" };
  if (s.includes("endorsement shop")) return { tier:3, key:"endorsement-shop", label:"Endorsement Shop · kiểm tra mùa" };
  if (s.includes("ally shop") || s.includes("convenience store")) return { tier:3, key:"exchange", label:"Exchange · kiểm tra stock" };
  if (s.includes("sign-in") || s.includes("login bonus") || s.includes("event")) return { tier:1, key:"event", label:"Event / reward · có thể hết hạn" };
  return { tier:0, key:"unknown", label:"Không xác nhận còn farm được" };
}

async function parsedHtml(page) {
  const data = await api({ action:"parse", page, prop:"text", redirects:"1" });
  return data?.parse?.text || "";
}

function parseTableRows(tableHtml) {
  return [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => {
    return [...m[1].matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi)].map(x=>x[2]);
  });
}

function parseStyleList(html, style) {
  const sets=[]; const direct=[];
  let rarity=0;
  const tokenRe=/<h[2-4][^>]*>[\s\S]*?<\/h[2-4]>|<table[^>]*>[\s\S]*?<\/table>/gi;
  for (const match of html.matchAll(tokenRe)) {
    const block=match[0];
    if (/^<h/i.test(block)) {
      const t=text(block);
      const r=t.match(/([3-6])\s*[- ]?Star/i);
      if (r) rarity=Number(r[1]);
      continue;
    }
    const rows=parseTableRows(block);
    if (!rows.length) continue;
    const headers=rows[0].map(c=>text(c).toLowerCase());
    const obtainIdx=headers.findIndex(h=>h.includes("obtain"));
    const setIdx=headers.findIndex(h=>h === "set" || h.includes("set name"));
    const fashionIdx=headers.findIndex(h=>h === "fashion" || h === "name" || h.includes("fashion"));
    if (obtainIdx<0) continue;
    for (const cells of rows.slice(1)) {
      const source=text(cells[obtainIdx]||"");
      const avail=classifySource(source);
      if (avail.tier<3) continue;
      if (setIdx>=0) {
        const name=linkTitle(cells[setIdx]||"") || text(cells[setIdx]||"");
        if (name) sets.push({name,style,rarity,source,availability:avail});
      } else if (fashionIdx>=0) {
        const name=linkTitle(cells[fashionIdx]||"") || text(cells[fashionIdx]||"");
        if (name) direct.push({name,style,rarity,source,availability:avail});
      }
    }
  }
  return {sets,direct};
}

function parseSetBreakdown(html) {
  const results=[];
  const tables=[...html.matchAll(/<table[^>]*>[\s\S]*?<\/table>/gi)].map(m=>m[0]);
  for (const table of tables) {
    const rows=parseTableRows(table); if (!rows.length) continue;
    const headers=rows[0].map(c=>text(c).toLowerCase());
    const fashionIdx=headers.findIndex(h=>h === "fashion" || h.includes("fashion"));
    const typeIdx=headers.findIndex(h=>h === "type" || h.includes("type"));
    if (fashionIdx<0 || typeIdx<0) continue;
    for (const cells of rows.slice(1)) {
      const name=linkTitle(cells[fashionIdx]||"") || text(cells[fashionIdx]||"");
      const type=text(cells[typeIdx]||"");
      if (name && type) results.push({name,type});
    }
  }
  return results;
}

function parseFashion(title,wikitext,thumbnail="") {
  if (!/\{\{\s*Fashion Infobox/i.test(wikitext)) return null;
  const info=templateBlock(wikitext,"Fashion Infobox")||wikitext;
  const statsBlock=templateBlock(wikitext,"Fashion Stats");
  const type=cleanWiki(param(info,"type"));
  const rarity=Number(cleanWiki(param(info,"rarity")))||3;
  const set=cleanWiki(param(info,"set"));
  const source=cleanWiki(param(info,"obtain"));
  const tags=[...param(info,"tag").matchAll(/\{\{\s*Tag\s*\|\s*([^}|]+)[^}]*\}\}/gi)].map(m=>m[1].trim());
  const stats={}; const scores=Object.fromEntries(STYLES.map(s=>[s,0]));
  for (let i=1;i<=5;i++) {
    const style=cleanWiki(param(statsBlock,`style${i}`));
    const scale=Number(cleanWiki(param(statsBlock,`scale${i}`)))||0;
    const rating=cleanWiki(param(statsBlock,`rating${i}`)).toUpperCase();
    if (!STYLES.includes(style)||!rating) continue;
    const score=wikiScore(rating,scale);
    stats[style]={rating,scale,score}; scores[style]=score;
  }
  if (!Object.keys(stats).length) return null;
  return {title,type,rarity,set,source,tags,thumbnail,stats,scores,url:`${BASE}${encodeURIComponent(title.replace(/ /g,"_"))}`};
}

async function mapLimit(values,limit,fn) {
  const out=new Array(values.length); let cursor=0;
  async function worker(){
    while(true){ const i=cursor++; if(i>=values.length) return; try{out[i]=await fn(values[i],i);}catch(e){console.warn("skip",values[i]?.name||values[i],e.message); out[i]=null;} }
  }
  await Promise.all(Array.from({length:Math.min(limit,values.length)},worker));
  return out;
}

async function fetchFashionBatch(titles) {
  const data=await api({ action:"query", prop:"revisions|pageimages", rvprop:"content", rvslots:"main", piprop:"thumbnail", pithumbsize:"320", redirects:"1", titles:titles.join("|") });
  return (data?.query?.pages||[]).map(page=>{
    const src=page.revisions?.[0]?.slots?.main?.content||"";
    return parseFashion(page.title,src,page.thumbnail?.source||"");
  }).filter(Boolean);
}

async function mindTravelSetRoutes() {
  try {
    const html=await parsedHtml("Shining Journey/Mind Travel");
    const map=new Map(); let chapter="";
    const tokenRe=/<h[2-4][^>]*>[\s\S]*?<\/h[2-4]>|<p[^>]*>[\s\S]*?<\/p>|<table[^>]*>[\s\S]*?<\/table>/gi;
    for (const m of html.matchAll(tokenRe)) {
      const block=m[0]; const t=text(block);
      const cm=t.match(/Chapter\s+(\d+)/i); if (cm) chapter=`Mind Travel Chapter ${String(cm[1]).padStart(2,"0")}`;
      if (!chapter) continue;
      for (const lm of block.matchAll(/href=["']\/wiki\/([^"'#?]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        const label=text(lm[2]); if (label) map.set(label,chapter);
      }
    }
    return map;
  } catch { return new Map(); }
}

const setRefs=new Map();
const directRefs=new Map();
for (const style of STYLES) {
  console.log("scan style",style);
  const html=await parsedHtml(`List of ${style} Fashions`);
  const {sets,direct}=parseStyleList(html,style);
  for (const row of sets) {
    const key=row.name.toLowerCase();
    const cur=setRefs.get(key)||{...row,styles:[]};
    if (!cur.styles.includes(style)) cur.styles.push(style);
    if ((row.availability?.tier||0)>(cur.availability?.tier||0)) Object.assign(cur,row,{styles:cur.styles});
    setRefs.set(key,cur);
  }
  for (const row of direct) {
    const key=row.name.toLowerCase();
    const cur=directRefs.get(key)||{...row,styles:[]};
    if (!cur.styles.includes(style)) cur.styles.push(style);
    if ((row.availability?.tier||0)>(cur.availability?.tier||0)) Object.assign(cur,row,{styles:cur.styles});
    directRefs.set(key,cur);
  }
}

const routeMap=await mindTravelSetRoutes();
const sets=[...setRefs.values()].sort((a,b)=>(b.availability.tier-a.availability.tier)||(b.rarity-a.rarity));
console.log("farmable sets",sets.length,"direct",directRefs.size);
const setPages=await mapLimit(sets,6,async set=>{
  const html=await parsedHtml(set.name);
  const pieces=parseSetBreakdown(html);
  const stage=text(html).match(/Stage\s+\d{2}-\d{2}/i)?.[0]||"";
  const route=set.source.toLowerCase().includes("mind travel") ? (routeMap.get(set.name)||"Mind Travel") : stage || set.source;
  return {...set,pieces,route,url:`${BASE}${encodeURIComponent(set.name.replace(/ /g,"_"))}`};
});

const itemParents=new Map();
for (const set of setPages.filter(Boolean)) {
  for (const piece of set.pieces) {
    const key=piece.name.toLowerCase();
    const prior=itemParents.get(key);
    if (!prior || set.availability.tier>(prior.availability?.tier||0)) itemParents.set(key,{...piece,parent:set});
  }
}
for (const row of directRefs.values()) {
  const key=row.name.toLowerCase();
  if (!itemParents.has(key)) itemParents.set(key,{name:row.name,type:"",parent:null,direct:row});
}

const titles=[...itemParents.values()].map(x=>x.name);
const fashions=[];
for (let i=0;i<titles.length;i+=25) {
  console.log("fashion batch",i+1,"/",titles.length);
  const batch=await fetchFashionBatch(titles.slice(i,i+25));
  fashions.push(...batch);
  await sleep(80);
}

const output=[];
for (const item of fashions) {
  const ref=itemParents.get(item.title.toLowerCase());
  const fallback=ref?.parent || ref?.direct || null;
  const rawSource=(fallback?.source || item.source || "").trim();
  const availability=classifySource(rawSource);
  if (availability.tier<3) continue;
  const source=(item.source && !/^\s*$/.test(item.source) && classifySource(item.source).tier>=3) ? item.source : rawSource;
  const route=ref?.parent?.route || (source.match(/Story Quest[^·]*(?:Stage\s*\d{2}-\d{2})/i)?.[0]) || source;
  output.push({
    name:item.title,type:item.type,rarity:item.rarity,set:item.set||ref?.parent?.name||"",
    source,route,sourceTier:availability.tier,sourceKey:availability.key,sourceLabel:availability.label,
    styles:item.stats,scores:item.scores,tags:item.tags,image:item.thumbnail,url:item.url,
    setUrl:ref?.parent?.url||"",accessory:ACCESSORIES.has(item.type)
  });
}

const dedup=[...new Map(output.map(x=>[x.name.toLowerCase(),x])).values()]
  .sort((a,b)=>b.sourceTier-a.sourceTier||b.rarity-a.rarity||a.name.localeCompare(b.name));

if (dedup.length<20) throw new Error(`Catalog too small (${dedup.length}); aborting deploy rather than publishing bad recommendations.`);

await fs.mkdir("data",{recursive:true});
await fs.writeFile("data/farmable-catalog.json",JSON.stringify({
  schema:1,generatedAt:new Date().toISOString(),source:"Life Makeover Wiki (wiki.gg)",license:"CC BY-SA 4.0",
  policy:"Only sources classified as permanent/current grind or exchange are included; seasonal shop availability should still be checked in-game.",
  count:dedup.length,items:dedup
},null,2));
console.log(`wrote ${dedup.length} items to data/farmable-catalog.json`);
