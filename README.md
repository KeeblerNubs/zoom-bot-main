# Zoom Bot (Playwright)

## What changed for speed/efficiency
- Faster loop defaults with small non-zero polling (`POLL_INTERVAL_MS=30`) to avoid CPU thrash.
- Reduced repeated frame-scanning overhead via configurable frame cap (`MAX_FRAME_SCAN`, default 2).
- OCR is enabled by default using the local `tesseract` binary for fallback state detection (e.g., waiting room text when DOM selectors fail).
- Better message input path: `--message "..."` uses direct textbox fill + Enter (faster/reliable than paste-only).

---

## Prerequisites
- Node.js 18+
- npm
- Chromium dependencies for Playwright
- OCR support:
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
3. Confirm OCR support:
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
6. Run with multiple parallel headless browser shells:
   ```bash
   node zoom-bot.js 123456789 --message "hello" --headless-shells 3
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
- OCR is enabled by default for fallback state detection; normal DOM selector flow is still primary and faster.
- If `--message` is not provided, bot falls back to clipboard paste (`Ctrl/Cmd+V`) then Enter.

---


## AWS Ubuntu Server setup (EC2)

Use this if you want the bot running 24/7 on an Ubuntu EC2 instance.

### 1) Create/connect to server
- Launch an **Ubuntu 22.04 or 24.04** EC2 instance.
- SSH in:
  ```bash
  ssh -i /path/to/key.pem ubuntu@<EC2_PUBLIC_IP>
  ```

### 2) Install system dependencies
```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates
```

Install Node.js 20 LTS:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

### 3) Clone and install app
```bash
git clone <YOUR_REPO_URL>
cd zoom-bot-main
npm ci
```

Install Playwright Chromium + Linux deps:
```bash
npx playwright install --with-deps chromium
```

OCR support:
```bash
sudo apt-get install -y tesseract-ocr
```

### 4) Configure environment
```bash
cp .env.example .env
nano .env
```
Set at least `TELEGRAM_BOT_TOKEN` in `.env` for Telegram mode.

### 5) Smoke test
```bash
node telegram-bot.js
```
Press `Ctrl+C` after verifying startup logs.

### 6) Run as a systemd service (recommended)
Create `/etc/systemd/system/zoom-telegram-bot.service`:
```ini
[Unit]
Description=Zoom Telegram Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/zoom-bot-main
Environment=NODE_ENV=production
EnvironmentFile=/home/ubuntu/zoom-bot-main/.env
ExecStart=/usr/bin/node /home/ubuntu/zoom-bot-main/telegram-bot.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable zoom-telegram-bot
sudo systemctl start zoom-telegram-bot
```

Check logs/status:
```bash
sudo systemctl status zoom-telegram-bot
journalctl -u zoom-telegram-bot -f
```

### 7) Open security group rules
- Inbound SSH (22) from your IP only.
- No inbound HTTP ports are required for polling-based Telegram mode.

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


### Slash commands (Settings, Controls, Special Features)
The Telegram bot supports slash commands to configure runtime behavior per chat:

- `/settings` — view current settings
- `/ocr on|off` — OCR is always used for Zoom launches; `off` is accepted only for compatibility
- `/headless_shells <N>` — choose how many headless browser shells run in parallel (minimum `1`)
- `/max_messages <N>` — stop after N sent messages (`0` disables)
- `/max_runtime <seconds>` — stop after N seconds (`0` disables)
- `/max_restarts <N>` — stop after N restart cycles (`0` disables)
- `/status` — check whether a run is active
- `/stop` — stop the active run

These settings are chat-scoped and applied to the next `/join` launch.

### Notes
- This container uses the official Playwright image (Chromium + dependencies preinstalled).
- One active zoom run per Telegram chat is allowed at a time.


### Troubleshooting: `Cannot find module 'dotenv/config'` in systemd logs
If your unit sets `NODE_OPTIONS=--require dotenv/config`, remove that line. The bot now loads `.env` on startup without preloading `dotenv/config`. Keep `EnvironmentFile=/home/ubuntu/zoom-bot-main/.env` in the unit instead.
