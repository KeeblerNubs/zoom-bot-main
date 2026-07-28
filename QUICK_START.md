# QUICK START - ZOOM BOT

## ✅ All Systems Ready!

Your zoom-bot project is fully configured and ready to run.

---

## Quick Commands

### 📌 Run Zoom Bot
```powershell
# Interactive mode (will ask for meeting ID)
node zoom-bot.js

# With meeting ID
node zoom-bot.js 123456789 --message "Hello!" --name "Bot"

# Multiple shells (faster message sending)
node zoom-bot.js 123456789 --message "Hello!" --headless-shells 3
```

### 💬 Run Telegram Relay Bot
```powershell
node telegram-bot.js
```
Users send Zoom links to Telegram bot → bot joins Zoom and sends chat messages

### ✓ Validate Code
```powershell
npm test
```

---

## Launcher Scripts

**PowerShell:** `.\run.ps1` (interactive menu)
**Command Prompt:** `run.bat` (interactive menu)

---

## Configuration

✅ `.env` file is configured with:
- Telegram bot token (active)
- Default chat message
- Performance tuning (repeat speed, poll interval, etc.)

---

## What You Get

✓ **Zoom Bot** - Joins Zoom meetings and sends chat messages
  - Headless browser automation
  - Stealth mode (CloakBrowser)
  - Multiple parallel shells support
  - Automatic restart on waiting room/removal
  - Message limits & runtime limits
  
✓ **Telegram Relay** - Control Zoom bot via Telegram
  - Send Zoom link/meeting ID
  - Specify display name
  - Specify chat message
  - Real-time status updates

✓ **Performance Tuning**
  - Configurable message repeat speed
  - Frame scanning optimization
  - Chat discovery timeout
  - Max runtime/messages/restarts

---

## Example Usage

```powershell
# Basic test (interactive)
node zoom-bot.js

# With all options
node zoom-bot.js 3142837425 \
  --message "Hello from automation!" \
  --name "AutoBot" \
  --headless-shells 2 \
  --max-messages 10

# Set environment variables for tuning
$env:REPEAT_SPEED_MS = 100
$env:USE_CLOAK_BROWSER = "true"
node zoom-bot.js 3142837425 --message "Slower sends"
```

---

## Advanced Features

- **Passcode support:** `--passcode 123456`
- **Runtime limits:** `--max-runtime-sec 300`
- **Message limits:** `--max-messages 50`
- **Restart limits:** `--max-restarts 3`
- **Browser choice:** `--chrome` or `--no-cloak-browser`
- **Stealth mode:** `--no-stealth`

---

## Support

See `SETUP.md` for full documentation and troubleshooting.
See `README.md` for detailed configuration options.

---

**Status:** 🟢 Ready to run!
**Next:** Run `node zoom-bot.js` or `.\run.ps1` to get started.
