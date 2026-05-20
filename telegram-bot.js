#!/usr/bin/env node
const { spawn } = require('node:child_process');

const token = process.env.TELEGRAM_BOT_TOKEN;
const defaultMessage = process.env.ZOOM_CHAT_MESSAGE || '';
const apiBase = token ? `https://api.telegram.org/bot${token}` : '';

if (!token) {
  console.error('Missing TELEGRAM_BOT_TOKEN environment variable.');
  process.exit(1);
}

const MAX_MESSAGE_CHARS = 1000;

const activeRuns = new Map();
const pendingMessages = new Map();
const chatSettings = new Map();
let offset = 0;

async function tg(method, params = {}) {
  const res = await fetch(`${apiBase}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || `Telegram API error in ${method}`);
  return data.result;
}

function getSettings(chatId) {
  if (!chatSettings.has(chatId)) {
    chatSettings.set(chatId, {
      ocr: false,
      headlessShells: 1,
      maxMessages: 0,
      maxRuntimeSec: 0,
      maxRestarts: 0
    });
  }
  return chatSettings.get(chatId);
}

function normalizeMeetingId(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits : '';
}

function extractMeetingId(text) {
  const linkMatch = String(text).match(/\/(?:wc|j)\/(\d{9,})/i);
  if (linkMatch) return linkMatch[1];
  return normalizeMeetingId(text);
}

async function send(chatId, text) {
  return tg('sendMessage', { chat_id: chatId, text });
}

function clampMessage(text) {
  const value = String(text || '');
  if (value.length <= MAX_MESSAGE_CHARS) {
    return { message: value, truncated: false, originalLength: value.length };
  }
  return {
    message: value.slice(0, MAX_MESSAGE_CHARS),
    truncated: true,
    originalLength: value.length
  };
}

function runZoomBot(chatId, meetingId, customMessage, name) {
  if (activeRuns.has(chatId)) return null;
  const settings = getSettings(chatId);
  const args = ['zoom-bot.js', meetingId, '--name', name];
  if (customMessage) args.push('--message', customMessage);
  if (settings.ocr) args.push('--ocr');
  if (settings.headlessShells > 1) args.push('--headless-shells', String(settings.headlessShells));
  if (settings.maxMessages > 0) args.push('--max-messages', String(settings.maxMessages));
  if (settings.maxRuntimeSec > 0) args.push('--max-runtime-sec', String(settings.maxRuntimeSec));
  if (settings.maxRestarts > 0) args.push('--max-restarts', String(settings.maxRestarts));

  const child = spawn('xvfb-run', ['-a', 'node', ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  activeRuns.set(chatId, child);

  let lastOutput = '';
  child.stdout.on('data', (buf) => { lastOutput = String(buf).trim() || lastOutput; });
  child.stderr.on('data', (buf) => { lastOutput = String(buf).trim() || lastOutput; });

  child.on('close', () => {
    activeRuns.delete(chatId);
    send(chatId, `Zoom bot finished for meeting ${meetingId}.${lastOutput ? `\nLast log: ${lastOutput.slice(0, 300)}` : ''}`).catch(() => {});
  });

  return child;
}

function settingsSummary(chatId) {
  const s = getSettings(chatId);
  return [
    'Settings:',
    `- OCR: ${s.ocr ? 'ON' : 'OFF'}`,
    `- headless-shells: ${s.headlessShells}`,
    `- max-messages: ${s.maxMessages || 'disabled'}`,
    `- max-runtime-sec: ${s.maxRuntimeSec || 'disabled'}`,
    `- max-restarts: ${s.maxRestarts || 'disabled'}`
  ].join('\n');
}

async function handleSlashCommand(chatId, text) {
  const lower = text.toLowerCase();
  const [command, argRaw = ''] = text.split(/\s+/, 2);
  const arg = argRaw.trim();
  const settings = getSettings(chatId);

  if (/^\/(start|help)$/.test(lower)) {
    pendingMessages.delete(chatId);
    await send(chatId,
      [
        'Send Zoom link or /join <meeting-id>. Then I will ask what message to send in Zoom chat.',
        '',
        'Special slash commands:',
        '/settings - view current controls',
        '/ocr on|off - toggle OCR mode',
        '/headless_shells <N> - set parallel headless shells (min 1)',
        '/max_messages <N> - stop after N messages (0 disables)',
        '/max_runtime <seconds> - stop after N seconds (0 disables)',
        '/max_restarts <N> - stop after N restarts (0 disables)',
        '/status - show whether run is active',
        '/stop - stop active run'
      ].join('\n')
    );
    return true;
  }

  if (command === '/settings') {
    await send(chatId, settingsSummary(chatId));
    return true;
  }

  if (command === '/ocr') {
    if (!/^(on|off)$/i.test(arg)) {
      await send(chatId, 'Usage: /ocr on|off');
      return true;
    }
    settings.ocr = arg.toLowerCase() === 'on';
    await send(chatId, `OCR is now ${settings.ocr ? 'ON' : 'OFF'}.`);
    return true;
  }

  const numericCommands = {
    '/headless_shells': 'headlessShells',
    '/max_messages': 'maxMessages',
    '/max_runtime': 'maxRuntimeSec',
    '/max_restarts': 'maxRestarts'
  };

  if (numericCommands[command]) {
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 0) {
      await send(chatId, `Usage: ${command} <non-negative integer>`);
      return true;
    }
    if (command === '/headless_shells' && n < 1) {
      await send(chatId, 'Usage: /headless_shells <integer >= 1>');
      return true;
    }
    settings[numericCommands[command]] = n;
    await send(chatId, `Updated ${command} to ${n}.`);
    return true;
  }

  if (command === '/status') {
    await send(chatId, activeRuns.has(chatId) ? `Run status: active\n${settingsSummary(chatId)}` : `Run status: idle\n${settingsSummary(chatId)}`);
    return true;
  }

  if (command === '/stop') {
    const child = activeRuns.get(chatId);
    if (!child) {
      await send(chatId, 'No active run to stop.');
      return true;
    }
    child.kill('SIGTERM');
    await send(chatId, 'Stop signal sent to active run.');
    return true;
  }

  return false;
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = String(message.text || '').trim();

  if (!text) return;
  if (text.startsWith('/')) {
    const handled = await handleSlashCommand(chatId, text);
    if (handled) return;
  }

  if (activeRuns.has(chatId)) {
    await send(chatId, 'A Zoom bot run is already active for this chat. Use /status or /stop.');
    return;
  }

  const pending = pendingMessages.get(chatId);
  if (pending) {
    if (!pending.displayName) {
      const displayName = text || 'ZoomGuest';
      pendingMessages.set(chatId, { ...pending, displayName });
      await send(chatId, 'What message do you want sent in Zoom chat?');
      return;
    }

    pendingMessages.delete(chatId);
    const customMessage = text || defaultMessage;
    const clamped = clampMessage(customMessage);
    runZoomBot(chatId, pending.meetingId, clamped.message, pending.displayName);
    await send(chatId, `Starting Zoom bot for meeting ${pending.meetingId} as ${pending.displayName}.`);
    if (clamped.truncated) {
      await send(chatId, `Message was truncated to ${MAX_MESSAGE_CHARS} characters (received ${clamped.originalLength}).`);
    }
    return;
  }

  const payload = text.replace(/^\/join\s+/i, '');
  const meetingId = extractMeetingId(payload);
  if (!meetingId) {
    await send(chatId, 'Could not parse a valid Zoom meeting ID. Try /help for command usage.');
    return;
  }

  pendingMessages.set(chatId, {
    meetingId,
    displayName: ''
  });
  await send(chatId, 'What name should I use in Zoom?');
}

async function poll() {
  while (true) {
    try {
      const updates = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message) await handleMessage(update.message);
      }
    } catch (error) {
      console.error('Polling error:', error.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

console.log('Telegram Zoom relay bot is running...');
poll();
