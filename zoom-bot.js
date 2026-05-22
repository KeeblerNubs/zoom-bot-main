#!/usr/bin/env node
const { loadEnvFromFile } = require('./env-loader');
loadEnvFromFile();
const { chromium } = require("playwright");
const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const execFileAsync = promisify(execFile);

const CONFIG = {
  turboMode: true,
  repeatSpeedMs: Number(process.env.REPEAT_SPEED_MS || 20),
  chatDiscoveryTimeoutMs: Number(process.env.CHAT_DISCOVERY_TIMEOUT_MS || 120000),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 30),
  maxFrameScanPerCycle: Number(process.env.MAX_FRAME_SCAN || 2),
  useOcr: process.argv.includes("--ocr"),
  maxRuntimeMs: Number(process.env.MAX_RUNTIME_MS || 0),
  maxMessages: Number(process.env.MAX_MESSAGES || 0),
  maxRestartCycles: Number(process.env.MAX_RESTART_CYCLES || 0),
  gracefulShutdownMs: Number(process.env.GRACEFUL_SHUTDOWN_MS || 4000)
};

let lastScrollLogTime = 0;
let maintenanceTick = 0;
let lastOcrCheck = 0;
let shouldStop = false;
let stopReason = "";

function requestStop(reason = "stop requested") {
  if (shouldStop) return;
  shouldStop = true;
  stopReason = reason;
  console.log(`[failsafe] ${reason}`);
}

function isError1132(error) {
  return /\b1132\b/.test(String(error?.message || error || ""));
}

function fallbackName() {
  const names = ["Mundy", "Jake", "slmpig", "Nathan", "Intelll"];
  return names[Math.floor(Math.random() * names.length)];
}

function normalizeMeetingId(value) {
  const digitsOnly = String(value || "").replace(/\D/g, "");
  return digitsOnly.length >= 9 ? digitsOnly : "";
}

function extractMeetingId(value) {
  const normalized = String(value || "").trim();
  const linkMatch = normalized.match(/\/(?:wc|j|w)\/(\d{9,})/i);
  if (linkMatch) return linkMatch[1];

  const confParamMatch = normalized.match(/[?&]confno=(\d{9,})/i);
  if (confParamMatch) return confParamMatch[1];

  return normalizeMeetingId(normalized);
}

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) return "";
  return String(process.argv[index + 1] || "").trim();
}

