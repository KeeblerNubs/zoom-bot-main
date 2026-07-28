# Zoom Bot - Setup & Running Guide

## ✓ Status: Ready to Run

All dependencies are installed and both scripts are validated. Here's how to get started:

---

## Quick Start

### Option 1: Run Zoom Bot Directly
```powershell
# Interactive mode (prompts for meeting ID)
node zoom-bot.js

# With meeting ID and message
node zoom-bot.js 123456789 --message "hello world" --name "MyBot"

# With multiple parallel shells
node zoom-bot.js 123456789 --message "hello" --headless-shells 3

# With passcode
node zoom-bot.js 123456789 --message "hello" --passcode "123456"
```

### Option 2: Run Telegram Bot Relay
```powershell
# Requires TELEGRAM_BOT_TOKEN in .env
node telegram-bot.js
```

Telegram users can then send Zoom links/meeting IDs to the bot, and it will:
1. Ask for a display name
2. Ask for a message to send in Zoom chat
3. Launch the Zoom bot with those parameters

---

## Environment Setup

The `.env` file is already configured with:
- `TELEGRAM_BOT_TOKEN` - Active bot token
- `ZOOM_CHAT_MESSAGE` - Default chat message
- `REPEAT_SPEED_MS=20` - Speed of message sends
- `POLL_INTERVAL_MS=30` - UI polling interval
- `CHAT_DISCOVERY_TIMEOUT_MS=120000` - Wait time for chat
- `MAX_FRAME_SCAN=2` - Frame scanning optimization

---

## Advanced Options

### Environment Variables
```powershell
# Set environment variables before running
$env:REPEAT_SPEED_MS = 50
$env:USE_CLOAK_BROWSER = "false"
$env:STEALTH_MODE = "false"

node zoom-bot.js 123456789 --message "test"
```

### Command-line Arguments (zoom-bot.js)
- `<meeting-id>` - Zoom meeting ID (9+ digits)
- `--name <name>` - Display name in Zoom (default: random)
- `--message <msg>` - Message to send in chat
- `--passcode <code>` - Meeting passcode
- `--headless-shells <N>` - Number of parallel browsers (default: 1)
- `--max-messages <N>` - Stop after N messages
- `--max-runtime-sec <S>` - Stop after S seconds
- `--max-restarts <N>` - Stop after N restart cycles
- `--no-ocr` - Disable OCR fallback
- `--no-cloak-browser` - Use Playwright Chromium instead
- `--no-stealth` - Disable stealth mode
- `--chrome` - Use system Chrome browser

---

## Troubleshooting

### Issue: "tesseract not found" warning
**Status:** ✓ This is expected and handled gracefully
- OCR will be disabled, but the bot will still work
- To enable OCR, install tesseract:
  ```powershell
  # Using Chocolatey
  choco install tesseract
  
  # Or download from https://github.com/UB-Mannheim/tesseract/wiki
  ```

### Issue: "CloakBrowser not installed" error
**Solution:** The bot will automatically use Playwright Chromium
- Or install CloakBrowser: `npm install cloakbrowser`

### Issue: Meeting shows "waiting room" or "removed"
**Status:** ✓ Bot automatically handles this
- It will restart and retry the meeting join process
- Use `--max-restarts 5` to limit restart attempts

### Issue: Chat input not found
- Increase timeout: `CHAT_DISCOVERY_TIMEOUT_MS=180000`
- Disable OCR: `node zoom-bot.js <id> --no-ocr`
- Try system Chrome: `node zoom-bot.js <id> --chrome`

---

## Testing

```powershell
# Validate syntax
npm test

# Test with a real Zoom meeting
node zoom-bot.js 123456789 --message "test from zoom-bot" --name "TestBot"
```

---

## Notes

- **Browser:** Uses CloakBrowser by default (stealth + humanized behavior)
- **Headless:** Runs without visual UI (faster, more efficient)
- **Multiple shells:** Each shell independently joins and sends messages
- **Graceful shutdown:** Responds to SIGTERM/SIGINT signals
- **Restart logic:** Automatically recovers from waiting room/removal

---

## Next Steps

1. **Test with a Zoom meeting ID:**
   ```powershell
   node zoom-bot.js 123456789 --message "Hello Zoom!" --name "Copilot"
   ```

2. **Use via Telegram relay:**
   ```powershell
   node telegram-bot.js
   ```
   Then send a Zoom link to the bot via Telegram

3. **Run with advanced options:**
   ```powershell
   $env:REPEAT_SPEED_MS = 100
   node zoom-bot.js 123456789 --message "slow test" --headless-shells 2 --max-messages 5
   ```

---

**Status:** ✅ All systems ready!
