# Zoom Bot (CloakBrowser + Playwright)

## What changed for speed/efficiency
- Faster loop defaults with small non-zero polling (`POLL_INTERVAL_MS=30`) to avoid CPU thrash.
- Reduced repeated frame-scanning overhead via configurable frame cap (`MAX_FRAME_SCAN`, default 2).
- OCR is enabled by default using the local `tesseract` binary for fallback state detection (e.g., waiting room text when DOM selectors fail).
- Better message input path: `--message "..."` uses direct textbox fill + Enter (faster/reliable than paste-only).

---

## Prerequisites
- Node.js 20+
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
- Windows (Pre-installed at default location):
  ```powershell
  # Already installed at: C:\Program Files\Tesseract-OCR
  # Add to PATH (run as Administrator or update user PATH):
  $env:Path += ";C:\Program Files\Tesseract-OCR"
  [Environment]::SetEnvironmentVariable("Path", $env:Path, "User")
  
  # Verify installation:
  tesseract --version
  ```
- Windows (Chocolatey, if not already installed):
  ```powershell
  choco install tesseract
  ```

---

## Setup walkthrough
1. Install dependencies:
   ```bash
   npm install
   ```
2. CloakBrowser is the default browser backend and auto-downloads its stealth Chromium binary on first launch. If you disable it, install Playwright Chromium:
   ```bash
   USE_CLOAK_BROWSER=false npx playwright install chromium
   ```
3. Confirm OCR support (Windows may need PATH refresh):
   ```bash
   refreshenv  # PowerShell only
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
- `USE_CLOAK_BROWSER=true|false`: use CloakBrowser stealth Chromium by default; equivalent opt-out CLI flag: `--no-cloak-browser`
- `CLOAK_HUMANIZE=true|false`: enable/disable CloakBrowser human-like mouse/keyboard/scroll behavior (enabled by default); equivalent opt-out CLI flag: `--no-humanize`
- `CLOAK_GEOIP=true|false`: ask CloakBrowser to align timezone/locale with the configured proxy IP (disabled by default because it performs external IP lookups through the proxy)
- `CLOAKBROWSER_LICENSE_KEY`: optional CloakBrowser Pro license key used by the `cloakbrowser` package when fetching the browser binary
- `USE_SYSTEM_CHROME=true`: launch the locally installed Google Chrome browser instead of CloakBrowser/Playwright Chromium; equivalent CLI flag: `--chrome` and implies the Playwright backend
- `STEALTH_MODE=true|false`: enable/disable Chrome stealth hardening (enabled by default); equivalent opt-out CLI flag: `--no-stealth`
- `PROTONVPN_PROXY_SERVER`: optional Proton VPN proxy endpoint for Chrome traffic (example: `socks5://127.0.0.1:1080` or `http://host:port`). If your Proton VPN app already runs a system-wide tunnel, leave this unset.
- `PROTONVPN_PROXY_USERNAME` / `PROTONVPN_PROXY_PASSWORD`: optional proxy credentials when your Proton VPN proxy endpoint requires them.

### CloakBrowser + Proton VPN

CloakBrowser is enabled by default and runs its patched Chromium binary through the same Playwright-style automation flow. To route CloakBrowser traffic through a Proton VPN proxy endpoint:

```bash
PROTONVPN_PROXY_SERVER=socks5://127.0.0.1:1080 \
CLOAK_HUMANIZE=true \
node zoom-bot.js 123456789 --message "ping"
```

If you use the Proton VPN desktop/client app in full-tunnel mode, start/connect Proton VPN before launching the bot and omit `PROTONVPN_PROXY_SERVER`; CloakBrowser will use the system VPN route. To fall back to standard Playwright Chromium, pass `--no-cloak-browser` or set `USE_CLOAK_BROWSER=false`.

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

**Control flags:**
- `--max-messages <N>`: stop after N sent messages (default: 0 = no limit).
- `--max-runtime-sec <N>`: stop after N seconds (default: 0 = no limit).
- `--max-restarts <N>`: stop after N restart cycles triggered by waiting-room/removal detection (default: 2 = graceful shutdown).
- `--stop-at <ISO-8601>`: stop at a specific absolute UTC/local timestamp (example: `2026-05-18T20:30:00Z`).

**Default behavior:** Bot will restart up to **2 times** before exiting gracefully. Override with `--max-restarts 0` to allow infinite restarts (not recommended).

Signals:
- `SIGINT` / `SIGTERM` trigger a graceful stop path (browser closes cleanly, then process exits).

---

## Notes
- **OCR is enabled by default** for fallback state detection; normal DOM selector flow is still primary and faster.
- **Message delivery is guaranteed** — `--message` uses direct text input + Enter (no clipboard dependency).
- **Graceful shutdown** — bot exits cleanly after `--max-restarts` (default: 2) instead of running forever.
- If `--message` is not provided, bot prompts interactively with fallback to `ZOOM_CHAT_MESSAGE` env var or default "Hey there!".

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

---

## Docker WireGuard VPN support

The Docker image includes `wireguard-tools` and starts the bot through `docker-entrypoint.sh`. WireGuard is disabled by default so the container continues to run normally unless you opt in.

> Do not commit real WireGuard configs. They contain a `PrivateKey`, which should be treated like a password. If a private key was shared, rotate/regenerate the VPN profile before using it.

### Enable WireGuard with a base64 config

1. Put your WireGuard config in a local file outside git, for example `./private/wg0.conf`.
2. Export it as base64:
   ```bash
   export WIREGUARD_CONFIG_B64="$(base64 -w0 ./private/wg0.conf)"
   ```
3. Start the container with WireGuard enabled:
   ```bash
   WIREGUARD_ENABLED=true docker compose up -d --build
   ```

The entrypoint writes `WIREGUARD_CONFIG_B64` to `/etc/wireguard/wg0.conf`, runs `wg-quick up wg0`, then starts `telegram-bot.js`.

### Enable WireGuard by mounting a config file

Alternatively, mount a local config at `/etc/wireguard/wg0.conf`:

```yaml
services:
  telegram-zoom-bot:
    volumes:
      - ./private/wg0.conf:/etc/wireguard/wg0.conf:ro
    environment:
      WIREGUARD_ENABLED: "true"
```

The compose file already grants the container the `/dev/net/tun` device, `NET_ADMIN`, and the `net.ipv4.conf.all.src_valid_mark=1` sysctl required by common WireGuard `wg-quick` routes.

A placeholder config is available at `wireguard/wg0.conf.example`; copy it to a private path and replace the placeholders with a freshly generated VPN profile.
