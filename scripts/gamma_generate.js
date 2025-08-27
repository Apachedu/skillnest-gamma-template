/* Node 20 script: generate Gamma decks from slides/*.md  */
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

async function createGeneration(inputText, title){
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

  const res = await fetch("https://public-api.gamma.app/v0.2/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("POST /generations failed: " + t);
  }
  return res.json(); // contains generationId
}

async function pollGeneration(id){
  for (let i=0;i<60;i++){
    const r = await fetch(`https://public-api.gamma.app/v0.2/generations/${id}`, {
      headers: { "X-API-KEY": API_KEY }
    });
    const j = await r.json();
    if (j.status === "completed" || j.status === "succeeded") return j;
    if (j.status === "failed") throw new Error("Generation failed: " + JSON.stringify(j));
    await sleep(5000);
  }
  throw new Error("Timed out waiting for generation " + id);
}

function niceTitle(fn){
  return fn.replace(/^Day/,"Day ").replace(/\.md$/,"");
}

const files = (await fs.readdir(slidesDir)).filter(f=>f.endsWith(".md")).sort();
const results = [];
for (const f of files){
  const p = path.join(slidesDir, f);
  const txt = await fs.readFile(p, "utf8");
  console.log("Generating:", f);
  const { generationId } = await createGeneration(txt, niceTitle(f));
  const done = await pollGeneration(generationId);
  results.push({
    file: f,
    id: generationId,
    status: done.status,
    gammaUrl: done?.result?.gammaUrl || "",
    pdfUrl: done?.result?.pdfUrl || "",
    pptxUrl: done?.result?.pptxUrl || ""
  });
}

const html = `<!doctype html><meta charset="utf-8">
<title>Lessons — SkillNestEdu</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;background:#fafafa;color:#111}
.wrap{max-width:980px;margin:40px auto;padding:0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.card{background:#fff;border:1px solid #eee;border-radius:12px;padding:14px}
h1{margin-top:0}a.btn{display:inline-block;background:#0b5fff;color:#fff;padding:8px 12px;border-radius:999px;text-decoration:none;font-weight:800;margin-right:8px}
small{color:#666}</style>
<div class="wrap">
  <h1>Boot Camp Lessons</h1>
  <p>These decks were generated via Gamma API from your outlines.</p>
  <div class="grid">
  ${results.map(r=>`
    <div class="card">
      <h3>${niceTitle(r.file)}</h3>
      <p><a class="btn" href="${r.gammaUrl}" target="_blank" rel="noopener">Open deck</a>
         ${r.pdfUrl ? `<a class="btn" href="${r.pdfUrl}" target="_blank" rel="noopener">PDF</a>` : ``}
      </p>
      <small>ID: ${r.id}</small>
    </div>`).join("")}
  </div>
</div>`;
await fs.writeFile(path.join(outDir, "index.html"), html, "utf8");
console.log("Wrote apps/lessons/index.html");
