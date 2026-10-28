import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.ARCADE_URL || 'http://127.0.0.1:4174';
const assetBase = base.endsWith('/') ? base : base + '/';
const server = process.env.ARCADE_URL ? null : spawn(process.execPath, ['scripts/serve-arcade.mjs'], { env: { ...process.env, PORT: '4174' }, stdio: 'pipe' });
let browser;
try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(base)).ok) break; } catch { /* wait for owned server */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  await mkdir('test-results', { recursive: true });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  assert.equal(await page.locator('.game-card').count(), 3);
  await page.screenshot({ path: 'test-results/arcade-desktop.png', fullPage: true });
  await page.locator('[data-filter="ready"]').click();
  assert.equal(await page.locator('.game-card').count(), 2);
  await page.locator('[data-filter="all"]').click();
  await page.locator('#open-mods').click();
  assert.equal(await page.locator('#mods-dialog').evaluate(el => el.open), true);
  assert.match(await page.locator('#mods-dialog').innerText(), /Paddle color/);
  assert.equal(await page.locator('#apply-mods').isDisabled(), true, 'mods require a running game');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#mods-dialog').evaluate(el => el.open), false);

  for (const [id, title, move] of [['paddle-rally', 'Paddle Rally', 'ArrowDown'], ['brick-shift', 'Brick Shift', 'ArrowRight']]) {
    console.log(`Checking ${title}: boot, movement, launch, and pause.`);
    await page.getByRole('button', { name: `${title}, ready to play`, exact: true }).click();
    assert.equal(await page.locator('iframe').count(), 0, 'switching games destroys previous player');
    assert.equal(await page.locator('#game-title').textContent(), title);
    await page.locator('#play').click();
    await page.waitForFunction(() => document.getElementById('session-label').textContent === 'NOW PLAYING', null, { timeout: 90000 });
    const frame = page.frames().find(frame => frame.url().includes('player.html'));
    const canvas = frame.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 30000 });
    await canvas.click();
    await page.waitForTimeout(800);
    const before = await canvas.screenshot();
    await page.keyboard.down(move);
    await page.waitForTimeout(350);
    await page.keyboard.up(move);
    await page.waitForTimeout(150);
    const moved = await canvas.screenshot();
    assert.ok(!before.equals(moved), `${title}: keyboard input changes the rendered game`);
    await page.keyboard.press('x', { delay: 120 });
    await page.waitForTimeout(400);
    const launched = await canvas.screenshot();
    await page.waitForTimeout(400);
    assert.ok(!launched.equals(await canvas.screenshot()), `${title}: game animates after launch`);
    await page.keyboard.press('Enter', { delay: 120 });
    await page.waitForTimeout(200);
    const bounds = await canvas.boundingBox();
    // Exclude the emulator's auto-hiding toolbar from the gameplay comparison.
    const clip = { x: bounds.x + bounds.width * .02, y: bounds.y + bounds.height * .15,
      width: bounds.width * .96, height: bounds.height * .65 };
    const paused = await page.screenshot({ clip });
    await page.waitForTimeout(400);
    assert.ok(paused.equals(await page.screenshot({ clip })), `${title}: pause freezes the game`);
    await page.screenshot({ path: `test-results/${id}-playing.png`, fullPage: true });
    console.log(`Checking ${title}: live color, size, speed and restoring defaults.`);
    // Capture the guest framebuffer directly: dialogs and emulator toolbars
    // must not count as evidence that an in-game mod changed the picture.
    const guestImage = async () => Buffer.from(await frame.evaluate(async () =>
      Array.from(await window.EJS_emulator.gameManager.screenshot())));
    const original = await guestImage();
    // Locate the compiled globals in the core's saved RAM, independently of
    // the UI acknowledgement. This also verifies the speed code really writes
    // the game's variable (speed does not change a paused screenshot).
    const manifest = await (await fetch(new URL('mod-manifest.json', assetBase))).json();
    const symbols = manifest[id].symbols;
    const exe = Buffer.from(await (await fetch(new URL(`games/${id}.exe`, assetBase))).arrayBuffer());
    const firstAddress = Math.min(...Object.values(symbols));
    const lastAddress = Math.max(...Object.values(symbols));
    const fileOffset = firstAddress - exe.readUInt32LE(0x18) + 2048;
    const signature = exe.subarray(fileOffset, fileOffset + lastAddress - firstAddress + 4);
    const guestState = async () => Buffer.from(await frame.evaluate(() => {
      const bytes = window.EJS_emulator.gameManager.getState();
      const chunks = [];
      for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
      return btoa(chunks.join(''));
    }), 'base64');
    const initialState = await guestState();
    const ramOffset = initialState.indexOf(signature);
    assert.ok(ramOffset >= 0, `${title}: locate mod globals in saved PS1 RAM`);
    assert.equal(initialState.lastIndexOf(signature), ramOffset, 'RAM signature must be unique');
    const speedOffset = ramOffset + symbols.ball_speed - firstAddress;
    for (const [mod, option] of [['color', 'mint'], ['size', 'large']]) {
      await page.locator('#open-mods').click();
      assert.match(await page.locator('#mods-game').textContent(), new RegExp(title));
      await page.locator(`#mod-${mod}`).selectOption(option);
      await page.locator('#apply-mods').click();
      await page.waitForFunction(() => document.getElementById('mod-status').textContent.startsWith('Applied live'));
      await page.waitForTimeout(200);
      assert.ok(!original.equals(await guestImage()), `${title}: ${mod} changes the actual PS1 framebuffer`);
      assert.equal(page.frames().find(f => f.url().includes('player.html')), frame, 'mods keep the same game session');
      await page.screenshot({ path: `test-results/${id}-mod-${mod}.png`, fullPage: true });
      await page.locator('#reset-mods').click();
      await page.waitForFunction(() => document.getElementById('mod-status').textContent.startsWith('Original settings restored'));
      await page.waitForTimeout(200);
      assert.ok(original.equals(await guestImage()), `${title}: restoring ${mod} returns the exact paused framebuffer`);
      await page.locator('#close-mods').click();
    }
    await page.locator('#open-mods').click();
    await page.locator('#mod-speed').selectOption('fast');
    await page.locator('#apply-mods').click();
    await page.waitForFunction(() => document.getElementById('mod-status').textContent.startsWith('Applied live'));
    await page.waitForTimeout(200);
    assert.equal((await guestState()).readUInt32LE(speedOffset), 200, `${title}: fast speed reaches PS1 RAM`);
    await page.locator('#close-mods').click();
    await page.locator('#open-mods').click();
    assert.equal(await page.locator('#mod-speed').inputValue(), 'fast', 'applied choices survive reopening');
    await page.locator('#mod-speed').selectOption('slow');
    await page.locator('#apply-mods').click();
    await page.waitForFunction(() => document.getElementById('mod-status').textContent.startsWith('Applied live'));
    await page.waitForTimeout(200);
    assert.equal((await guestState()).readUInt32LE(speedOffset), 50, `${title}: slow speed reaches PS1 RAM`);
    await page.locator('#reset-mods').click();
    await page.waitForFunction(() => document.getElementById('mod-status').textContent.startsWith('Original settings restored'));
    await page.waitForTimeout(200);
    assert.equal((await guestState()).readUInt32LE(speedOffset), 100, `${title}: default speed restored in PS1 RAM`);
    await page.locator('#close-mods').click();
  }
  await page.locator('#stop').click();
  assert.equal(await page.locator('iframe').count(), 0);
  await page.getByRole('button', { name: 'Harvest Moon, your own build required' }).click();
  assert.match(await page.locator('#play').innerText(), /Build & play/);
  assert.match(await page.locator('#play-note').textContent(), /own compiled build/);
  await page.locator('#open-mods').click();
  assert.equal(await page.locator('#mod-editor').isVisible(), false);
  assert.equal(await page.locator('#empty-mods').isVisible(), true);
  await page.locator('#close-mods').click();
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#play').click();
  const popup = await popupPromise;
  await popup.close();

  const mobile = await browser.newPage({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 } });
  // Regression: Linux Chromium's Android emulation can report no touch points.
  await mobile.addInitScript(() => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 0, configurable: true }));
  await mobile.goto(base + '?game=brick-shift');
  assert.equal(await mobile.locator('#game-title').textContent(), 'Brick Shift');
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow on mobile');
  await mobile.locator('#open-mods').click();
  await mobile.screenshot({ path: 'test-results/arcade-mobile-mods.png', fullPage: true });
  await mobile.locator('#close-mods').click();
  await mobile.screenshot({ path: 'test-results/arcade-mobile.png', fullPage: true });
  console.log('Checking mobile touch controls.');
  await mobile.locator('#play').tap();
  await mobile.waitForFunction(() => document.getElementById('session-label').textContent === 'NOW PLAYING', null, { timeout: 90000 });
  const mobileFrame = mobile.frames().find(frame => frame.url().includes('player.html'));
  assert.equal(await mobileFrame.locator('.ejs_menu_bar').evaluate(el => el.classList.contains('ejs_menu_bar_hidden')), true, 'startup menu must not cover touch controls');
  const cross = mobileFrame.locator('.ejs_virtualGamepad_button.b_cross');
  await mobile.waitForTimeout(300);
  try {
    await cross.waitFor({ state: 'visible', timeout: 10000 });
  } catch (error) {
    console.log('Mobile diagnostics:', await mobileFrame.evaluate(() => ({
      url: location.href, touch: navigator.maxTouchPoints, ua: navigator.userAgent,
      options: window.EJS_defaultOptions, mobile: window.EJS_emulator?.isMobile,
      pad: document.querySelector('.ejs_virtualGamepad_parent')?.outerHTML.slice(0, 900),
      bounds: document.querySelector('.b_cross')?.getBoundingClientRect().toJSON(),
    })));
    throw error;
  }
  // Engine start precedes the PS1 program's GPU/pad initialization. Give the
  // guest the same boot settling time as the desktop input check.
  await mobile.waitForTimeout(1000);
  await cross.tap({ trial: true });
  const touch = await cross.boundingBox();
  const session = await mobile.context().newCDPSession(mobile);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touch.x + touch.width / 2, y: touch.y + touch.height / 2 }] });
  await mobile.waitForTimeout(200);
  assert.equal(await cross.evaluate(el => el.classList.contains('ejs_virtualGamepad_button_down')), true, 'native touch reaches the launch button');
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForTimeout(500);
  const mobileCanvas = mobileFrame.locator('canvas').first();
  const touchLaunched = await mobileCanvas.screenshot();
  await mobile.waitForTimeout(400);
  await mobile.screenshot({ path: 'test-results/arcade-mobile-playing.png', fullPage: true });
  assert.ok(!touchLaunched.equals(await mobileCanvas.screenshot()), 'touch launch animates the game');
  await mobile.locator('#open-mods').tap();
  await mobile.locator('#mod-color').selectOption('pink');
  await mobile.locator('#apply-mods').tap();
  await mobile.waitForFunction(() => document.getElementById('mod-status').textContent.startsWith('Applied live'));
  await mobile.screenshot({ path: 'test-results/arcade-mobile-applied.png', fullPage: true });
  await mobile.locator('#close-mods').tap();
  assert.equal(mobile.frames().find(f => f.url().includes('player.html')), mobileFrame, 'mobile mod keeps playing in the same session');
  const offline = await browser.newPage();
  await offline.route('https://cdn.emulatorjs.org/**', route => route.abort());
  await offline.goto(base);
  await offline.locator('#play').click();
  await offline.waitForFunction(() => document.getElementById('status').classList.contains('error'));
  assert.match(await offline.locator('#status').innerText(), /could not load/);
  await offline.locator('#stop').click();
  assert.equal(await offline.locator('iframe').count(), 0);
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('Passed: both PS1 games boot and play; live color/size change the guest framebuffer; speed values reach PS1 RAM; defaults restore; desktop and touch mod controls work.');
} finally {
  await browser?.close();
  server?.kill();
}
