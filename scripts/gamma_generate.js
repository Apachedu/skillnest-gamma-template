#!/usr/bin/env node
/**
 * Gamma Deck Generator (beta API)
 * - Reads deck.md (with {{HOST}} placeholders)
 * - POST /v0.2/generations
 * - Optional: exportAs "pdf" or "pptx"
 * - Polls GET /v0.2/generations/{id} every 5s
 *
 * Env:
 *   GAMMA_KEY (required)
 *   HOST (required, e.g. https://learn.skillnestedu.com)
 *   DECK_FORMAT (presentation|webpage) default: presentation
 *   THEME_NAME (e.g., Oasis) default: Oasis
 *   EXPORT_AS (pdf|pptx) optional
 *   DOWNLOAD_EXPORTS (true|false) optional; if true, downloads files to ./downloads
 *   BATCH_CSV (optional path) -> columns: title,format,theme,exportAs
 */
const fs = require('fs');
const https = require('https');
const path = require('path');

const HOST = (process.env.HOST||'').trim();
const GAMMA_KEY = (process.env.GAMMA_KEY||'').trim();
if(!HOST || !GAMMA_KEY){
  console.error('❌ Set HOST and GAMMA_KEY env vars.');
  process.exit(1);
}
const DECK_FORMAT = (process.env.DECK_FORMAT||'presentation').trim();
const THEME_NAME = (process.env.THEME_NAME||'Oasis').trim();
const EXPORT_AS = (process.env.EXPORT_AS||'').trim(); // pdf or pptx
const DOWNLOAD_EXPORTS = (process.env.DOWNLOAD_EXPORTS||'false').trim().toLowerCase()==='true';
const BATCH_CSV = (process.env.BATCH_CSV||'').trim();

const deckTemplate = fs.readFileSync(path.join(process.cwd(),'deck.md'),'utf8');
const deckText = deckTemplate.replace(/\{\{HOST\}\}/g, HOST.replace(/\/+$/,''));

function postGeneration(payload){
  return http('POST','/v0.2/generations',payload);
}
function getGeneration(id){
  return http('GET',`/v0.2/generations/${id}`);
}
function http(method, p, body){
  const opts = {
    method,
    hostname: 'public-api.gamma.app',
    path: p,
    headers: { 'X-API-KEY': GAMMA_KEY, 'Content-Type': 'application/json' }
  };
  return new Promise((resolve,reject)=>{
    const req = https.request(opts, res=>{
      let data='';
      res.on('data',d=>data+=d);
      res.on('end',()=>{
        try{ resolve(JSON.parse(data||'{}')); }
        catch{ resolve({ raw:data, statusCode:res.statusCode }); }
      });
    });
    req.on('error', reject);
    if(body) req.write(JSON.stringify(body));
    req.end();
  });
}
async function poll(id, tries=24, delay=5000){
  for(let i=0;i<tries;i++){
    await new Promise(r=>setTimeout(r,delay));
    const g = await getGeneration(id);
    const d = g?.data||{};
    const url = d.url || d.publicUrl;
    const status = d.status||'';
    console.log(`⏳ ${id} status: ${status}`);
    if(url || status==='completed'){ return g; }
  }
  return { error:'timeout', id };
}
async function downloadTo(fileUrl, outPath){
  return new Promise((resolve,reject)=>{
    const f = fs.createWriteStream(outPath);
    https.get(fileUrl, res=>{
      if(res.statusCode!==200){ reject(new Error('HTTP '+res.statusCode)); return; }
      res.pipe(f);
      f.on('finish', ()=>f.close(()=>resolve(outPath)));
    }).on('error', reject);
  });
}

function payloadFrom(inputText, fmt, theme, exportAs){
  const p = {
    inputText,
    textMode: 'preserve',
    format: fmt || 'presentation',
    cardSplit: 'inputTextBreaks',
    themeName: theme || 'Oasis',
    imageOptions: { source: 'noImages' },
    sharingOptions: { externalAccess: 'view', workspaceAccess: 'edit' }
  };
  if(exportAs){ p.exportAs = exportAs; } // per official docs
  return p;
}

async function generateOne(overrides={}){
  const fmt = overrides.format || DECK_FORMAT;
  const theme = overrides.theme || THEME_NAME;
  const exportAs = overrides.exportAs || EXPORT_AS;

  const payload = payloadFrom(deckText, fmt, theme, exportAs);
  console.log('🚀 Creating Gamma deck…');
  const post = await postGeneration(payload);
  const id = post?.data?.id;
  if(!id){ console.error('❌ No generation id. Response:', post); process.exit(1); }
  console.log('🆔 Generation ID:', id, '| format:', fmt, '| theme:', theme, exportAs?('| exportAs: '+exportAs):'');

  const result = await poll(id);
  const d = result?.data || {};
  const deckUrl = d.url || d.publicUrl || '';
  console.log('✅ Deck URL:', deckUrl || '(see GET payload above)');

  // Try to capture export URLs in common shapes
  const files = d.files || [];
  let exportUrl = '';
  if(files.length){
    const wanted = (exportAs||'').toLowerCase();
    const f = files.find(x => (x?.type||'').toLowerCase()===wanted) || files[0];
    exportUrl = f?.url || '';
  } else {
    exportUrl = d.pdfUrl || d.pptxUrl || '';
  }
  if(exportUrl){ console.log('📎 Export URL:', exportUrl); }

  if(DOWNLOAD_EXPORTS && exportUrl){
    const ext = (exportAs==='pptx')?'.pptx':'.pdf';
    const out = path.join(process.cwd(),'downloads', `gamma_export_${id}${ext}`);
    try{
      fs.mkdirSync(path.join(process.cwd(),'downloads'), { recursive:true });
      await downloadTo(exportUrl, out);
      console.log('💾 Saved export to:', out);
    }catch(e){ console.log('⚠️ Download failed:', e?.message||e); }
  }

  // Persist for later steps
  fs.writeFileSync('last_generation.json', JSON.stringify({id, deckUrl, exportUrl, result}, null, 2));
  return { id, deckUrl, exportUrl };
}

(async ()=>{
  if(BATCH_CSV){
    const csv = fs.readFileSync(BATCH_CSV,'utf8').trim().split(/\r?\n/);
    const header = csv.shift().split(',').map(s=>s.trim().toLowerCase());
    const idx = (k)=> header.indexOf(k);
    for(const line of csv){
      if(!line.trim()) continue;
      const cols = line.split(',').map(s=>s.trim());
      const row = {
        title: cols[idx('title')],
        format: cols[idx('format')],
        theme: cols[idx('theme')],
        exportAs: cols[idx('exportas')]
      };
      console.log('— Batch row:', row);
      await generateOne(row);
    }
  } else {
    await generateOne({});
  }
})();
