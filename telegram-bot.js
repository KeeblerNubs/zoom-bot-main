#!/usr/bin/env node
const { loadEnvFromFile } = require('./env-loader');
loadEnvFromFile();
const { spawn, spawnSync } = require('node:child_process');

const token = process.env.TELEGRAM_BOT_TOKEN;
const defaultMessage = process.env.ZOOM_CHAT_MESSAGE || '';
const apiBase = token ? `https://api.telegram.org/bot${token}` : '';

if (!token) {
  console.error('Missing TELEGRAM_BOT_TOKEN environment variable.');
  process.exit(1);
}

const MAX_MESSAGE_CHARS = 1000;
const MAX_LOG_CHARS = 12000;

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
      ocr: true,
      headlessShells: 8,
      maxMessages: 0,
      maxRuntimeSec: 0,
      maxRestarts: 10
    });
  }
  return chatSettings.get(chatId);
}

function normalizeMeetingId(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits : '';
}

function extractMeetingId(text) {
  const normalized = String(text || '').trim();
  const linkMatch = normalized.match(/\/(?:wc|j|w)\/(\d{9,})/i);
  if (linkMatch) return linkMatch[1];

  const confParamMatch = normalized.match(/[?&]confno=(\d{9,})/i);
  if (confParamMatch) return confParamMatch[1];

  return normalizeMeetingId(normalized);
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


function buildZoomCommand(args) {
  const xvfbAvailable = spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' }).status !== null;
  if (xvfbAvailable) {
    return { command: 'xvfb-run', launchArgs: ['-a', 'node', ...args] };
  }
  return { command: 'node', launchArgs: args };
}

function runZoomBot(chatId, meetingId, customMessage, name) {
  if (activeRuns.has(chatId)) return null;
  const settings = getSettings(chatId);
  const args = ['zoom-bot.js', meetingId, '--name', name];
  if (customMessage) args.push('--message', customMessage);
  args.push('--ocr');
  args.push('--headless-shells', String(settings.headlessShells));
  if (settings.maxMessages > 0) args.push('--max-messages', String(settings.maxMessages));
  if (settings.maxRuntimeSec > 0) args.push('--max-runtime-sec', String(settings.maxRuntimeSec));
  if (settings.maxRestarts > 3) args.push('--max-restarts', String(settings.maxRestarts));

  const { command, launchArgs } = buildZoomCommand(args);
  const child = spawn(command, launchArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  activeRuns.set(chatId, child);

  let detailedLogs = '';
  const appendLogs = (source, buf) => {
    const text = String(buf || '');
    if (!text) return;
    detailedLogs += `[${source}] ${text}`;
    if (detailedLogs.length > MAX_LOG_CHARS) {
      detailedLogs = detailedLogs.slice(-MAX_LOG_CHARS);
    }
  };

  child.stdout.on('data', (buf) => appendLogs('stdout', buf));
  child.stderr.on('data', (buf) => appendLogs('stderr', buf));

  child.on('error', (error) => {
    activeRuns.delete(chatId);
    const { message } = clampMessage(`Failed to start Zoom bot for meeting ${meetingId}: ${error.message}`);
    send(chatId, message).catch(() => {});
  });

  child.on('close', (code, signal) => {
    activeRuns.delete(chatId);
    const status = signal ? `signal ${signal}` : `exit code ${code}`;
    const logSuffix = detailedLogs.trim() ? `\nLogs (latest ${MAX_LOG_CHARS} chars):\n${detailedLogs.trim()}` : '';
    const { message } = clampMessage(`Zoom bot finished for meeting ${meetingId} (${status}).${logSuffix}`);
    send(chatId, message).catch(() => {});
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
        '/ocr on|off - OCR is always used; off is accepted only for compatibility',
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
    settings.ocr = true;
    await send(chatId, 'OCR is always ON and will be used for every Zoom bot launch.');
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

    if (/^\/join(?:\?.*)?\s*$/i.test(text)) {
      await send(chatId, 'Usage: /join <meeting-id-or-zoom-link>\nExample: /join 1234567890');
      return;
    }
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
