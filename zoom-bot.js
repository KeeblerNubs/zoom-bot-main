#!/usr/bin/env node
require('dotenv').config();
const { chromium } = require("playwright");

let cloakBrowserModulePromise;
const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const execFileAsync = promisify(execFile);
const { execFileSync } = require("node:child_process");

// CONFIG must be defined before any code tries to access it
const CONFIG = {
  turboMode: true,
  repeatSpeedMs: Number(process.env.REPEAT_SPEED_MS || 20),
  chatDiscoveryTimeoutMs: Number(process.env.CHAT_DISCOVERY_TIMEOUT_MS || 120000),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 30),
  maxFrameScanPerCycle: Number(process.env.MAX_FRAME_SCAN || 8),
  useOcr: !process.argv.includes("--no-ocr"),
  ocrCheckIntervalMs: Number(process.env.OCR_CHECK_INTERVAL_MS || 5000),
  maxRuntimeMs: Number(process.env.MAX_RUNTIME_MS || 0),
  maxMessages: Number(process.env.MAX_MESSAGES || 0),
  maxRestartCycles: Number(process.env.MAX_RESTART_CYCLES || 0),
  gracefulShutdownMs: Number(process.env.GRACEFUL_SHUTDOWN_MS || 4000),
  useChrome: process.argv.includes("--chrome") || /^(1|true|yes)$/i.test(process.env.USE_SYSTEM_CHROME || ""),
  useCloakBrowser: !process.argv.includes("--no-cloak-browser") && !process.argv.includes("--chrome") && !/^(0|false|no)$/i.test(process.env.USE_CLOAK_BROWSER || "true"),
  cloakHumanize: !process.argv.includes("--no-humanize") && !/^(0|false|no)$/i.test(process.env.CLOAK_HUMANIZE || "true"),
  cloakGeoip: /^(1|true|yes)$/i.test(process.env.CLOAK_GEOIP || ""),
  stealthMode: !process.argv.includes("--no-stealth") && !/^(0|false|no)$/i.test(process.env.STEALTH_MODE || "true")
};

// Check tesseract availability synchronously at startup
try {
  execFileSync('tesseract', ['--version'], { stdio: 'ignore', timeout: 3000 });
} catch {
  console.warn('[ocr] tesseract not found in PATH — OCR disabled');
  CONFIG.useOcr = false;
}

// Also check tesseract availability asynchronously
(async () => {
  try {
    await execFileAsync('which', ['tesseract']);
  } catch {
    if (CONFIG.useOcr) {
      console.warn('[ocr] tesseract not found in PATH — OCR disabled');
      CONFIG.useOcr = false;
    }
  }
})();

let lastScrollLogTime = 0;
let maintenanceTick = 0;
let lastOcrCheck = 0;
const lastJoinButtonClickAtByPage = new WeakMap();
let shouldStop = false;
let stopReason = "";

let stopController;
let stopResolve;
const stopPromise = new Promise((resolve) => { stopResolve = resolve; });

function requestStop(reason = "stop requested") {
  if (shouldStop) return;
  shouldStop = true;
  stopReason = reason;
  console.log(`[failsafe] ${reason}`);
  try { stopController.abort(); } catch {}
  try { stopResolve?.(); } catch {}
}

function isError1132(error) {
  return /\b1132\b/.test(String(error?.message || error || ""));
}

function getProxyConfig() {
  const server = process.env.PROTONVPN_PROXY_SERVER || process.env.CHROME_PROXY_SERVER || "";
  if (!server) return undefined;

  const proxy = { server };
  const username = process.env.PROTONVPN_PROXY_USERNAME || process.env.CHROME_PROXY_USERNAME || "";
  const password = process.env.PROTONVPN_PROXY_PASSWORD || process.env.CHROME_PROXY_PASSWORD || "";
  if (username) proxy.username = username;
  if (password) proxy.password = password;
  return proxy;
}

