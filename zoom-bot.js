#!/usr/bin/env node
const { chromium } = require("playwright");
const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");

const TURBO_MODE = true;
const REPEAT_SPEED_MS = 0;
const CHAT_DISCOVERY_TIMEOUT_MS = 860000;
const POLL_INTERVAL_MS = 0;

let lastScrollLogTime = 0;

function randomName() {
  const names = ["Mundy", "Jake", "slmpig", "Nathan", "Intelll"];
  return names[Math.floor(Math.random() * names.length)];
}

async function checkAndHandleCaptcha(page) {
  for (const frame of page.frames()) {
    try {
      // Detect standard reCAPTCHA 'I am not a robot' checkbox
      const recaptcha = frame.locator('#recaptcha-anchor');
      if (await recaptcha.count() > 0 && await recaptcha.isVisible()) {
        console.log("reCAPTCHA checkbox detected! Clicking...");
        await recaptcha.click({ force: true }).catch(() => {});
        // Note: For complex image challenges, a third-party solver API would be required here.
        return true;
      }

      // Detect other 'I am not a robot' buttons or labels used by Zoom
      const genericCaptcha = frame.locator('button:has-text("I am not a robot"), [aria-label*="not a robot" i]');
      if (await genericCaptcha.count() > 0 && await genericCaptcha.isVisible()) {
        console.log("Generic captcha button detected! Clicking...");
        await genericCaptcha.click({ force: true }).catch(() => {});
        return true;
      }
    } catch (e) {
      // Ignore errors from detached or cross-origin frames
    }
  }
  return false;
}

function normalizeMeetingId(value) {
  const digitsOnly = String(value || "").replace(/\D/g, "");
  return digitsOnly.length >= 9 ? digitsOnly : "";
}

async function getMeetingId() {
  const fromArg = normalizeMeetingId(process.argv[2]);
  if (fromArg) return fromArg;

  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const entered = await rl.question("Enter Zoom meeting ID: ");
      const meetingId = normalizeMeetingId(entered);
      if (meetingId) return meetingId;
      console.log("Invalid meeting ID. Please enter at least 9 digits.");
    }
  } finally {
    rl.close();
  }
}

async function safeWait(page, ms) {
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
    if (await locator.count() === 0) return false;
    const first = locator.first();
    await first.click({ timeout: 10, force: true });
    return true;
  } catch {
    return false;
  }
}

async function clickAnyJoinButton(page) {
  await checkAndHandleCaptcha(page);

  for (const frame of page.frames()) {
    try {
      const bodyText = await frame.innerText("body").catch(() => "");
      const isRemoved = await frame.locator('.zm-modal-body-title:has-text("You have been removed")').count().catch(() => 0) > 0;
      const inWaitingRoom = bodyText.toLowerCase().includes("waiting room") || bodyText.toLowerCase().includes("let you in soon");

      if (isRemoved || inWaitingRoom) {
        throw new Error("RESTART_CYCLE");
      }

      if (
        (await frame.locator('.zm-modal-body-title:has-text("Meeting alert")').count().catch(() => 0) > 0 && await clickFirstVisible(frame.getByRole("button", { name: "Later" }))) ||
        (await clickFirstVisible(frame.locator("#disclaimer_agree"))) ||
        (await clickFirstVisible(frame.getByRole("button", { name: /join|launch meeting|continue|audio|video|without/i }))) ||
        (await clickFirstVisible(frame.locator(".preview-join-button"))) ||
        (await clickFirstVisible(frame.locator('[data-testid*="join" i]'))) ||
        (await clickFirstVisible(frame.locator('button:has-text("Join")')))
      ) {
        return true;
      }
    } catch (e) {
      if (e.message === "RESTART_CYCLE") throw e;
      // Ignore detached frame errors
    }
  }
  // If we didn't click anything, perform a small scroll down to reveal potential hidden buttons
  if (Date.now() - lastScrollLogTime > 2000) {
    console.log("No buttons found yet, scrolling down to discover elements...");
    lastScrollLogTime = Date.now();
  }
  await page.mouse.wheel(0, 300).catch(() => {});
  return false;
}

async function clickChatButton(page) {
  for (const frame of page.frames()) {
    if (
      (await clickFirstVisible(frame.getByRole("button", { name: /chat/i }))) ||
      (await clickFirstVisible(frame.locator('[aria-label*="chat" i]'))) ||
      (await clickFirstVisible(frame.locator('[data-testid*="chat" i]'))) ||
      (await clickFirstVisible(frame.locator('button:has-text("Chat")')))
    ) {
      return true;
    }
  }
  return false;
}