function getNumericArgValue(flag) {
  const raw = getArgValue(flag);
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function getSetupOptions() {
  const fromArg = extractMeetingId(process.argv[2]);
  const shellCountArg = getNumericArgValue("--headless-shells");
  if (fromArg) {
    return {
      meetingId: fromArg,
      headlessShells: shellCountArg > 0 ? shellCountArg : 1
    };
  }

  const rl = readline.createInterface({ input, output });
  try {
    let meetingId = "";
    while (!meetingId) {
      const entered = await rl.question("Enter Zoom meeting ID or link: ");
      meetingId = extractMeetingId(entered);
      if (!meetingId) console.log("Invalid meeting ID/link. Please enter a Zoom link or at least 9 digits.");
    }

    const shellsAnswer = await rl.question("How many headless shells should run in parallel? (default: 1): ");
    const parsedShellCount = Number(shellsAnswer);
    const headlessShells = Number.isFinite(parsedShellCount) && parsedShellCount > 0 ? Math.floor(parsedShellCount) : 1;

    return { meetingId, headlessShells };
  } finally {
    rl.close();
  }
}

async function safeWait(page, ms) {
  if (shouldStop) return false;
  if (page.isClosed()) return false;
  if (ms <= 0) return true;
  try {
    await page.waitForTimeout(ms);
    return true;
  } catch (error) {
    if (page.isClosed()) return false;
    throw error;
  }
}

async function clickFirstVisible(locator) {
  try {
    if ((await locator.count()) === 0) return false;
    const first = locator.first();
    await first.click({ timeout: 25, force: true });
    return true;
  } catch {
    return false;
  }
}

async function detectTextViaOcr(page) {
  if (!CONFIG.useOcr || Date.now() - lastOcrCheck < 5000) return "";
  lastOcrCheck = Date.now();

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "zoom-bot-"));
  const screenshotPath = path.join(tempDir, "shot.png");
  try {
    await page.screenshot({ path: screenshotPath, fullPage: false });
    const { stdout } = await execFileAsync("tesseract", [screenshotPath, "stdout", "--dpi", "300"], { timeout: 5000 });
    return String(stdout || "").toLowerCase();
  } catch {
    return "";
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function checkAndHandleCaptcha(page) {
  const frames = page.frames().slice(0, CONFIG.maxFrameScanPerCycle);
  for (const frame of frames) {
    try {
      const recaptcha = frame.locator('#recaptcha-anchor');
      if ((await recaptcha.count()) > 0 && (await recaptcha.isVisible())) {
        console.log("reCAPTCHA checkbox detected! Clicking...");
        await recaptcha.click({ force: true }).catch(() => {});
        return true;
      }
      const genericCaptcha = frame.locator('button:has-text("I am not a robot"), [aria-label*="not a robot" i]');
      if ((await genericCaptcha.count()) > 0 && (await genericCaptcha.isVisible())) {
        console.log("Generic captcha button detected! Clicking...");
        await genericCaptcha.click({ force: true }).catch(() => {});
        return true;
      }
    } catch {}
  }
  return false;
}


async function clickJoinFromBrowser(page) {
  const frames = page.frames().slice(0, CONFIG.maxFrameScanPerCycle);
  for (const frame of frames) {
    if (
      (await clickFirstVisible(frame.getByRole("link", { name: /join from (your )?browser/i }))) ||
      (await clickFirstVisible(frame.getByRole("button", { name: /join from (your )?browser/i }))) ||
      (await clickFirstVisible(frame.locator('a:has-text("Join from Your Browser")'))) ||
      (await clickFirstVisible(frame.locator('[data-testid*="join-browser" i]')))
    ) {
      console.log("Opened Zoom web client (Join from browser).");
      return true;
    }
  }
  return false;
}

async function clickDisclaimerAgree(page) {
  const frames = page.frames();
  for (const frame of frames) {
    if (await clickFirstVisible(frame.locator('#disclaimer_agree'))) {
      console.log('Accepted disclaimer.');
      return true;
    }
  }
  return false;
}


async function detectRestartCondition(page) {
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const bodyText = (await frame.innerText("body").catch(() => "")).toLowerCase();
      const isRemoved = await frame.locator('.zm-modal-body-title:has-text("You have been removed")').count().catch(() => 0) > 0;
      const inWaitingRoom = bodyText.includes("waiting room") || bodyText.includes("let you in soon");
      if (isRemoved || inWaitingRoom) return true;
    } catch {}
  }

  const ocrText = await detectTextViaOcr(page);
  return ocrText.includes("waiting room") || ocrText.includes("let you in soon");
}

async function clickAnyJoinButton(page) {
  // Ensure we switch from the native-app prompt to web client when presented.
  await clickJoinFromBrowser(page);
  await checkAndHandleCaptcha(page);
  await clickDisclaimerAgree(page);

  const frames = page.frames().slice(0, CONFIG.maxFrameScanPerCycle);
  for (const frame of frames) {
    try {
      if (await detectRestartCondition(page)) throw new Error("RESTART_CYCLE");

      if (
        (await frame.locator('.zm-modal-body-title:has-text("Meeting alert")').count().catch(() => 0) > 0 && await clickFirstVisible(frame.getByRole("button", { name: "Later" }))) ||
        (await clickFirstVisible(frame.getByRole("button", { name: /join|launch meeting|continue|audio|video|without/i }))) ||
        (await clickFirstVisible(frame.locator(".preview-join-button"))) ||
        (await clickFirstVisible(frame.locator('[data-testid*="join" i]'))) ||
        (await clickFirstVisible(frame.locator('button:has-text("Join")')))
      ) return true;
    } catch (e) {
      if (e.message === "RESTART_CYCLE") throw e;
    }
  }

  if (Date.now() - lastScrollLogTime > 2000) {
    console.log("No buttons found yet, scrolling down to discover elements...");
    lastScrollLogTime = Date.now();
  }
  await page.mouse.wheel(0, 250).catch(() => {});
  return false;
}