async function applyStealthProfile(context) {
  if (!CONFIG.stealthMode) return;

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });

    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime || {};

    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) => (
        parameters?.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters)
      );
    }
  });
}

async function getCloakBrowserModule() {
  if (!cloakBrowserModulePromise) {
    cloakBrowserModulePromise = import("cloakbrowser").catch((error) => {
      throw new Error(
        `CloakBrowser is enabled but the cloakbrowser package could not be loaded: ${error.message}. ` +
        `Run npm install, or set USE_CLOAK_BROWSER=false / pass --no-cloak-browser to fall back to Playwright Chromium.`
      );
    });
  }
  return cloakBrowserModulePromise;
}

function getBrowserLabel(proxy) {
  if (CONFIG.useCloakBrowser) {
    return `CloakBrowser; humanize: ${CONFIG.cloakHumanize ? "on" : "off"}; geoip: ${CONFIG.cloakGeoip ? "on" : "off"}; proxy/VPN: ${proxy ? proxy.server : "system/default"}`;
  }
  return `${CONFIG.useChrome ? "system Chrome" : "bundled Chromium"}; stealth: ${CONFIG.stealthMode ? "on" : "off"}; proxy/VPN: ${proxy ? proxy.server : "system/default"}`;
}

async function launchBrowserContext(userDataDir, proxy) {
  const commonOptions = {
    headless: true,
    proxy,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=ExternalProtocolDialogShowAlwaysOpenCheckbox",
      "--no-first-run",
      "--no-default-browser-check"
    ]
  };

  if (CONFIG.useCloakBrowser) {
    const { launchPersistentContext } = await getCloakBrowserModule();
    return launchPersistentContext({
      userDataDir,
      ...commonOptions,
      humanize: CONFIG.cloakHumanize,
      geoip: CONFIG.cloakGeoip
    });
  }

  return chromium.launchPersistentContext(userDataDir, {
    ...commonOptions,
    channel: CONFIG.useChrome ? "chrome" : undefined
  });
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
    await Promise.race([
      page.waitForTimeout(ms),
      stopPromise
    ]);
    return !shouldStop && !page.isClosed();
  } catch (error) {
    if (page.isClosed()) return false;
    throw error;
  }
}

async function clickFirstVisible(locator, options = {}) {
  const rejectText = options.rejectText;
  try {
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      const item = locator.nth(i);
      if (!(await item.isVisible().catch(() => false))) continue;
      if (rejectText) {
        const text = await item.innerText({ timeout: 25 }).catch(() => "");
        const label = await item.getAttribute("aria-label", { timeout: 25 }).catch(() => "");
        if (rejectText.test(`${text} ${label}`)) continue;
      }
      await item.click({ timeout: 25, force: true });
      return true;
    }
  } catch {}
  return false;
}

function candidateFrames(page) {
  const frames = page.frames();
  const mainFrame = page.mainFrame();
  const prioritized = [
    mainFrame,
    ...frames.filter((frame) => /zoom\.us|zoomgov\.com/i.test(frame.url())),
    ...frames
  ];
  return [...new Set(prioritized)].slice(0, CONFIG.maxFrameScanPerCycle);
}

function zoomTextLocator(frame, textPattern, elementSelector = "button, a") {
  return frame.locator(elementSelector).filter({ hasText: textPattern });
}

async function fillFirstVisible(locator, value) {
  try {
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      const item = locator.nth(i);
      if (await item.isVisible().catch(() => false)) {
        await item.fill(value, { timeout: 250 }).catch(async () => {
          await item.click({ timeout: 250, force: true });
          await item.press("ControlOrMeta+A", { delay: 0 }).catch(() => {});
          await item.type(value, { delay: 0 });
        });
        return true;
      }
    }
  } catch {}
  return false;
}


