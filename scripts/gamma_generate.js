/* Node 20 script: generate Gamma decks from slides/*.md
   - If GAMMA_API_KEY is set, it will try Gamma.
   - If Gamma returns 429/any error OR no key, it still builds local lesson pages.
*/
import fs from "fs/promises";
import path from "path";
import { setTimeout as sleep } from "timers/promises";

const API_KEY = process.env.GAMMA_API_KEY || "";
const ROOT = process.cwd();
const slidesDir = path.join(ROOT, "slides");
const outDir = path.join(ROOT, "apps", "lessons");

await fs.mkdir(outDir, { recursive: true });

function niceTitle(fileName, md) {
  const h1 = md.split("\n").find(l => /^#\s+/.test(l));
  if (h1) return h1.replace(/^#\s+/, "").trim();
  return fileName.replace(/\.md$/, "").replace(/^Day/, "Day ");
}

async function tryGamma(inputText, title) {
  if (!API_KEY) return { ok: false, reason: "no-key" };

  // Gamma v0.2 generation
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

  // simple retry for 429
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://public-api.gamma.app/v0.2/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      if (attempt === 3) return { ok: false, reason: "rate-limit" };
      await sleep(3000 * attempt);
      continue;
    }
    if (!res.ok) {
      const txt = await res.text().catch(()=>"");
      return { ok: false, reason: `http-${res.status}`, detail: txt };
    }
    const { generationId } = await res.json();

    // Poll
    for (let i = 0; i < 60; i++) {
      const p = await fetch(`https://public-api.gamma.app/v0.2/generations/${generationId}`, {
        headers: { "X-API-KEY": API_KEY }
      });
      if (!p.ok) break;
      const j = await p.json();
      if (j.status === "completed" || j.status === "succeeded") {
        return {
          ok: true,
          id: generationId,
          gammaUrl: j?.result?.gammaUrl || "",
          pdfUrl: j?.result?.pdfUrl || "",
          pptxUrl: j?.result?.pptxUrl || "",
        };
      }
      if (j.status === "failed") return { ok: false, reason: "failed" };
      await sleep(3000);
    }
    return { ok: false, reason: "timeout" };
  }
  return { ok: false, reason: "unknown" };
}

function lessonPageHTML(title, markdown, gammaLink="") {
  // Client-side render with marked (no build step)
  return `<!doctype html><meta charset="utf-8">
<title>${title}</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;background:#fafafa;color:#111}
  .wrap{max-width:980px;margin:24px auto;padding:0 16px}
  .btn{display:inline-block;background:#0b5fff;color:#fff;padding:8px 12px;border-radius:999px;text-decoration:none;font-weight:800;margin-right:8px}
  .bar{display:flex;gap:10px;align-items:center;justify-content:space-between;margin:8px 0 20px 0}
  .md h1{margin-top:0}
</style>
<div class="wrap">
  <div class="bar">
    <div><a href="./" class="btn" style="background:#111">All lessons</a></div>
    ${gammaLink ? `<a class="btn" href="${gammaLink}" target="_blank" rel="noopener">Open Gamma deck</a>` : ``}
  </div>
  <div id="out" class="md"></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script>
  const md = ${JSON.stringify(markdown)};
  document.getElementById('out').innerHTML = marked.parse(md);
</script>`;
}

function lessonsIndexHTML(cards) {
  return `<!doctype html><meta charset="utf-8">
<title>Boot Camp Lessons</title>
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
  <p>These pages are built from your Markdown in <code>/slides</code>. If the Gamma API is available, each card will also show a deck link.</p>
  <div class="grid">
    ${cards.map(c => `
      <div class="card">
        <h3>${c.title}</h3>
        <p>
          <a class="btn" href="${c.localHref}">Open lesson</a>
          ${c.gammaUrl ? `<a class="btn" href="${c.gammaUrl}" target="_blank" rel="noopener">Gamma deck</a>` : ``}
        </p>
        <small>${c.file}</small>
      </div>
    `).join("")}
  </div>
</div>`;
}

async function run() {
  const files = (await fs.readdir(slidesDir)).filter(f => f.endsWith(".md")).sort();
  const cards = [];

  for (const f of files) {
    const p = path.join(slidesDir, f);
    const md = await fs.readFile(p, "utf8");
    const title = niceTitle(f, md);

    let gammaUrl = "";
    if (API_KEY) {
      const g = await tryGamma(md, title);
      if (g.ok && g.gammaUrl) gammaUrl = g.gammaUrl;
      else console.log(`Gamma skipped for ${f}:`, g.reason || "unknown");
    }

    const base = f.replace(/\.md$/, "").toLowerCase();
    const localName = `${base}.html`;
    await fs.writeFile(path.join(outDir, localName), lessonPageHTML(title, md, gammaUrl), "utf8");

    cards.push({
      title,
      file: f,
      localHref: `./${localName}`,
      gammaUrl
    });
  }

  await fs.writeFile(path.join(outDir, "index.html"), lessonsIndexHTML(cards), "utf8");
  console.log("Wrote apps/lessons/index.html and per-lesson pages");
}

await run().catch(e => {
  console.error("Generator failed:", e);
  process.exit(0); // never break the deploy
});