async function clickChatButton(page) {
  const selectors = [
    (frame) => frame.getByRole("button", { name: /chat/i }),
    (frame) => frame.locator('[aria-label*="chat" i]'),
    (frame) => frame.locator('[data-testid*="chat" i]'),
    (frame) => frame.locator('[id*="chat" i]'),
    (frame) => frame.locator('button:has-text("Chat")')
  ];

  const frames = page.frames().slice(0, CONFIG.maxFrameScanPerCycle);
  for (const frame of frames) {
    for (const getSelector of selectors) {
      if (await clickFirstVisible(getSelector(frame))) return true;
    }
  }
  return false;
}

async function triggerChatShortcut(page) {
  // Zoom web commonly uses Alt+H for chat (Windows/Linux layouts may vary),
  // so we try it first and then a shifted fallback.
  await page.keyboard.press("Alt+h", { delay: 0 }).catch(() => {});
  await page.keyboard.press("Alt+Shift+h", { delay: 0 }).catch(() => {});
  if (!CONFIG.turboMode) await safeWait(page, 250);
}

async function findChatInput(page) {
  const selectors = [
    '.tiptap.ProseMirror[contenteditable="true"]',
    '.tiptap.ProseMirror',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][aria-label*="message" i]',
    'textarea[aria-label*="message" i]',
    'textarea'
  ];

  const frames = page.frames().slice(0, CONFIG.maxFrameScanPerCycle);
  for (const frame of frames) {
    for (const selector of selectors) {
      const locator = frame.locator(selector).first();
      try {
        if ((await locator.count()) > 0 && (await locator.isVisible())) return { locator, selector };
      } catch {}
    }
  }
  return null;
}


async function createFreshShell() {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "zoom-shell-profile-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const page = context.pages()[0] || await context.newPage();
  return { context, page, userDataDir };
}

async function waitForChatInput(page) {
  const startedAt = Date.now();
  while (!shouldStop && Date.now() - startedAt < CONFIG.chatDiscoveryTimeoutMs) {
    if (page.isClosed()) return null;

    // Fast-path: race to open chat first, then look for the input.
    await clickChatButton(page);
    await triggerChatShortcut(page);
    const fastFound = await findChatInput(page);
    if (fastFound) return fastFound;

    await clickAnyJoinButton(page);
    const found = await findChatInput(page);
    if (found) return found;

    if (!(await safeWait(page, CONFIG.pollIntervalMs))) return null;
  }
  return null;
}