async function findVisibleInFrames(page, selectors) {
  for (const frame of candidateFrames(page)) {
    const locator = frame.locator(selectors.join(", "));
    try {
      const count = await locator.count();
      for (let i = 0; i < count; i += 1) {
        const item = locator.nth(i);
        if (await item.isVisible().catch(() => false)) return item;
      }
    } catch {}
  }
  return null;
}

async function handlePasscodePrompt(page, passcode) {
  const passcodeSelectors = [
    '#input-for-pwd',
    '#inputpasscode',
    'input[name="password"]',
    'input[name="passcode"]',
    'input[type="password"]',
    'input[aria-label*="passcode" i]',
    'input[aria-label*="password" i]',
    'input[placeholder*="passcode" i]',
    'input[placeholder*="password" i]'
  ];

  const passcodeInput = await findVisibleInFrames(page, passcodeSelectors);
  if (!passcodeInput) return false;

  if (!passcode) {
    console.log('PASSCODE_REQUIRED: Meeting requires a passcode, but no passcode was provided.');
    requestStop('meeting passcode required');
    return true;
  }

  await passcodeInput.fill(passcode, { timeout: 250 }).catch(async () => {
    await passcodeInput.click({ timeout: 250, force: true });
    await passcodeInput.press('ControlOrMeta+A', { delay: 0 }).catch(() => {});
    await passcodeInput.type(passcode, { delay: 0 });
  });
  console.log('Filled meeting passcode.');
  return true;
}

async function fillFirstVisibleInFrames(page, selectors, value) {
  for (const frame of candidateFrames(page)) {
    const locator = frame.locator(selectors.join(", "));
    if (await fillFirstVisible(locator, value)) return true;
  }
  return false;
}

