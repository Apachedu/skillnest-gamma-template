# SkillNestEdu • First-Party Interactives + Gamma Deck (CI)

This repo:
- serves **first-party** mini-apps at `/apps/...` (you deploy via SFTP)
- generates a **Gamma deck** via the **beta Generate API** on each push to `main`
- can **export PDF/PPTX** via API and stores them as CI artifacts
- supports **batch generation** via `batches/decks.csv`

## 1) What you set in GitHub Secrets
Required:
- `HOST` → e.g. `https://learn.skillnestedu.com`
- `GAMMA_API_KEY` → from your Gamma account (Pro; Generate API is beta)

For SFTP (choose one auth):
- `SFTP_HOST` `SFTP_USER` `SFTP_DEST` (e.g. `/public_html`)
- Either `SFTP_PRIVATE_KEY` (preferred) **or** `SFTP_PASS` (fallback)

Optional (GitHub **Variables**):
- `DECK_FORMAT` = `presentation` or `webpage` (default `presentation`)
- `THEME_NAME`  = e.g. `Oasis`, `Minimal`
- `EXPORT_AS`   = `pdf` or `pptx` (returns file URLs via GET; links are time-limited)  
- `BATCH_CSV`   = `batches/decks.csv` to generate multiple decks in one run

> Gamma API is **beta**: rate limits & fields may change. Poll ~5s; `exportAs` currently supports `pdf` or `pptx`. :contentReference[oaicite:1]{index=1}

## 2) Edit your deck copy
Update **deck.md**. Use `{{HOST}}` placeholder; CI replaces it at runtime.

## 3) Trigger it
Push to `main`. The workflow:
1. uploads `/apps` via SFTP
2. calls the Gamma Generate API
3. prints the Deck URL and, if requested, export file URLs  
4. downloads export(s) into `downloads/` and uploads them as artifacts

## 4) Batch (optional)
Edit `batches/decks.csv` and set GitHub Variable `BATCH_CSV=batches/decks.csv`.

## 5) Local test (optional)
```bash
export HOST="https://yourdomain"
export GAMMA_KEY="sk-gamma-…"
node scripts/gamma_generate.js