(async () => {
  const { meetingId, headlessShells } = await getSetupOptions();
  const message = getArgValue("--message");
  const displayName = getArgValue("--name") || fallbackName();
  const stopAtIso = getArgValue("--stop-at");
  const maxMessagesArg = getNumericArgValue("--max-messages");
  const maxRuntimeArgSeconds = getNumericArgValue("--max-runtime-sec");
  const maxRestartsArg = getNumericArgValue("--max-restarts");
  let sentMessages = 0;
  let restartCount = 0;
  const startedAt = Date.now();
  const maxRuntimeMs = maxRuntimeArgSeconds > 0 ? maxRuntimeArgSeconds * 1000 : CONFIG.maxRuntimeMs;
  const maxMessages = maxMessagesArg > 0 ? maxMessagesArg : CONFIG.maxMessages;
  const maxRestartCycles = maxRestartsArg > 0 ? maxRestartsArg : CONFIG.maxRestartCycles;
  const stopAtMs = stopAtIso ? Date.parse(stopAtIso) : NaN;

  process.on("SIGINT", () => requestStop("SIGINT received"));
  process.on("SIGTERM", () => requestStop("SIGTERM received"));

  while (!shouldStop) {
    const activeShells = [];
    try {
      if (maxRuntimeMs > 0 && Date.now() - startedAt >= maxRuntimeMs) requestStop(`max runtime reached (${maxRuntimeMs}ms)`);
      if (Number.isFinite(stopAtMs) && Date.now() >= stopAtMs) requestStop(`stop-at reached (${new Date(stopAtMs).toISOString()})`);
      if (shouldStop) break;

      for (let shellIndex = 0; shellIndex < headlessShells; shellIndex += 1) {
        const shell = await createFreshShell();
        activeShells.push(shell);
      }

      const { page } = activeShells[0];
      console.log(`Opening Zoom with ${headlessShells} headless shell(s)...`);

      const joinUrls = [
        `https://app.zoom.us/wc/${meetingId}/join`,
        `https://app.zoom.us/wc/join/${meetingId}`,
        `https://zoom.us/wc/${meetingId}/join`
      ];
      let joinLoaded = false;
      for (const joinUrl of joinUrls) {
        try {
          await page.goto(joinUrl, { waitUntil: "domcontentloaded" });
          joinLoaded = true;
          console.log(`Loaded join page: ${joinUrl}`);
          break;
        } catch (error) {
          console.log(`Failed join URL ${joinUrl}: ${error.message}`);
          if (isError1132(error)) {
            throw new Error("RESTART_CYCLE");
          }
        }
      }
      if (!joinLoaded) throw new Error("Could not load any Zoom web join URL");

      for (let i = 0; i < 50; i++) {
        if (await clickAnyJoinButton(page)) break;
        if (!(await safeWait(page, CONFIG.pollIntervalMs))) return;
      }

      for (let i = 0; i < 30; i++) {
        await checkAndHandleCaptcha(page);
        const nameInput = page.locator("#input-for-name");
        if (await nameInput.count()) {
          await nameInput.fill(displayName);
          break;
        }
        await safeWait(page, CONFIG.pollIntervalMs);
      }

      for (let i = 0; i < 50; i++) {
        if (await clickAnyJoinButton(page)) break;
        await safeWait(page, CONFIG.pollIntervalMs);
      }

      const chatTarget = await waitForChatInput(page);
      if (!chatTarget) {
        console.log("Chat box not found after retries.");
        return;
      }

      const { locator: chatBox, selector } = chatTarget;
      await chatBox.click().catch(() => {});
      console.log(`Chat input found using selector: ${selector}`);

      while (!shouldStop && !page.isClosed()) {
        if (await detectRestartCondition(page)) throw new Error("RESTART_CYCLE");
        if (maxRuntimeMs > 0 && Date.now() - startedAt >= maxRuntimeMs) requestStop(`max runtime reached (${maxRuntimeMs}ms)`);
        if (Number.isFinite(stopAtMs) && Date.now() >= stopAtMs) requestStop(`stop-at reached (${new Date(stopAtMs).toISOString()})`);
        if ((maintenanceTick++ % 15) === 0) await clickAnyJoinButton(page);
        if (message) {
          await chatBox.fill(message).catch(() => {});
        } else {
          await chatBox.press("ControlOrMeta+V", { delay: 0 }).catch(async () => {
            await page.keyboard.press("ControlOrMeta+V").catch(() => {});
          });
        }
        await chatBox.press("Enter", { delay: 0 }).catch(async () => {
          await page.keyboard.press("Enter").catch(() => {});
        });
        sentMessages += 1;
        if (maxMessages > 0 && sentMessages >= maxMessages) {
          requestStop(`max messages reached (${maxMessages})`);
          break;
        }
        if (!(await safeWait(page, CONFIG.repeatSpeedMs))) break;
      }
      break;
    } catch (error) {
      if (error.message === "RESTART_CYCLE") {
        restartCount += 1;
        if (maxRestartCycles > 0 && restartCount > maxRestartCycles) {
          requestStop(`max restart cycles reached (${maxRestartCycles})`);
          break;
        }
        console.log("Detected restart condition (waiting room/removal/error 1132). Starting a brand-new Chrome instance...");
        continue;
      }
      if (isError1132(error)) {
        restartCount += 1;
        if (maxRestartCycles > 0 && restartCount > maxRestartCycles) {
          requestStop(`max restart cycles reached (${maxRestartCycles})`);
          break;
        }
        console.log("Error 1132 detected. Starting a brand-new Chrome instance...");
        continue;
      }
      if (String(error).includes("Target page, context or browser has been closed")) break;
      throw error;
    } finally {
      for (const shell of activeShells) {
        if (shell.context) await shell.context.close().catch(() => {});
        if (shell.userDataDir) await rm(shell.userDataDir, { recursive: true, force: true }).catch(() => {});
      }
      const shouldDelayShutdown = shouldStop && CONFIG.gracefulShutdownMs > 0 && !/^SIG(?:INT|TERM)\b/.test(stopReason);
      if (shouldDelayShutdown) {
        await new Promise((resolve) => setTimeout(resolve, CONFIG.gracefulShutdownMs));
      }
    }
  }
  if (shouldStop) {
    console.log(`Stopped safely: ${stopReason || "stop requested"}`);
  }
})();
