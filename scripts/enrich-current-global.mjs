import fs from 'node:fs/promises';

const MASTER = 'data/master-catalog.json';
const STEAM_URLS = [
  'https://steamcommunity.com/app/2626940/?l=english',
  'https://steamcommunity.com/app/2626940/announcements/?l=english',
  'https://steamcommunity.com/app/2626940/allnews/?l=english'
];
const BWIKI = 'https://wiki.biligame.com/yslzgame';
const BWIKI_HOME = `${BWIKI}/%E9%A6%96%E9%A1%B5`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();

async function fetchText(url, tries = 4) {
  let last;
  for (let i=1;i<=tries;i++) {
    try {
      const res = await fetch(url,{headers:{'user-agent':'RynWardrobeLab/2.2 (+GitHub catalog sync)','accept':'text/html,*/*'}});
      if (res.ok) return res.text();
      last = new Error(`${res.status} ${res.statusText}`);
      if (![429,500,502,503,504].includes(res.status)) throw last;
      await sleep(Math.max(Number(res.headers.get('retry-after') || 0) * 1000, i * 500));
    } catch (e) {
      last = e;
      if (i < tries) await sleep(i * 500);
    }
  }
  throw last || new Error(`fetch failed: ${url}`);
}

function decodeHtml(s='') {
  return String(s)
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/&#91;|&lbrack;/gi,'[').replace(/&#93;|&rbrack;/gi,']')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
}
function htmlText(html='') {
  return decodeHtml(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/(?:p|div|li|tr|td|th|h[1-6]|section|article|a)>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/[\t\r ]+/g,' ')
    .replace(/\n\s+/g,'\n')
    .replace(/\n{3,}/g,'\n\n')).trim();
}

function normalizeSteamText(raw='') {
  const decoded = decodeHtml(raw)
    .replace(/\\([\[\]])/g,'$1')
    .replace(/\\u005b/gi,'[')
    .replace(/\\u005d/gi,']');
  return htmlText(decoded).replace(/\\([\[\]])/g,'$1');
}

function parseCurrentFashionCodeGlobal(raw) {
  const text = normalizeSteamText(raw);
  const patterns = [
    /New Fashion Code[\s\S]{0,3000}?5[- ]Star Set\s*(?:[-–:]\s*)?\[\s*([^\]\n]+?)\s*\]/i,
    /New Fashion Code[\s\S]{0,3000}?5[- ]Star Set\s*(?:[-–:]\s*)?([^\n]{2,80})/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const name = String(m[1] || '').replace(/^\[|\]$/g,'').replace(/[.。]+$/,'').trim();
    if (name && !/event|detail|time/i.test(name)) return {name,rarity:5};
  }
  return null;
}

async function currentFashionCodeGlobal() {
  const errors = [];
  for (const url of STEAM_URLS) {
    try {
      const raw = await fetchText(url);
      const found = parseCurrentFashionCodeGlobal(raw);
      if (found) return {...found,url,checkedAt:new Date().toISOString(),errors};
      errors.push(`${url}: no Fashion Code match`);
    } catch (e) {
      errors.push(`${url}: ${e.message || e}`);
    }
  }
  return {name:'',rarity:5,url:STEAM_URLS[0],checkedAt:new Date().toISOString(),errors};
}

function parseCurrentFashionCodeCn(homeText) {
  const lines = homeText.split('\n').map(x=>x.trim()).filter(Boolean);
  for (let i=0;i<lines.length-1;i++) {
    if (!/^潮流密码[·・]/.test(lines[i])) continue;
    for (let j=i+1;j<Math.min(lines.length,i+8);j++) {
      const line = lines[j];
      if (!line || /^MediaWiki:/.test(line) || /^\[/.test(line) || /^潮流密码/.test(line)) continue;
      if (line.length <= 20) return {event:lines[i].replace(/^潮流密码[·・]/,''),setCn:line};
    }
  }
  return null;
}

async function currentFashionCodeCn() {
  try {
    const raw = await fetchText(BWIKI_HOME);
    return {ok:true,checkedAt:new Date().toISOString(),url:BWIKI_HOME,current:parseCurrentFashionCodeCn(htmlText(raw))};
  } catch (e) {
    return {ok:false,checkedAt:new Date().toISOString(),url:BWIKI_HOME,current:null,error:String(e.message || e)};
  }
}

async function main() {
  const master = JSON.parse(await fs.readFile(MASTER,'utf8'));
  if (!Array.isArray(master.records)) throw new Error('master catalog missing records');

  const [global,cn] = await Promise.all([currentFashionCodeGlobal(),currentFashionCodeCn()]);
  const status = {checkedAt:new Date().toISOString(),fashionCode:{global,cn}};

  // Important: Global and CN servers can run different Fashion Codes.
  // Never pair their item-level records only because both are current.
  const currentSets = Array.isArray(master.currentGlobalSets) ? master.currentGlobalSets.filter(x=>x?.name) : [];
  if (global.name) {
    const candidate = {
      name:global.name,
      rarity:Number(global.rarity || 5),
      kind:'Fashion Code',
      source:'Official Global · Current Fashion Code',
      sourceUrl:global.url,
      confidence:'official-set',
      detectedAt:new Date().toISOString()
    };
    const idx = currentSets.findIndex(x=>norm(x.name)===norm(candidate.name) && Number(x.rarity)===candidate.rarity);
    if (idx >= 0) currentSets[idx] = {...currentSets[idx],...candidate};
    else currentSets.unshift(candidate);
    master.currentGlobalSets = currentSets.slice(0,12);
    console.log(`current Global Fashion Code set: ${candidate.name} · ${candidate.rarity}★`);
  } else {
    master.currentGlobalSets = currentSets;
    console.warn('current Global Fashion Code not parsed',JSON.stringify(global.errors || []));
  }

  master.generatedAt = new Date().toISOString();
  master.sources ||= {};
  master.sources.currentGlobalOverlay = status;
  await fs.writeFile(MASTER,JSON.stringify(master,null,2));
  console.log(`master enriched: ${master.records.length} exact + ${master.provisional?.length || 0} provisional + ${master.currentGlobalSets?.length || 0} current Global sets`);
}

await main();
