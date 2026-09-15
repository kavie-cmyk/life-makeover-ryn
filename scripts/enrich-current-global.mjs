import fs from 'node:fs/promises';

const MASTER = 'data/master-catalog.json';
const STEAM = 'https://steamcommunity.com/app/2626940/announcements/?l=english';
const BWIKI = 'https://wiki.biligame.com/yslzgame';
const BWIKI_HOME = `${BWIKI}/%E9%A6%96%E9%A1%B5`;
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
const STYLES = ['Cool','Elegant','Fresh','Gorgeous','Lively','Pure','Sexy','Simple','Sweet','Warm'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const keyOf = (name,type,rarity) => `${norm(name)}|${norm(type)}|${Number(rarity || 0)}`;

async function fetchText(url, tries = 4) {
  let last;
  for (let i=1;i<=tries;i++) {
    try {
      const res = await fetch(url,{headers:{'user-agent':'RynWardrobeLab/2.1 (+GitHub catalog sync)','accept':'text/html,*/*'}});
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

function parseCurrentFashionCodeGlobal(text) {
  const blocks = [...text.matchAll(/New Fashion Code[\s\S]{0,1600}?5-Star Set\s*\[([^\]]+)\]/gi)];
  if (!blocks.length) return null;
  const name = blocks[0][1].trim();
  return name ? {name,rarity:5} : null;
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

function parseBwikiFashionPage(text,setCn) {
  let type = '';
  for (const [cn,en] of Object.entries(TYPE_CN)) {
    if (text.includes(`〖${cn}〗`) || new RegExp(`${cn}\\s*$`,'m').test(text)) { type = en; break; }
  }
  const stats = {};
  const scores = Object.fromEntries(STYLES.map(s=>[s,0]));
  const re = /(简约|华丽|清纯|性感|跃动|典雅|甜美|酷帅|清凉|保暖)\s*(SSS|SS|S|A|B|C)\b/g;
  for (const m of text.matchAll(re)) {
    const style = STYLE_CN[m[1]];
    if (!style || stats[style]) continue;
    const rating = m[2].toUpperCase();
    stats[style] = {rating,scale:null,score:RATING_BASE[rating] || 0};
    scores[style] = RATING_BASE[rating] || 0;
    if (Object.keys(stats).length >= 5) break;
  }
  const source = text.match(/获取途径\s*([\s\S]{0,120}?)(?:所属套装|取自|玩呐影响力)/)?.[1]?.replace(/\n+/g,' · ').trim() || '';
  return {type,stats,scores,source,setCn};
}

function upsert(records,record) {
  const k = keyOf(record.name,record.type,record.rarity);
  const index = records.findIndex(r => (r.key || keyOf(r.name,r.type,r.rarity)) === k);
  if (index < 0) records.push({...record,key:k});
  else {
    const old = records[index];
    const oldStats = Object.keys(old.stats || {}).length;
    const newStats = Object.keys(record.stats || {}).length;
    records[index] = {
      ...old,
      ...(newStats >= oldStats ? record : {}),
      key:k,
      aliases:[...new Set([...(old.aliases || []),...(record.aliases || [])])],
      sourceRefs:[...new Set([...(old.sourceRefs || []),...(record.sourceRefs || [])])]
    };
  }
}

async function main() {
  const master = JSON.parse(await fs.readFile(MASTER,'utf8'));
  if (!Array.isArray(master.records)) throw new Error('master catalog missing records');

  const status = {checkedAt:new Date().toISOString(),fashionCode:null,errors:[]};
  try {
    const [steamHtml,homeHtml] = await Promise.all([fetchText(STEAM),fetchText(BWIKI_HOME)]);
    const global = parseCurrentFashionCodeGlobal(htmlText(steamHtml));
    const cn = parseCurrentFashionCodeCn(htmlText(homeHtml));
    status.fashionCode = {global,cn};

    if (global?.name && cn?.setCn) {
      const itemUrl = `${BWIKI}/${encodeURIComponent(cn.setCn)}`;
      const itemText = htmlText(await fetchText(itemUrl));
      const parsed = parseBwikiFashionPage(itemText,cn.setCn);
      if (!parsed.type) throw new Error(`BWIKI current Fashion Code set ${cn.setCn} has no detectable fashion type`);

      const record = {
        key:keyOf(global.name,parsed.type,global.rarity),
        name:global.name,
        type:parsed.type,
        rarity:global.rarity,
        set:global.name,
        source:`Fashion Code · ${global.name}${parsed.source ? ` · ${parsed.source}` : ''}`,
        aliases:[cn.setCn],
        stats:parsed.stats,
        scores:parsed.scores,
        image:'',
        url:itemUrl,
        confidence:Object.keys(parsed.stats).length ? 'verified-cross-source' : 'official-name+bwiki-metadata',
        sourceRefs:['Official Global','BWIKI'],
        updatedAt:new Date().toISOString()
      };
      upsert(master.records,record);
      status.fashionCode.mapped = {name:record.name,type:record.type,rarity:record.rarity,setCn:cn.setCn,stats:Object.keys(record.stats).length};
      console.log(`current Fashion Code: ${record.name} · ${record.type} · ${record.rarity}★ · ${Object.keys(record.stats).length} stats`);
    } else {
      console.warn('current Fashion Code cross-source mapping unavailable',JSON.stringify({global,cn}));
    }
  } catch (e) {
    status.errors.push(String(e.message || e));
    console.warn('current Global enrichment skipped:',e.message || e);
  }

  master.records.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  master.count = master.records.length;
  master.generatedAt = new Date().toISOString();
  master.sources ||= {};
  master.sources.currentGlobalOverlay = status;
  await fs.writeFile(MASTER,JSON.stringify(master,null,2));
  console.log(`master enriched: ${master.count} exact + ${master.provisional?.length || 0} provisional`);
}

await main();
