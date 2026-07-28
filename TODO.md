# Fix Plan

## Critical Bugs

- [ ] **Fix 1** - `sentMessages` race condition in `zoom-bot.js`: Atomic increment with `tryClaimMessage()` helper
- [ ] **Fix 2** - xvfb-run detection broken on Windows in `telegram-bot.js`: Check platform + use `status === 0`
- [ ] **Fix 3** - Missing `tesseract-ocr` in `Dockerfile`
- [ ] **Fix 4** - Tesseract availability race condition in `zoom-bot.js`: Use sync `execFileSync` check
- [ ] **Fix 5** - Missing `.env.example` file

## Improvements

- [ ] **Improvement 1** - Make OCR check interval configurable via `OCR_CHECK_INTERVAL_MS` env var

