import fs from 'node:fs/promises';

const API = 'https://lifemakeover.wiki.gg/api.php';
const BASE = 'https://lifemakeover.wiki.gg/wiki/';
const INPUT = 'scripts/batch-items.json';
const OUTPUT = 'data/batch-resolved.json';
const STYLES = ['Cool','Elegant','Fresh','Gorgeous','Lively','Pure','Sexy','Simple','Sweet','Warm'];
const RATING_BASE = { C:10, B:20, A:30, S:40, SS:50, SSS:60 };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const escRe = value => String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

async function fetchRetry(url, tries=5) {
  let last;
  for (let i=1;i<=tries;i++) {
    try {
      const res = await fetch(url,{headers:{'user-agent':'RynWardrobeLab/2.1 (+GitHub batch resolver)','accept':'application/json'}});
      if (res.ok) return res;
      last = new Error(`${res.status} ${res.statusText}`);
      if (![429,500,502,503,504].includes(res.status)) throw last;
      const retry = Number(res.headers.get('retry-after') || 0);
      await sleep(Math.max(retry*1000, 600*i));
    } catch (e) {
      last=e;
      if (i<tries) await sleep(600*i);
    }
  }
  throw last;
}
async function api(params) {
  const qs = new URLSearchParams({format:'json',formatversion:'2',origin:'*',...params});
  return (await fetchRetry(`${API}?${qs}`)).json();
}
function param(src,name) {
  const re = new RegExp(`\\|\\s*${escRe(name)}\\s*=\\s*([\\s\\S]*?)(?=\\s*\\|\\s*[A-Za-z0-9_]+\\s*=|\\n\\s*\\}\\}|$)`,'i');
  return (String(src||'').match(re)?.[1] || '').trim();
}
function cleanWiki(v='') {
  return String(v)
    .replace(/<!--([\s\S]*?)-->/g,'')
    .replace(/<br\s*\/?>/gi,' · ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,'$2')
    .replace(/\[\[([^\]]+)\]\]/g,'$1')
    .replace(/\{\{(?:Style|Tag|Rarity)\|([^}|]+)[^}]*\}\}/gi,'$1')
    .replace(/\{\{[^}]+\}\}/g,'')
    .replace(/'''?/g,'').replace(/\s+/g,' ').trim();
}
function block(src,name) {
  const start = String(src||'').search(new RegExp(`\\{\\{\\s*${escRe(name)}`,'i'));
  if (start<0) return '';
  const tail = src.slice(start);
  let depth=0;
  for (let i=0;i<tail.length-1;i++) {
    const pair=tail.slice(i,i+2);
    if (pair==='{{'){depth++;i++;continue;}
    if (pair==='}}'){depth--;i++;if(depth===0)return tail.slice(0,i+1);}
  }
  return tail;
}
function score(rating,scale) {
  const base=RATING_BASE[String(rating||'').trim().toUpperCase()]||0;
  return base ? Number((base + Math.max(0,Number(scale||0))).toFixed(1)) : 0;
}
function parse(title,wikitext) {
  if (!/\{\{\s*Fashion Infobox/i.test(wikitext)) return null;
  const info=block(wikitext,'Fashion Infobox')||wikitext;
  const statsBlock=block(wikitext,'Fashion Stats');
  const type=cleanWiki(param(info,'type'));
  const rarity=Number(cleanWiki(param(info,'rarity')))||0;
  if (!type || !rarity) return null;
  const set=cleanWiki(param(info,'set'));
  const source=cleanWiki(param(info,'obtain'));
  const stats={}; const scores=Object.fromEntries(STYLES.map(s=>[s,0]));
  for (let i=1;i<=5;i++) {
    const style=cleanWiki(param(statsBlock,`style${i}`));
    const scale=Number(cleanWiki(param(statsBlock,`scale${i}`)))||0;
    const rating=cleanWiki(param(statsBlock,`rating${i}`)).toUpperCase();
    if (!STYLES.includes(style) || !rating) continue;
    const sc=score(rating,scale);
    stats[style]={rating,scale,score:sc}; scores[style]=sc;
  }
  const tags=[...param(info,'tag').matchAll(/\{\{\s*Tag\s*\|\s*([^}|]+)[^}]*\}\}/gi)].map(m=>m[1].trim());
  return {name:title,type,rarity,set,source,tags,stats,scores,url:`${BASE}${encodeURIComponent(title.replace(/ /g,'_'))}`};
}
async function fetchTitles(titles) {
  const data=await api({action:'query',prop:'revisions',rvprop:'content',rvslots:'main',redirects:'1',titles:[...new Set(titles)].join('|')});
  const out=[];
  for (const p of data?.query?.pages||[]) {
    if (p.missing) continue;
    const src=p.revisions?.[0]?.slots?.main?.content||'';
    const rec=parse(p.title,src);
    if (rec) out.push(rec);
  }
  return out;
}
async function resolveOne(req) {
  const directTitles=[req.name, `${req.name} (${req.type})`];
  let candidates=await fetchTitles(directTitles);
  const exact = candidates.find(r => norm(r.name)===norm(req.name) && r.type===req.type && r.rarity===Number(req.rarity));
  if (exact) return {...req,matched:true,ambiguous:false,record:exact,statCount:Object.keys(exact.stats).length,complete:Object.keys(exact.stats).length===5};

  let typed = candidates.filter(r => r.type===req.type && r.rarity===Number(req.rarity));
  if (typed.length===1) {
    const r=typed[0];
    return {...req,matched:true,ambiguous:false,record:r,statCount:Object.keys(r.stats).length,complete:Object.keys(r.stats).length===5};
  }

  const s=await api({action:'query',list:'search',srnamespace:'0',srlimit:'10',srsearch:`"${req.name}"`});
  const titles=(s?.query?.search||[]).map(x=>x.title);
  candidates=[...candidates, ...(await fetchTitles(titles))];
  const dedup=[...new Map(candidates.map(r=>[`${norm(r.name)}|${r.type}|${r.rarity}`,r])).values()];
  const same = dedup.filter(r => r.type===req.type && r.rarity===Number(req.rarity) && (norm(r.name)===norm(req.name) || norm(r.name).startsWith(`${norm(req.name)} (`)));
  if (same.length===1) {
    const r=same[0];
    return {...req,matched:true,ambiguous:false,record:r,statCount:Object.keys(r.stats).length,complete:Object.keys(r.stats).length===5};
  }
  if (same.length>1) {
    const direct=same.find(r=>norm(r.name)===norm(req.name));
    if (direct) return {...req,matched:true,ambiguous:false,record:direct,statCount:Object.keys(direct.stats).length,complete:Object.keys(direct.stats).length===5};
    return {...req,matched:false,ambiguous:true,candidates:same.map(r=>({name:r.name,type:r.type,rarity:r.rarity,set:r.set,statCount:Object.keys(r.stats).length,url:r.url}))};
  }
  return {...req,matched:false,ambiguous:false,candidates:dedup.slice(0,5).map(r=>({name:r.name,type:r.type,rarity:r.rarity,set:r.set,statCount:Object.keys(r.stats).length,url:r.url}))};
}

const input=JSON.parse(await fs.readFile(INPUT,'utf8'));
const results=[];
for (let i=0;i<input.length;i++) {
  const req=input[i];
  try {
    const r=await resolveOne(req);
    results.push(r);
    console.log(`${i+1}/${input.length}`, req.name, r.matched ? `=> ${r.record.name} · ${r.statCount}/5` : (r.ambiguous?'AMBIGUOUS':'MISS'));
  } catch (e) {
    results.push({...req,matched:false,ambiguous:false,error:String(e?.message||e)});
    console.error(`${i+1}/${input.length}`, req.name, 'ERROR', e?.message||e);
  }
  await sleep(140);
}
await fs.mkdir('data',{recursive:true});
const out={generatedAt:new Date().toISOString(),count:results.length,matched:results.filter(x=>x.matched).length,complete:results.filter(x=>x.complete).length,results};
await fs.writeFile(OUTPUT,JSON.stringify(out,null,2));
console.log(`Resolved ${out.matched}/${out.count}; complete stats ${out.complete}/${out.count}`);
