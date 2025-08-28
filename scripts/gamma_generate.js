/* Node 20 script: generate Gamma decks from slides/*.md
   - Creates per-lesson viewers in /apps/lessons/dayX.html (always)
   - Tries to create Gamma decks (rate-limit friendly with backoff)
   - Writes an /apps/lessons/index.html that links to local viewer + Gamma/PDF if available
*/
import fs from "fs/promises";
import path from "path";
import { setTimeout as sleep } from "timers/promises";

const API_KEY = process.env.GAMMA_API_KEY || "";
const ROOT = process.cwd();
const slidesDir = path.join(ROOT, "slides");
const outDir   = path.join(ROOT, "apps", "lessons");
await fs.mkdir(outDir, { recursive: true });

// Generate at most N decks per run to avoid hitting 429 too fast.
// You can raise this later.
const MAX_DECKS_PER_RUN = 2;

// ---------- helpers ----------
function titleFromMd(md, fallback) {
  const m = md.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : fallback;
}
function fileStem(f) { return f.replace(/\.md$/i, ""); }
function niceTitleFromFile(f) {
  // "Day1.md" -> "Day 1" ; "Day1 — RQ.md" -> "Day 1 — RQ"
  const stem = fileStem(f);
  return stem.replace(/^Day(\d+)/, "Day $1");
}

// Minimal viewer; feels slide-like and is readable immediately
function renderLessonHtml(title, mdFile, mdText) {
  const safeMd = mdText
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;"); // just show raw markdown nicely
  return `<!doctype html><meta charset="utf-8">
<title>${title}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;background:#fafafa;color:#111}
.wrap{max-width:980px;margin:30px auto;padding:0 16px}
.hero{background:#fff;border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:16px}
.btn{display:inline-block;background:#0b5fff;color:#fff;padding:8px 12px;border-radius:999px;text-decoration:none;font-weight:800}
pre{background:#0b1020;color:#cbe3ff;padding:14px;border-radius:10px;overflow:auto}
small{color:#666}
.topbar{display:flex;align-items:center;gap:12px;justify-content:space-between}
</style>
<div class="wrap">
  <div class="topbar">
    <strong>SkillNestEdu</strong>
    <div>
      <a class="btn" href="../lessons/">All lessons</a>
      <a class="btn" href="../../${mdFile}" target="_blank" rel="noopener">Open raw Markdown</a>
    </div>
  </div>

  <div class="hero">
    <h1>${title}</h1>
    <p><small>Rendered from <code>/${mdFile}</code>. When Gamma decks are generated, you’ll see “Open deck / PDF” on the lessons index.</small></p>
  </div>

  <h3>Lesson outline (Markdown)</h3>
  <pre>${safeMd}</pre>
</div>`;
}

function renderIndexHtml(cards) {
  return `<!doctype html><meta charset="utf-8">
<title>Boot Camp Lessons — SkillNestEdu</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;background:#fafafa;color:#111}
.wrap{max-width:980px;margin:40px auto;padding:0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.card{background:#fff;border:1px solid #eee;border-radius:12px;padding:14px}
h1{margin-top:0}
a.btn{display:inline-block;background:#0b5fff;color:#fff;padding:8px 12px;border-radius:999px;text-decoration:none;font-weight:800;margin-right:8px}
.badge{display:inline-block;border:1px solid #e5e7eb;border-radius:999px;padding:2px 8px;margin-left:6px;font-size:12px;color:#555}
small{color:#666}
</style>
<div class="wrap">
  <h1>Boot Camp Lessons</h1>
  <p>Decks are generated via Gamma from your outlines in <code>/slides</code>. If a deck hit a rate-limit, you’ll still have the local lesson viewer; try the “Run workflow” button later to refresh Gamma links.</p>
  <div class="grid">
    ${cards.map(c => `
      <div class="card">
        <h3>${c.title}${c.status ? `<span class="badge">${c.status}</span>` : ``}</h3>
        <p>
          <a class="btn" href="${c.viewerHref}">Open lesson</a>
          ${c.gammaUrl ? `<a class="btn" href="${c.gammaUrl}" target="_blank" rel="noopener">Open deck</a>` : ``}
          ${c.pdfUrl   ? `<a class="btn" href="${c.pdfUrl}"   target="_blank" rel="noopener">PDF</a>`        : ``}
        </p>
        <small>Source: <code>/${c.mdPath}</code></small>
      </div>`).join("")}
  </div>
</div>`;
}

