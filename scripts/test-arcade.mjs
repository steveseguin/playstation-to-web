import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.ARCADE_URL || 'http://127.0.0.1:4174';
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
  assert.match(await page.locator('#mods-dialog').innerText(), /No mods available yet/);
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
    await page.locator('#open-mods').click();
    assert.match(await page.locator('#mods-game').textContent(), new RegExp(title));
    await page.locator('#close-mods').click();
  }
  await page.locator('#stop').click();
  assert.equal(await page.locator('iframe').count(), 0);
  await page.getByRole('button', { name: 'Harvest Moon, your own build required' }).click();
  assert.match(await page.locator('#play').innerText(), /Build & play/);
  assert.match(await page.locator('#play-note').textContent(), /own compiled build/);
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
  await cross.scrollIntoViewIfNeeded();
  const touch = await cross.boundingBox();
  const session = await mobile.context().newCDPSession(mobile);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touch.x + touch.width / 2, y: touch.y + touch.height / 2 }] });
  await mobile.waitForTimeout(120);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForTimeout(500);
  const mobileCanvas = mobileFrame.locator('canvas').first();
  const touchLaunched = await mobileCanvas.screenshot();
  await mobile.waitForTimeout(400);
  assert.ok(!touchLaunched.equals(await mobileCanvas.screenshot()), 'touch launch animates the game');
  await mobile.screenshot({ path: 'test-results/arcade-mobile-playing.png', fullPage: true });
  const offline = await browser.newPage();
  await offline.route('https://cdn.emulatorjs.org/**', route => route.abort());
  await offline.goto(base);
  await offline.locator('#play').click();
  await offline.waitForFunction(() => document.getElementById('status').classList.contains('error'));
  assert.match(await offline.locator('#status').innerText(), /could not load/);
  await offline.locator('#stop').click();
  assert.equal(await offline.locator('iframe').count(), 0);
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('Passed: both real PS1 games boot, accept input and animate; game switching, filters, mod dialogs, build-only route and mobile layout.');
} finally {
  await browser?.close();
  server?.kill();
}
