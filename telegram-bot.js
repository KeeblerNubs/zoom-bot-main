#!/usr/bin/env node
const { spawn } = require('node:child_process');

const token = process.env.TELEGRAM_BOT_TOKEN;
const defaultMessage = process.env.ZOOM_CHAT_MESSAGE || '';
const apiBase = token ? `https://api.telegram.org/bot${token}` : '';

if (!token) {
  console.error('Missing TELEGRAM_BOT_TOKEN environment variable.');
  process.exit(1);
}

const activeRuns = new Map();
const pendingMessages = new Map();
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

function runZoomBot(chatId, meetingId, customMessage, name) {
  if (activeRuns.has(chatId)) return null;
  const args = ['zoom-bot.js', meetingId, '--name', name];
  if (customMessage) args.push('--message', customMessage);

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

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = String(message.text || '').trim();

  if (!text || /^\/start\b/i.test(text) || /^\/help\b/i.test(text)) {
    pendingMessages.delete(chatId);
    await send(chatId, 'Send Zoom link or /join <meeting-id>. Then I will ask what message to send in Zoom chat.');
    return;
  }

  if (activeRuns.has(chatId)) {
    await send(chatId, 'A Zoom bot run is already active for this chat.');
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
    runZoomBot(chatId, pending.meetingId, customMessage, pending.displayName);
    await send(chatId, `Starting Zoom bot for meeting ${pending.meetingId} as ${pending.displayName}.`);
    return;
  }

  const payload = text.replace(/^\/join\s+/i, '');
  const meetingId = extractMeetingId(payload);
  if (!meetingId) {
    await send(chatId, 'Could not parse a valid Zoom meeting ID.');
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
