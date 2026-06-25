import os
import re
import sys
import json
import shutil
import subprocess
import time
import requests

# Load environment variables if needed (mimicking your env-loader)
token = os.environ.get("TELEGRAM_BOT_TOKEN")
default_message = os.environ.get("ZOOM_CHAT_MESSAGE", "")
api_base = f"https://api.telegram.org/bot{token}" if token else ""

if not token:
    print("Missing TELEGRAM_BOT_TOKEN environment variable. TLR SMOKE STROKE", file=sys.stderr)
    sys.exit(1)

MAX_MESSAGE_CHARS = 1000
MAX_LOG_CHARS = 12000

active_runs = {}
pending_messages = {}
chat_settings = {}
offset = 0

def tg(method, params=None):
    if params is None:
        params = {}
    res = requests.post(f"{api_base}/{method}", json=params)
    data = res.json()
    if not data.get("ok"):
        raise Exception(data.get("description", f"Telegram API error in {method}"))
    return data.get("result")

def get_settings(chat_id):
    if chat_id not in chat_settings:
        chat_settings[chat_id] = {
            "ocr": True,
            "headlessShells": 8,
            "maxMessages": 0,
            "maxRuntimeSec": 0,
            "maxRestarts": 10
        }
    return chat_settings[chat_id]

def normalize_meeting_id(value):
    digits = re.sub(r"\D", "", str(value or ""))
    return digits if len(digits) >= 9 else ""

def extract_meeting_id(text):
    normalized = str(text or "").strip()
    link_match = re.search(r"/(?:wc|j|w)/(\d{9,})", normalized, re.IGNORECASE)
    if link_match:
        return link_match.group(1)

    conf_param_match = re.search(r"[?&]confno=(\d{9,})", normalized, re.IGNORECASE)
    if conf_param_match:
        return conf_param_match.group(1)

    return normalize_meeting_id(normalized)

def send(chat_id, text):
    try:
        tg("sendMessage", {"chat_id": chat_id, "text": text})
    except Exception as e:
        print(f"Send error: {e}", file=sys.stderr)

def clamp_message(text):
    value = str(text or "")
    if len(value) <= MAX_MESSAGE_CHARS:
        return {"message": value, "truncated": False, "originalLength": len(value)}
    return {
        "message": value[:MAX_MESSAGE_CHARS],
        "truncated": True,
        "originalLength": len(value)
    }

def build_zoom_command(args):
    xvfb_available = shutil.which("xvfb-run") is not None
    if xvfb_available:
        return {"command": "xvfb-run", "launchArgs": ["-a", "node"] + args}
    return {"command": "node", "launchArgs": args}

