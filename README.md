# Tender Document Package Builder

**Name:** Md. Shehab Al Rabby  
**Registration ID:** 232-15-467  
**Live URL:** https://devfest-232-15-467.vercel.app/  
**Repository:** https://github.com/shehabRabby/devfest-232-15-467

## Overview

Prepare, validate, and package tender documents entirely in the browser.

## Main Features

- requirements.json loading, multi-PDF upload, PDF page counting, and SHA-256 duplicate detection.
- One-to-one requirement matching, expiry-date validation, and live requirement statuses.
- English/Bangla UI and browser-only PDF package generation.
- English cover page, correct document ordering, all matched pages preserved, and a Page X of Y footer.
- Vercel deployment support.

## Bonus Features

None — main requirements were prioritized.

## How to Run

```sh
npm install
npm run dev
```

## Known Problems

No known critical issues.

## AI Tools Used

- ChatGPT
- Codex

## Most Useful Prompt

```text
"Implement browser-only tender PDF package generation with an English cover page, requirements sorted by order, all matched PDF pages preserved, optional unmatched documents skipped, and a readable <tender_id> | Page X of Y footer on every page."
```