// ---------- Gamma API with backoff ----------
async function postJsonWithBackoff(url, body, headers) {
  for (let attempt=0; attempt<6; attempt++) {
    const res = await fetch(url, { method:"POST", headers, body: JSON.stringify(body) });
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      const waitSec = retryAfter || Math.min(60, 5 * 2 ** attempt) + Math.random();
      console.log(`Rate limited (${res.status}). Waiting ~${waitSec.toFixed(1)}s then retrying…`);
      await sleep(waitSec * 1000);
      continue;
    }
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
  throw new Error("Exceeded retries: " + url);
}

async function createGeneration(inputText, title) {
  const body = {
    inputText,
    textMode: "preserve",
    format: "presentation",
    themeName: "Oasis",
    cardSplit: "inputTextBreaks",
    exportAs: "pdf",
    textOptions: { language: "en", amount: "medium" },
    imageOptions: { source: "placeholder" },
    sharingOptions: { workspaceAccess: "view", externalAccess: "view" },
    additionalInstructions: `Title: ${title}. Keep headings concise; avoid rewriting user text.`
  };
  const headers = { "Content-Type": "application/json", "X-API-KEY": API_KEY };
  return postJsonWithBackoff("https://public-api.gamma.app/v0.2/generations", body, headers);
}

async function pollGeneration(id) {
  for (let attempt=0; attempt<120; attempt++) {
    const r = await fetch(`https://public-api.gamma.app/v0.2/generations/${id}`, {
      headers: { "X-API-KEY": API_KEY }
    });
    if (r.status === 429 || r.status >= 500) {
      const retryAfter = Number(r.headers.get("retry-after")) || 0;
      const waitSec = retryAfter || Math.min(60, 2 * 2 ** attempt) + Math.random();
      console.log(`Poll limited (${r.status}). Waiting ~${waitSec.toFixed(1)}s…`);
      await sleep(waitSec * 1000);
      continue;
    }
    const j = await r.json();
    if (j.status === "completed" || j.status === "succeeded") return j;
    if (j.status === "failed") throw new Error("Generation failed: " + JSON.stringify(j));
    await sleep(5000);
  }
  throw new Error("Timed out waiting for generation " + id);
}

// ---------- main ----------
const allMd = (await fs.readdir(slidesDir))
  .filter(f => f.toLowerCase().endsWith(".md"))
  .sort();

if (!allMd.length) {
  console.log("No slides/*.md found; nothing to do.");
  process.exit(0);
}

const cards = [];
let started = 0;

for (const f of allMd) {
  const p = path.join(slidesDir, f);
  const md = await fs.readFile(p, "utf8");
  const title = titleFromMd(md, niceTitleFromFile(f));
  const stem  = fileStem(f).toLowerCase(); // e.g., day1
  const viewer = `day-${stem}.html`;      // avoid collisions, consistent file name
  // write per-lesson viewer (always available)
  await fs.writeFile(path.join(outDir, viewer), renderLessonHtml(title, `slides/${f}`, md), "utf8");

  // default card (no Gamma yet)
  const card = { title, mdPath: `slides/${f}`, viewerHref: `./${viewer}`, gammaUrl: "", pdfUrl: "", status: "" };

  // try Gamma (only if key present and within MAX)
  if (API_KEY && started < MAX_DECKS_PER_RUN) {
    try {
      started++;
      console.log("Generating via Gamma:", f);
      const { generationId } = await createGeneration(md, title);
      const done = await pollGeneration(generationId);
      card.gammaUrl = done?.result?.gammaUrl || "";
      card.pdfUrl   = done?.result?.pdfUrl   || "";
      card.status   = done?.status || "done";
    } catch (e) {
      console.log(`Gamma generation failed for ${f}: ${e.message}`);
      card.status = "throttled";
    }
  } else if (!API_KEY) {
    card.status = "local only";
  } else {
    card.status = "queued";
  }

  cards.push(card);
}

// write index
await fs.writeFile(path.join(outDir, "index.html"), renderIndexHtml(cards), "utf8");
console.log("Wrote apps/lessons/index.html and per-lesson pages");

  
    
 
    