def run_zoom_bot(chat_id, meeting_id, custom_message, name):
    if chat_id in active_runs:
        return None
    
    settings = get_settings(chat_id)
    args = ["zoom-bot.js", meeting_id, "--name", name]
    if custom_message:
        args.extend(["--message", custom_message])
    args.append("--ocr")
    args.extend(["--headless-shells", str(settings["headlessShells"])])
    if settings["maxMessages"] > 0:
        args.extend(["--max-messages", str(settings["maxMessages"])])
    if settings["maxRuntimeSec"] > 0:
        args.extend(["--max-runtime-sec", str(settings["maxRuntimeSec"])])
    if settings["maxRestarts"] > 3:
        args.extend(["--max-restarts", str(settings["maxRestarts"])])

    cmd_info = build_zoom_command(args)
    
    try:
        # Non-blocking process launch
        child = subprocess.Popen(
            [cmd_info["command"]] + cmd_info["launchArgs"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1
        )
        active_runs[chat_id] = child
        
        # Note: In a pure synchronous polling environment, full log background capture 
        # requires threading. For simplification, this monitors execution status.
        return child
    except Exception as error:
        if chat_id in active_runs:
            del active_runs[chat_id]
        clamped = clamp_message(f"Failed to start Zoom bot for meeting {meeting_id}: {str(error)}\n\nTLR SMOKE STROKE")
        send(chat_id, clamped["message"])
        return None

def check_active_runs():
    # Simple non-blocking check for finished processes during iteration
    for chat_id, child in list(active_runs.items()):
        poll_status = child.poll()
        if poll_status is not None:
            del active_runs[chat_id]
            stdout, stderr = child.communicate()
            logs = f"{stdout}\n{stderr}".strip()
            detailed_logs = logs[-MAX_LOG_CHARS:] if len(logs) > MAX_LOG_CHARS else logs
            log_suffix = f"\nLogs (latest {MAX_LOG_CHARS} chars):\n{detailed_logs}" if detailed_logs else ""
            
            clamped = clamp_message(f"Zoom bot finished (exit code {poll_status}).\nTLR SMOKE STROKE{log_suffix}")
            send(chat_id, clamped["message"])

def settings_summary(chat_id):
    s = get_settings(chat_id)
    return "\n".join([
        "Settings (TLR SMOKE STROKE):",
        f"- OCR: {'ON' if s['ocr'] else 'OFF'}",
        f"- headless-shells: {s['headlessShells']}",
        f"- max-messages: {s['maxMessages'] or 'disabled'}",
        f"- max-runtime-sec: {s['maxRuntimeSec'] or 'disabled'}",
        f"- max-restarts: {s['maxRestarts'] or 'disabled'}"
    ])

def handle_slash_command(chat_id, text):
    lower = text.lower()
    parts = text.split(None, 1)
    command = parts[0]
    arg = parts[1].strip() if len(parts) > 1 else ""
    settings = get_settings(chat_id)

    if re.match(r"^/(start|help)$", lower):
        if chat_id in pending_messages:
            del pending_messages[chat_id]
        send(chat_id, "\n".join([
            "TLR SMOKE STROKE - Help Menu",
            "Send Zoom link or /join <meeting-id>. Then I will ask what message to send in Zoom chat.",
            "",
            "Special slash commands:",
            "/settings - view current controls",
            "/ocr on|off - OCR is always used; off is accepted only for compatibility",
            "/headless_shells <N> - set parallel headless shells (min 1)",
            "/max_messages <N> - stop after N messages (0 disables)",
            "/max_runtime <seconds> - stop after N seconds (0 disables)",
            "/max_restarts <N> - stop after N restarts (0 disables)",
            "/status - show whether run is active",
            "/stop - stop active run"
        ]))
        return True

    if command == "/settings":
        send(chat_id, settings_summary(chat_id))
        return True

    if command == "/ocr":
        if not re.match(r"^(on|off)$", arg, re.IGNORECASE):
            send(chat_id, "Usage: /ocr on|off\nTLR SMOKE STROKE")
            return True
        settings["ocr"] = True
        send(chat_id, "OCR is always ON and will be used for every Zoom bot launch. TLR SMOKE STROKE")
        return True

    numeric_commands = {
        "/headless_shells": "headlessShells",
        "/max_messages": "maxMessages",
        "/max_runtime": "maxRuntimeSec",
        "/max_restarts": "maxRestarts"
    }

    if command in numeric_commands:
        try:
            n = int(arg)
            if n < 0:
                raise ValueError
        except ValueError:
            send(chat_id, f"Usage: {command} <non-negative integer>\nTLR SMOKE STROKE")
            return True
        
        if command == "/headless_shells" and n < 1:
            send(chat_id, "Usage: /headless_shells <integer >= 1>\nTLR SMOKE STROKE")
            return True
            
        settings[numeric_commands[command]] = n
        send(chat_id, f"Updated {command} to {n}.\nTLR SMOKE STROKE")
        return True

    if command == "/status":
        status_str = "active" if chat_id in active_runs else "idle"
        send(chat_id, f"Run status: {status_str}\n{settings_summary(chat_id)}")
        return True

    if command == "/stop":
        child = active_runs.get(chat_id)
        if not child:
            send(chat_id, "No active run to stop.\nTLR SMOKE STROKE")
            return True
        child.terminate()
        send(chat_id, "Stop signal sent to active run.\nTLR SMOKE STROKE")
        return True

    return False

def handle_message(message):
    chat_id = message["chat"]["id"]
    text = str(message.get("text", "")).strip()

    if not text:
        return
        
    if text.startswith("/"):
        if handle_slash_command(chat_id, text):
            return

        if re.match(r"^/join(?:\?.*)?\s*$", text, re.IGNORECASE):
            send(chat_id, "Usage: /join <meeting-id-or-zoom-link>\nExample: /join 1234567890\nTLR SMOKE STROKE")
            return

    if chat_id in active_runs:
        send(chat_id, "A Zoom bot run is already active for this chat. Use /status or /stop.\nTLR SMOKE STROKE")
        return

    pending = pending_messages.get(chat_id)
    if pending:
        if not pending.get("displayName"):
            display_name = text if text else "ZoomGuest"
            pending["displayName"] = display_name
            send(chat_id, "What message do you want sent in Zoom chat?\nTLR SMOKE STROKE")
            return

        del pending_messages[chat_id]
        custom_message = text if text else default_message
        clamped = clamp_message(custom_message)
        run_zoom_bot(chat_id, pending["meetingId"], clamped["message"], pending["displayName"])
        send(chat_id, f"Starting Zoom bot for meeting {pending['meetingId']} as {pending['displayName']}.\nTLR SMOKE STROKE")
        if clamped["truncated"]:
            send(chat_id, f"Message was truncated to {MAX_MESSAGE_CHARS} characters (received {clamped['originalLength']}).\nTLR SMOKE STROKE")
        return

    payload = re.sub(r"^/join(?:\?.*?)?\s*", "", text, flags=re.IGNORECASE)
    meeting_id = extract_meeting_id(payload)
    if not meeting_id:
        send(chat_id, "Could not parse a valid Zoom meeting ID. Try /help for command usage.\nTLR SMOKE STROKE")
        return

    pending_messages[chat_id] = {
        "meetingId": meeting_id,
        "displayName": ""
    }
    send(chat_id, "What name should I use in Zoom?\nTLR SMOKE STROKE")

def poll():
    global offset
    print("Telegram Zoom relay bot is running... TLR SMOKE STROKE")
    while True:
        check_active_runs()
        try:
            updates = tg("getUpdates", {"offset": offset, "timeout": 30, "allowed_updates": ["message"]})
            for update in updates:
                offset = update["update_id"] + 1
                if "message" in update:
                    handle_message(update["message"])
        except Exception as error:
            print(f"Polling error (TLR SMOKE STROKE): {error}", file=sys.stderr)
            time.sleep(2)

if __name__ == "__main__":
    poll()
