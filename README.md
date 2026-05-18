# Zoom Bot (Playwright)

## What changed for speed/efficiency
- Faster loop defaults with small non-zero polling (`POLL_INTERVAL_MS=30`) to avoid CPU thrash.
- Reduced repeated frame-scanning overhead via configurable frame cap (`MAX_FRAME_SCAN`, default 2).
- Optional OCR mode (`--ocr`) using local `tesseract` binary for fallback state detection (e.g., waiting room text when DOM selectors fail).
- Better message input path: `--message "..."` uses direct textbox fill + Enter (faster/reliable than paste-only).

---

## Prerequisites
- Node.js 18+
- npm
- Chromium dependencies for Playwright
- Optional OCR:
  - `tesseract` CLI installed and available in PATH

### Install tesseract
- Ubuntu/Debian:
  ```bash
  sudo apt-get update
  sudo apt-get install -y tesseract-ocr
  ```
- macOS (Homebrew):
  ```bash
  brew install tesseract
  ```
- Windows (Chocolatey):
  ```powershell
  choco install tesseract
  ```

---

## Setup walkthrough
1. Install dependencies:
   ```bash
   npm install
   ```
2. Install Playwright Chromium (if not already present):
   ```bash
   npx playwright install chromium
   ```
3. (Optional) Confirm OCR support:
   ```bash
   tesseract --version
   ```
4. Run bot with meeting ID:
   ```bash
   node zoom-bot.js 123456789
   ```
5. Run with explicit message input (recommended over clipboard):
   ```bash
   node zoom-bot.js 123456789 --message "hello world"
   ```
6. Run with OCR fallback enabled:
   ```bash
   node zoom-bot.js 123456789 --message "hello" --ocr
   ```

---

## Runtime tuning
Use environment variables:

```bash
REPEAT_SPEED_MS=20 POLL_INTERVAL_MS=30 CHAT_DISCOVERY_TIMEOUT_MS=120000 MAX_FRAME_SCAN=2 node zoom-bot.js 123456789 --message "ping"
```

- `REPEAT_SPEED_MS`: delay between sends (higher = slower, lower CPU/network burst)
- `POLL_INTERVAL_MS`: UI polling interval
- `CHAT_DISCOVERY_TIMEOUT_MS`: max wait for chat input
- `MAX_FRAME_SCAN`: number of frames scanned per cycle
- `MAX_RUNTIME_MS`: hard runtime cap; bot exits once reached (0 = disabled)
- `MAX_MESSAGES`: total messages to send before exiting (0 = disabled)
- `MAX_RESTART_CYCLES`: max waiting-room/removal restart cycles (0 = disabled)
- `GRACEFUL_SHUTDOWN_MS`: delay before final process exit after stop request

---

## Failsafes and run controls

The bot now supports explicit stop controls so it can shut down safely instead of running forever:

```bash
node zoom-bot.js 123456789 \
  --message "ping" \
  --max-messages 25 \
  --max-runtime-sec 600 \
  --max-restarts 5
```

Optional flags:
- `--max-messages <N>`: stop after N sent messages.
- `--max-runtime-sec <N>`: stop after N seconds.
- `--max-restarts <N>`: stop after N restart cycles triggered by waiting-room/removal detection.
- `--stop-at <ISO-8601>`: stop at a specific absolute UTC/local timestamp (example: `2026-05-18T20:30:00Z`).

Signals:
- `SIGINT` / `SIGTERM` trigger a graceful stop path (browser closes cleanly, then process exits).

---

## Notes
- OCR is fallback-only; normal DOM selector flow is still primary and faster.
- If `--message` is not provided, bot falls back to clipboard paste (`Ctrl/Cmd+V`) then Enter.

---

## Telegram Bot + Docker Compose

You can run a Telegram relay bot that accepts a Zoom link or meeting ID and launches `zoom-bot.js` automatically.

### 1) Configure env
```bash
cp .env.example .env
# then edit .env and set TELEGRAM_BOT_TOKEN
```

### 2) Build and run
```bash
docker compose up --build -d
```

### 3) Use from Telegram
Send your bot either:
- `/join 1234567890`
- `https://zoom.us/j/1234567890`
- `https://app.zoom.us/wc/1234567890/join`

The bot will respond when a run starts and when it finishes.

### Notes
- This container uses the official Playwright image (Chromium + dependencies preinstalled).
- One active zoom run per Telegram chat is allowed at a time.