async function triggerChatShortcut(page) {
  for (const combo of ["Alt+h"]) {
    await page.keyboard.press(combo, { delay: 0 }).catch(() => {});
    if (!(await safeWait(page, TURBO_MODE ? 0 : 250))) return;
  }
}

async function findChatInput(page) {
  const selectors = [
    '.tiptap.ProseMirror[contenteditable="true"]',
    ".tiptap.ProseMirror",
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][aria-label*="message" i]',
    'textarea[aria-label*="message" i]',
    "textarea"
  ];

  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const locator = frame.locator(selector).first();
      try {
        if ((await locator.count()) > 0 && (await locator.isVisible())) {
          return { locator, selector };
        }
      } catch {}
    }
  }
  return null;
}

async function waitForChatInput(page) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < CHAT_DISCOVERY_TIMEOUT_MS) {
    if (page.isClosed()) return null;
    await clickAnyJoinButton(page); // Handles removal detection and "Join Audio" popups
    const found = await findChatInput(page);
    if (found) return found;
    await clickChatButton(page);
    await triggerChatShortcut(page);
    if (!(await safeWait(page, POLL_INTERVAL_MS))) return null;
  }
  return null;
}

(async () => {
  const meetingId = await getMeetingId();
  while (true) {
    let browser;
    try {
    browser = await chromium.launch({
      headless: false, // keep visible for Zoom
      args: ["--disable-blink-features=AutomationControlled"]
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    console.log("Opening Zoom...");
    await page.goto(`https://app.zoom.us/wc/${meetingId}/join`, {
      waitUntil: "domcontentloaded"
    });

    console.log("Waiting for join button...");
    let joinStep1 = false;
    for (let i = 0; i < 50; i++) {
      if (await clickAnyJoinButton(page)) { joinStep1 = true; break; }
      if (!(await safeWait(page, POLL_INTERVAL_MS))) return;
    }

    // ------------------------
    // 2. Name input
    // ------------------------
    for (let i = 0; i < 30; i++) {
      await checkAndHandleCaptcha(page);
      const nameInput = page.locator("#input-for-name");
      if (await nameInput.count()) {
        await nameInput.fill(randomName());
        break;
      }
      await safeWait(page, POLL_INTERVAL_MS);
    }

    for (let i = 0; i < 50; i++) {
      if (await clickAnyJoinButton(page)) break;
      await safeWait(page, POLL_INTERVAL_MS);
    }
    
    console.log("Waiting for meeting UI...");
    
    // ------------------------
    // 4. Wait for meeting UI
    // ------------------------
    // 5. Open chat
    // ------------------------
    let chatOpened = false;
    for (let i = 0; i < 50; i++) {
      await clickChatButton(page);
      await triggerChatShortcut(page);
      if (await findChatInput(page)) { chatOpened = true; break; }
      if (!(await safeWait(page, POLL_INTERVAL_MS))) return;
    }
    
    // ------------------------
    // 6. Repeated paste + enter
    // ------------------------
    const chatTarget = await waitForChatInput(page);
    if (!chatTarget) {
      console.log("Chat box not found after retries. You may still be in waiting room, chat may be disabled, or Zoom UI may differ.");
      return;
    }

    const { locator: chatBox, selector } = chatTarget;
    await chatBox.click().catch(() => {});
    console.log(`Chat input found using selector: ${selector}`);
    console.log(`Chat spam loop started at ${REPEAT_SPEED_MS}ms speed.`);

    let lastModalCheck = 0;
    while (!page.isClosed()) {
      if (Date.now() - lastModalCheck > 1000) {
        await clickAnyJoinButton(page); // Periodic check for removal modal
        lastModalCheck = Date.now();
      }
      await chatBox.press("ControlOrMeta+V", { delay: 0 }).catch(async () => {
        await page.keyboard.press("ControlOrMeta+V").catch(() => {});
      });
      await chatBox.press("Enter", { delay: 0 }).catch(async () => {
        await page.keyboard.press("Enter").catch(() => {});
      });
      if (!(await safeWait(page, REPEAT_SPEED_MS))) {
        break;
      }
    }
    console.log("Page closed; stopped chat loop.");
    break;
  } catch (error) {
    if (error.message === "RESTART_CYCLE") {
      console.log("Detected removal or waiting room. Restarting cycle...");
      continue;
    }
    if (String(error).includes("Target page, context or browser has been closed")) {
      console.log("Page/browser closed during automation. Exiting cleanly.");
      break;
    }
    throw error;
  } finally {
    if (browser && browser.isConnected()) {
      await browser.close().catch(() => {});
    }
  }
  }
})();