async function setEditableText(locator, page, value) {
  await locator.click({ timeout: 250, force: true }).catch(() => {});
  const filled = await locator.fill(value, { timeout: 250 }).then(() => true).catch(() => false);
  if (filled) return true;

  const evaluated = await locator.evaluate((node, text) => {
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
      node.value = text;
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    if (node instanceof HTMLElement && node.isContentEditable) {
      node.focus();
      node.textContent = text;
      node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return true;
    }
    return false;
  }, value).catch(() => false);
  if (evaluated) return true;

  await locator.press("ControlOrMeta+A", { delay: 0 }).catch(() => {});
  await page.keyboard.type(value, { delay: 0 }).catch(() => {});
  return true;
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
  const frames = candidateFrames(page);
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


async function dismissNativeAppPrompts(page) {
  for (const frame of page.frames()) {
    await clickFirstVisible(frame.getByRole("button", { name: /cancel|not now|stay on browser|continue in browser/i })).catch(() => false);
  }
}

async function ensureZoomWebClient(page) {
  const currentUrl = page.url();
  const meetingId = extractMeetingId(currentUrl);
  if (!meetingId || /\/wc\//i.test(currentUrl)) return false;

  const webClientUrl = `https://app.zoom.us/wc/${meetingId}/join?prefer=1`;
  console.log(`[shell] Redirecting Zoom native-app link to web client: ${webClientUrl}`);
  await page.goto(webClientUrl, { waitUntil: "domcontentloaded", signal: stopController.signal });
  return true;
}

async function clickJoinFromBrowser(page) {
  await ensureZoomWebClient(page).catch(() => false);
  await dismissNativeAppPrompts(page).catch(() => false);
  const frames = page.frames();
  for (const frame of frames) {
    if (
      (await clickFirstVisible(frame.getByRole("link", { name: /join from (your )?browser|join using browser|use browser|browser/i }))) ||
      (await clickFirstVisible(frame.getByRole("button", { name: /join from (your )?browser|join using browser|use browser|browser/i }))) ||
      (await clickFirstVisible(zoomTextLocator(frame, /join from (your )?browser|join using browser|use browser|browser/i, "a, button, span, div"))) ||
      (await clickFirstVisible(frame.locator('[data-testid*="join-browser" i], [data-testid*="browser-join" i], [id*="join-browser" i], [class*="join-browser" i]')))
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

async function clickAnyJoinButton(page, options = {}) {
  const minIntervalMs = options.minIntervalMs ?? 1500;
  const lastClickAt = lastJoinButtonClickAtByPage.get(page) || 0;
  if (!options.force && Date.now() - lastClickAt < minIntervalMs) return false;

  // Enhanced selectors for better coverage
  const selectors = [
    // Primary join buttons
    'button:has-text("Join")',
    'button[aria-label*="join" i]',
    'button[class*="join" i]',
    'button[data-testid*="join" i]',
    // Meeting launch
    'button:has-text("Launch Meeting")',
    'button:has-text("Launch")',
    // Audio join options
    'button:has-text("Join Audio")',
    'button:has-text("Join with Computer Audio")',
    'button:has-text("Computer Audio")',
    // Zoom branded buttons
    '.zm-btn--primary:visible',
    'button.zm-btn--primary:visible',
    '[class*="JoinButton"]',
    '[data-testid="join-button"]',
    // Links
    'a[href*="join" i]',
    // Container buttons
    '#meetingSDKElement button:visible',
    '.in-meeting button:visible',
    // Generic fallbacks
    'button[type="submit"]:visible',
    'button[form*="join" i]',
  ];

  // Try multiple strategies to find and click join button
  for (const sel of selectors) {
    try {
      // Strategy 1: Direct waitForSelector
      let btn = await page.locator(sel).first().elementHandle({ timeout: 300 }).catch(() => null);
      
      if (btn) {
        const shouldClick = await btn.evaluate((element) => {
          const text = `${element.innerText || ""} ${element.getAttribute("aria-label") || ""}`.toLowerCase();
          const isDisabled = element.disabled || element.getAttribute("aria-disabled") === "true";
          const isHidden = window.getComputedStyle(element).display === 'none' || 
                          window.getComputedStyle(element).visibility === 'hidden';
          
          if (isDisabled || isHidden) return false;
          if (!text) return false;
          
          return true;
        }).catch(() => false);
        
        if (shouldClick) {
          await btn.click().catch(async () => {
            await page.locator(sel).first().click({ force: true, timeout: 100 }).catch(() => {});
          });
          lastJoinButtonClickAtByPage.set(page, Date.now());
          console.log(`[join] ✓ Clicked join button: ${sel}`);
          return true;
        }
      }
    } catch (err) {
      // Continue to next selector
    }
  }
  
  // Strategy 2: Search within frames
  for (const frame of candidateFrames(page)) {
    try {
      const frameSelectors = [
        'button:has-text("Join")',
        'button[aria-label*="join" i]',
        '.zm-btn--primary',
        'button[class*="join" i]'
      ];
      
      for (const sel of frameSelectors) {
        const btn = await frame.locator(sel).first().elementHandle({ timeout: 200 }).catch(() => null);
        if (btn) {
          try {
            await btn.click();
            lastJoinButtonClickAtByPage.set(page, Date.now());
            console.log(`[join] ✓ Clicked join button in frame: ${sel}`);
            return true;
          } catch (e) {
            // Try force click
            try {
              await frame.locator(sel).first().click({ force: true, timeout: 100 });
              lastJoinButtonClickAtByPage.set(page, Date.now());
              console.log(`[join] ✓ Force-clicked join button in frame: ${sel}`);
              return true;
            } catch {}
          }
        }
      }
    } catch {}
  }
  
  return false;
}

async function clickChatButton(page) {
  const selectors = [
    (frame) => frame.getByRole("button", { name: /chat|meeting chat/i }),
    (frame) => frame.locator('[aria-label*="chat" i]'),
    (frame) => frame.locator('[data-testid*="chat" i]'),
    (frame) => frame.locator('[id*="chat" i]'),
    (frame) => frame.locator('[class*="chat" i] button, button[class*="chat" i]'),
    (frame) => zoomTextLocator(frame, /chat|meeting chat/i)
  ];

  const frames = candidateFrames(page);
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
    '.ql-editor[contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
    '.chat-box__chat-textarea[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][aria-label*="message" i]',
    '[contenteditable="true"][aria-placeholder*="message" i]',
    '[contenteditable="true"][data-placeholder*="message" i]',
    '[contenteditable="true"][class*="chat" i]',
    'textarea[aria-label*="message" i]',
    'textarea[placeholder*="message" i]',
    'textarea'
  ];

  const frames = candidateFrames(page);
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
  const proxy = getProxyConfig();
  const context = await launchBrowserContext(userDataDir, proxy);

  if (!CONFIG.useCloakBrowser) await applyStealthProfile(context);

  console.log(`[shell] Browser: ${getBrowserLabel(proxy)}`);

  context.on("page", (newPage) => {
    newPage.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
    newPage.on("framenavigated", (frame) => {
      if (frame === newPage.mainFrame()) ensureZoomWebClient(newPage).catch(() => {});
    });
  });

  const page = context.pages()[0] || await context.newPage();
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
  return { context, page, userDataDir };
}

async function closeAllShells(activeShells) {
  await Promise.all(activeShells.map(async (shell) => {
    try {
      if (shell?.context && !shell.context.isClosed()) await shell.context.close({ runBeforeUnload: false }).catch(() => {});
    } catch {}
    try {
      if (shell?.userDataDir) await rm(shell.userDataDir, { recursive: true, force: true }).catch(() => {});
    } catch {}
  }));
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

    await clickAnyJoinButton(page, { minIntervalMs: 3000 });
    const found = await findChatInput(page);
    if (found) return found;

    if (!(await safeWait(page, CONFIG.pollIntervalMs))) return null;
  }
  return null;
}

(async () => {
  const { meetingId, headlessShells } = await getSetupOptions();
  
  // Get message and name from CLI args or prompt interactively
  let message = getArgValue("--message");
  let displayName = getArgValue("--name");
  
  // If message or name not provided on CLI, ask interactively
  if (!message || !displayName) {
    const rl = readline.createInterface({ input, output });
    try {
      if (!displayName) {
        displayName = await rl.question("What name should be used in Zoom? (leave empty for random): ");
        displayName = displayName.trim() || fallbackName();
      }
      if (!message) {
        message = await rl.question("What message should be sent to Zoom chat? (leave empty for default): ");
        message = message.trim() || process.env.ZOOM_CHAT_MESSAGE || "";
      }
    } finally {
      rl.close();
    }
  }
  
  const passcode = getArgValue("--passcode") || process.env.ZOOM_PASSCODE || "";
  const stopAtIso = getArgValue("--stop-at");
  const maxMessagesArg = getNumericArgValue("--max-messages");
  const maxRuntimeArgSeconds = getNumericArgValue("--max-runtime-sec");
  const maxRestartsArg = getNumericArgValue("--max-restarts");

  let sentMessages = 0;
  let messageStopFlag = false;
  let restartCount = 0;
  const startedAt = Date.now();
  stopController = new AbortController();
  const maxRuntimeMs = maxRuntimeArgSeconds > 0 ? maxRuntimeArgSeconds * 1000 : CONFIG.maxRuntimeMs;
  const maxMessages = maxMessagesArg > 0 ? maxMessagesArg : CONFIG.maxMessages;
  const maxRestartCycles = maxRestartsArg > 0 ? maxRestartsArg : CONFIG.maxRestartCycles;
  const stopAtMs = stopAtIso ? Date.parse(stopAtIso) : NaN;

  process.on("SIGINT", () => requestStop("SIGINT received"));
  process.on("SIGTERM", () => requestStop("SIGTERM received"));

  const joinUrls = [
    `https://app.zoom.us/wc/${meetingId}/join?prefer=1`,
    `https://app.zoom.us/wc/join?from=join&confno=${meetingId}&prefer=1`,
    `https://app.zoom.us/wc/join/${meetingId}?prefer=1`,
    `https://zoom.us/wc/${meetingId}/join?prefer=1`,
    `https://zoom.us/wc/join?from=join&confno=${meetingId}&prefer=1`
  ];

  async function loadJoinPage(page) {
    let joinLoaded = false;
    for (const joinUrl of joinUrls) {
      try {
        await page.goto(joinUrl, { waitUntil: "domcontentloaded", signal: stopController.signal });
        await ensureZoomWebClient(page).catch(() => false);
        joinLoaded = true;
        console.log(`[shell] Loaded join page: ${joinUrl}`);
        break;
      } catch (error) {
        if (shouldStop) return false;
        console.log(`[shell] Failed join URL ${joinUrl}: ${error.message}`);
        if (isError1132(error)) throw new Error("RESTART_CYCLE");
      }
    }
    return joinLoaded;
  }

  async function workerLoop(shellIndex, page) {
    // Join + find chat
    console.log(`[shell-${shellIndex}] Starting join sequence...`);
    
    for (let attempt = 0; attempt < 50 && !shouldStop; attempt++) {
      if (attempt % 10 === 0) console.log(`[shell-${shellIndex}] Join attempt ${attempt}...`);
      if (await clickAnyJoinButton(page)) {
        console.log(`[shell-${shellIndex}] ✓ Join button clicked on attempt ${attempt}`);
        break;
      }
      if (!(await safeWait(page, CONFIG.pollIntervalMs))) return;
    }

    console.log(`[shell-${shellIndex}] Looking for name field...`);
    for (let i = 0; i < 30 && !shouldStop; i++) {
      if (shouldStop) return;
      await checkAndHandleCaptcha(page);
      await handlePasscodePrompt(page, passcode);
      if (shouldStop) return;
      const nameSelectors = [
        "#input-for-name",
        "#inputname",
        'input[name="displayName"]',
        'input[name="screenName"]',
        'input[name="username"]',
        'input[autocomplete="name"]',
        'input[aria-label*="name" i]',
        'input[placeholder*="name" i]',
        'input[type="text"]'
      ];
      if (await fillFirstVisibleInFrames(page, nameSelectors, displayName)) {
        console.log(`[shell-${shellIndex}] ✓ Name field filled: ${displayName}`);
        break;
      }
      await safeWait(page, CONFIG.pollIntervalMs);
    }

    console.log(`[shell-${shellIndex}] Final join clicks...`);
    for (let i = 0; i < 50 && !shouldStop; i++) {
      if (i % 10 === 0) console.log(`[shell-${shellIndex}] Final join attempt ${i}...`);
      await handlePasscodePrompt(page, passcode);
      if (shouldStop) return;
      if (await clickAnyJoinButton(page, { force: true })) {
        console.log(`[shell-${shellIndex}] ✓ Final join button clicked on attempt ${i}`);
        break;
      }
      await safeWait(page, CONFIG.pollIntervalMs);
    }

    await handlePasscodePrompt(page, passcode);
    if (shouldStop) return;

    console.log(`[shell-${shellIndex}] Waiting for chat input (timeout: ${CONFIG.chatDiscoveryTimeoutMs}ms)...`);
    const chatTarget = await waitForChatInput(page);
    if (!chatTarget) {
      console.log(`[shell-${shellIndex}] ✗ Chat input NOT found - restarting...`);
      throw new Error("RESTART_CYCLE");
    }

    const { locator: chatBox, selector } = chatTarget;
    await chatBox.click().catch(() => {});
    console.log(`[shell-${shellIndex}] ✓ Chat input found! Selector: ${selector}`);

    while (!shouldStop && !page.isClosed()) {
      if (await detectRestartCondition(page)) throw new Error("RESTART_CYCLE");
      if (maxRuntimeMs > 0 && Date.now() - startedAt >= maxRuntimeMs) requestStop(`max runtime reached (${maxRuntimeMs}ms)`);
      if (Number.isFinite(stopAtMs) && Date.now() >= stopAtMs) requestStop(`stop-at reached (${new Date(stopAtMs).toISOString()})`);

      if ((maintenanceTick++ % 15) === 0 && !(await findChatInput(page))) {
        console.log(`[shell-${shellIndex}] Maintenance: Re-clicking join button...`);
        await clickAnyJoinButton(page, { minIntervalMs: 5000 }).catch(() => {});
      }

      if (maxMessages > 0 && sentMessages >= maxMessages) {
        requestStop(`max messages reached (${maxMessages})`);
        return;
      }

      if (maxMessages > 0 && messageStopFlag) return;

      // Check & claim atomically before any async work
      if (maxMessages > 0 && sentMessages >= maxMessages) {
        messageStopFlag = true;
        return;
      }

      if (message) {
        await setEditableText(chatBox, page, message).catch(() => {});
      } else {
        await chatBox.press("ControlOrMeta+V", { delay: 0 }).catch(async () => {
          await page.keyboard.press("ControlOrMeta+V").catch(() => {});
        });
      }

      await chatBox.press("Enter", { delay: 0 }).catch(async () => {
        await page.keyboard.press("Enter").catch(() => {});
      });

      sentMessages += 1;
      console.log(`[shell-${shellIndex}] ✓ Message sent (${sentMessages}/${maxMessages > 0 ? maxMessages : "∞"})`);

      if (maxMessages > 0 && sentMessages >= maxMessages) {
        messageStopFlag = true;
      }

      if (!(await safeWait(page, CONFIG.repeatSpeedMs))) return;
    }
  }

  while (!shouldStop) {
    const activeShells = [];
    try {
      if (maxRuntimeMs > 0 && Date.now() - startedAt >= maxRuntimeMs) requestStop(`max runtime reached (${maxRuntimeMs}ms)`);
      if (Number.isFinite(stopAtMs) && Date.now() >= stopAtMs) requestStop(`stop-at reached (${new Date(stopAtMs).toISOString()})`);
      if (shouldStop) break;

      const shellResults = await Promise.allSettled(
        Array.from({ length: headlessShells }, () => createFreshShell())
      );
      for (const result of shellResults) {
        if (result.status === 'fulfilled') {
          activeShells.push(result.value);
        } else {
          console.error('[shell] creation failed:', result.reason);
        }
      }
      if (activeShells.length === 0) {
        console.error('[shell] all shells failed to create');
        return;
      }

      console.log(`Opening Zoom with ${headlessShells} headless shell(s)...`);

      // Load join page in each shell
      await Promise.all(activeShells.map(async (shell, idx) => {
        if (shouldStop) return;
        const ok = await loadJoinPage(shell.page);
        if (!ok) {
          console.log(`[shell-${idx}] ✗ Failed to load join page`);
          throw new Error("RESTART_CYCLE");
        }
        console.log(`[shell-${idx}] ✓ Join page loaded successfully`);
      }));

      // Run parallel workers (each shell participates)
      await Promise.all(activeShells.map((shell, idx) => workerLoop(idx + 1, shell.page)));

      break;
    } catch (error) {
      if (error?.message === "RESTART_CYCLE") {
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
      // If stop requested, begin immediate shutdown; otherwise normal cleanup
      await closeAllShells(activeShells);
      const shouldDelayShutdown = shouldStop && CONFIG.gracefulShutdownMs > 0 && !/^SIG(?:INT|TERM)\b/.test(stopReason);
      if (shouldDelayShutdown) await new Promise((resolve) => setTimeout(resolve, CONFIG.gracefulShutdownMs));
    }
  }

  if (shouldStop) console.log(`Stopped safely: ${stopReason || "stop requested"}`);
})();

