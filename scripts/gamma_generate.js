/* Node 20 script: generate Gamma decks from slides/*.md */
import fs from "fs/promises";
import path from "path";
import { setTimeout as sleep } from "timers/promises";

const API_KEY = process.env.GAMMA_API_KEY;
if (!API_KEY) {
  console.error("Missing GAMMA_API_KEY");
  process.exit(1);
}

const ROOT = process.cwd();
const slidesDir = path.join(ROOT, "slides");
const outDir = path.join(ROOT, "apps", "lessons");
await fs.mkdir(outDir, { recursive: true });

function niceTitle(fn) {
  return fn.replace(/^Day/,"Day ").replace(/\.md$/,"");
}
function slug(fn) {
  return fn.replace(/\.md$/,"").toLowerCase();
}
function pickUrl(obj, keys) {
  for (const k of keys) {
    const v = k.split(".").reduce((o, p) => (o ? o[p] : undefined), obj);
    if (v) return v;
  }
  return "";
}

async function createGeneration(inputText, title) {
  const body = {
    inputText,
    textMode: "preserve",
    format: "presentation",
    // themeName/cardSplit are optional; safe to keep:
    themeName: "Oasis",
    cardSplit: "inputTextBreaks",
    exportAs: "pdf",
    textOptions: { language: "en", amount: "medium" },
    imageOptions: { source: "placeholder" },
    sharingOptions: { workspaceAccess: "view", externalAccess: "view" },
    additionalInstructions: `Title: ${title}. Keep headings concise; avoid rewriting user text.`,
  };

  const res = await fetch("https://public-api.gamma.app/v0.2/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("POST /generations failed: " + (await res.text()));
  return res.json(); // { generationId }
}

async function pollGeneration(id) {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`https://public-api.gamma.app/v0.2/generations/${id}`, {
      headers: { "X-API-Key": API_KEY },
    });
    if (!r.ok) throw new Error(`GET /generations/${id} failed: ${await r.text()}`);
    const j = await r.json();
    const s = (j.status || "").toLowerCase();
    if (s === "completed" || s === "complete" || s === "succeeded" || j.result) return j;
    if (s === "failed") throw new Error("Generation failed: " + JSON.stringify(j));
    await sleep(5000);
  }
  throw new Error("Timed out waiting for generation " + id);
}

function lessonHtml({ title, shareUrl, pdfUrl }) {
  // Prefer Gamma share URL; fall back to PDF embed
  const iframeSrc = shareUrl || pdfUrl;
  const note = shareUrl ? "" : "<p style='color:#888'>Showing PDF preview because a share URL wasn’t available.</p>";
  return `<!doctype html><meta charset="utf-8">
<title>${title} — SkillNestEdu</title>
<link rel="icon" href="/skillnest-gamma-template/assets/logo-skillnest.png">
<style>
html,body{height:100%;margin:0;background:#0b0b10}
.top{position:fixed;inset:0 0 auto 0;background:#0b0b10;color:#fff;
     font:600 14px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
     padding:10px 14px;display:flex;gap:10px;align-items:center;}
.top a{color:#fff;text-decoration:none;opacity:.85}
.wrap{position:absolute;inset:44px 0 0 0}
iframe{border:0;width:100%;height:100%;}
</style>
<div class="top">
  <a href="/skillnest-gamma-template/apps/lessons/index.html">← All lessons</a>
  <span style="opacity:.7">|</span>
  <a href="/skillnest-gamma-template/enroll.html">Enroll</a>
  ${shareUrl ? `<span style="opacity:.7">|</span><a href="${shareUrl}" target="_blank" rel="noopener">Open in Gamma</a>` : ""}
  ${pdfUrl ? `<span style="opacity:.7">|</span><a href="${pdfUrl}" target="_blank" rel="noopener">PDF</a>` : ""}
</div>
<div class="wrap">
  ${note}
  <iframe src="${iframeSrc}" allow="clipboard-read; clipboard-write"></iframe>
</div>`;
}

const files = (await fs.readdir(slidesDir)).filter(f => f.endsWith(".md")).sort();
const cards = [];

for (const f of files) {
  try {
    const p = path.join(slidesDir, f);
    const txt = await fs.readFile(p, "utf8");
    const title = niceTitle(f);
    console.log("Generating:", f);

    const { generationId } = await createGeneration(txt, title);
    const done = await pollGeneration(generationId);

    // Try multiple shapes:
    const shareUrl = pickUrl(done, [
      "result.urls.share", "result.urls.web", "result.share_url", "result.gammaUrl"
    ]);
    const pdfUrl = pickUrl(done, [
      "result.urls.pdf", "result.pdfUrl"
    ]);

    // Write a dedicated page per lesson
    const fileSlug = slug(f);
    await fs.writeFile(path.join(outDir, `${fileSlug}.html`),
      lessonHtml({ title, shareUrl, pdfUrl }), "utf8");

    cards.push({
      title,
      href: `/skillnest-gamma-template/apps/lessons/${fileSlug}.html`,
      id: generationId,
      shareUrl, pdfUrl
    });
  } catch (e) {
    console.error("Failed for", f, e.message);
  }
}

// Index page
const indexHtml = `<!doctype html><meta charset="utf-8">
<title>Lessons — SkillNestEdu</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;background:#fafafa;color:#111}
.wrap{max-width:980px;margin:40px auto;padding:0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.card{background:#fff;border:1px solid #eee;border-radius:12px;padding:14px}
h1{margin-top:0}a.btn{display:inline-block;background:#0b5fff;color:#fff;padding:8px 12px;border-radius:999px;text-decoration:none;font-weight:800;margin-right:8px}
small{color:#666}
</style>
<div class="wrap">
  <h1>Boot Camp Lessons</h1>
  <p>Decks are generated via Gamma from your outlines in <code>/slides</code>.</p>
  <div class="grid">
    ${cards.map(c => `
      <div class="card">
        <h3>${c.title}</h3>
        <p><a class="btn" href="${c.href}">Open</a>
           ${c.pdfUrl ? `<a class="btn" href="${c.pdfUrl}" target="_blank" rel="noopener">PDF</a>` : ``}
        </p>
        <small>ID: ${c.id}</small>
      </div>`).join("")}
  </div>
</div>`;
await fs.writeFile(path.join(outDir, "index.html"), indexHtml, "utf8");
console.log("Wrote apps/lessons/index.html and per-lesson pages");
