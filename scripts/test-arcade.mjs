import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.ARCADE_URL || 'http://127.0.0.1:4174';
function observeWasm() {
  const instantiate = WebAssembly.instantiate;
  window.testModAudits = [];
  window.testInstances = 0;
  let pendingMod;
  addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'arcade-apply-mods') return;
    pendingMod = { before: structuredClone(window.testDrawn), started: performance.now(), instance: window.testGame };
  });
  WebAssembly.instantiate = async (...args) => {
    const imports = args[1]?.arcade;
    if (imports) {
      const rect = imports.rect, text = imports.text;
      imports.rect = (...values) => {
        // This is the first primitive emitted by every compiled game_render.
        if (values[0] === 10 && values[1] === 32 && values[2] === 300 && values[3] === 2) {
          window.testDrawn = { rectangles: [], labels: [] };
          if (pendingMod) {
            const wasm = window.testGame;
            const memory = new DataView(wasm.memory.buffer);
            window.testModAudits.push({
              before: pendingMod.before, after: window.testDrawn,
              sameInstance: pendingMod.instance === wasm,
              elapsed: performance.now() - pendingMod.started,
              values: Object.fromEntries(['accent_red', 'accent_green', 'accent_blue', 'paddle_width', 'paddle_height', 'ball_speed'].map(name => [name, memory.getInt32(wasm[name].value, true)])),
            });
            pendingMod = null;
          }
        }
        window.testDrawn.rectangles.push(values);
        return rect(...values);
      };
      imports.text = (x, y, pointer) => {
        const memory = new Uint8Array(window.testGame.memory.buffer);
        let end = pointer;
        while (memory[end]) end++;
        window.testDrawn.labels.push([x, y, new TextDecoder().decode(memory.subarray(pointer, end))]);
        return text(x, y, pointer);
      };
    }
    const result = await instantiate(...args);
    window.testGame = (result.instance || result).exports;
    window.testInstances++;
    return result;
  };
}
async function waitForGuest(predicate, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(message);
}
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
  await page.addInitScript(observeWasm);
  const externalRequests = [];
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== new URL(base).origin) {
      externalRequests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
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
    // Compare the playfield while paused.
    const clip = { x: bounds.x + bounds.width * .02, y: bounds.y + bounds.height * .15,
      width: bounds.width * .96, height: bounds.height * .65 };
    const paused = await page.screenshot({ clip });
    await page.waitForTimeout(400);
    assert.ok(paused.equals(await page.screenshot({ clip })), `${title}: pause freezes the game`);
    await page.screenshot({ path: `test-results/${id}-playing.png`, fullPage: true });
    console.log(`Checking ${title}: live color, size, speed and restoring defaults.`);
    // Inspect the actual canvas and compiled module, independently of UI messages.
    const guestImage = async () => Buffer.from(await canvas.evaluate(el => el.toDataURL().split(',')[1]), 'base64');
    const original = await guestImage();
    const readGlobal = name => frame.evaluate(name => {
      const wasm = window.testGame;
      return new DataView(wasm.memory.buffer).getInt32(wasm[name].value, true);
    }, name);
    for (const [mod, option] of [['color', 'mint'], ['size', 'large']]) {
      await page.locator('#open-mods').click();
      assert.match(await page.locator('#mods-game').textContent(), new RegExp(title));
      await page.locator(`#mod-${mod}`).selectOption(option);
      await page.locator('#apply-mods').click();
      await page.waitForFunction(() => document.getElementById('mod-status').textContent.startsWith('Applied live'));
      const symbol = mod === 'color' ? 'accent_green' : id === 'brick-shift' ? 'paddle_width' : 'paddle_height';
      const expected = mod === 'color' ? 240 : id === 'brick-shift' ? 80 : 72;
      await waitForGuest(async () => (await readGlobal(symbol)) === expected,
        `${title}: ${mod} reaches Wasm memory`);
      try {
        await waitForGuest(async () => !original.equals(await guestImage()), `${title}: ${mod} changes the actual game framebuffer`);
      } catch (error) {
        await writeFile(`test-results/${id}-${mod}-before.png`, original);
        await writeFile(`test-results/${id}-${mod}-after.png`, await guestImage());
        throw error;
      }
      assert.equal(page.frames().find(f => f.url().includes('player.html')), frame, 'mods keep the same game session');
      await page.screenshot({ path: `test-results/${id}-mod-${mod}.png`, fullPage: true });
      await page.locator('#reset-mods').click();
      await page.waitForFunction(() => document.getElementById('mod-status').textContent.startsWith('Original settings restored'));
      await waitForGuest(async () => original.equals(await guestImage()), `${title}: restoring ${mod} returns the exact paused framebuffer`);
      await page.locator('#close-mods').click();
    }
    await page.locator('#open-mods').click();
    await page.locator('#mod-speed').selectOption('fast');
    await page.locator('#apply-mods').click();
    await page.waitForFunction(() => document.getElementById('mod-status').textContent.startsWith('Applied live'));
    await waitForGuest(async () => (await readGlobal('ball_speed')) === 200, `${title}: fast speed reaches Wasm memory`);
    await page.locator('#close-mods').click();
    await page.locator('#open-mods').click();
    assert.equal(await page.locator('#mod-speed').inputValue(), 'fast', 'applied choices survive reopening');
    await page.locator('#mod-speed').selectOption('slow');
    await page.locator('#apply-mods').click();
    await page.waitForFunction(() => document.getElementById('mod-status').textContent.startsWith('Applied live'));
    await waitForGuest(async () => (await readGlobal('ball_speed')) === 50, `${title}: slow speed reaches Wasm memory`);
    await page.locator('#reset-mods').click();
    await page.waitForFunction(() => document.getElementById('mod-status').textContent.startsWith('Original settings restored'));
    await waitForGuest(async () => (await readGlobal('ball_speed')) === 100, `${title}: default speed restored in Wasm memory`);
    await page.locator('#close-mods').click();
    // Exercise the browser's standard gamepad path with controlled pad input.
    await frame.evaluate(() => {
      window.testPad = { mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [window.testPad], configurable: true });
      window.testPad.buttons[8].pressed = true;
    });
    await page.waitForTimeout(100);
    await frame.evaluate(() => { window.testPad.buttons[8].pressed = false; });
    const reset = await guestImage();
    await frame.evaluate(id => { window.testPad.axes[id === 'brick-shift' ? 0 : 1] = 1; }, id);
    await page.waitForTimeout(200);
    await frame.evaluate(() => { window.testPad.axes = [0, 0]; });
    assert.ok(!reset.equals(await guestImage()), `${title}: gamepad stick moves the paddle`);
    await frame.evaluate(() => { window.testPad.buttons[0].pressed = true; });
    await page.waitForTimeout(100);
    await frame.evaluate(() => { window.testPad.buttons[0].pressed = false; });
    const padLaunched = await guestImage();
    await page.waitForTimeout(200);
    assert.ok(!padLaunched.equals(await guestImage()), `${title}: gamepad launches the ball`);
    await page.locator('#open-mods').click();
    const whileOpen = await guestImage();
    await page.waitForTimeout(100);
    assert.ok(!whileOpen.equals(await guestImage()), `${title}: opening mods does not pause gameplay`);
    await frame.evaluate(() => { window.testModAudits = []; });
    await page.locator('#mod-color').selectOption('pink');
    await page.locator('#mod-size').selectOption('large');
    await page.locator('#mod-speed').selectOption('fast');
    await page.locator('#apply-mods').click();
    await page.waitForFunction(() => document.getElementById('mod-status').textContent.startsWith('Applied live'));
    const audit = await frame.evaluate(() => window.testModAudits[0]);
    assert.ok(audit, 'applying mods immediately renders the compiled game');
    assert.equal(audit.sameInstance, true, 'live changes retain the compiled instance');
    assert.equal(await frame.evaluate(() => window.testInstances), 1, 'no recompilation or instance replacement');
    assert.deepEqual(audit.after.labels, audit.before.labels, 'score, lives and game phase survive applying mods');
    assert.ok(!audit.before.labels.some(label => /PAUSED|LAUNCH|GAME OVER|WINS|WIN!/.test(label[2])), 'mods are tested during active play');
    const ball = state => state.rectangles.find(r => r[2] === 6 && r[3] === 6);
    const bricks = state => state.rectangles.filter(r => r[2] === 32 && r[3] === 12);
    assert.deepEqual(ball(audit.after), ball(audit.before), 'applying mods does not reset ball position');
    assert.deepEqual(bricks(audit.after), bricks(audit.before), 'destroyed bricks stay destroyed');
    assert.equal(audit.values.ball_speed, 200);
    const livePaddle = audit.after.rectangles.find(r => r[4] === 255 && r[5] === 80 && r[6] === 170);
    assert.ok(livePaddle, 'compiled rendering immediately uses the new color');
    assert.equal(livePaddle[id === 'brick-shift' ? 2 : 3], id === 'brick-shift' ? 80 : 72);
    const liveImage = await guestImage();
    await page.waitForTimeout(100);
    assert.ok(!liveImage.equals(await guestImage()), 'the modified game continues moving');
    console.log(`${title}: all mods applied during active play in ${audit.elapsed.toFixed(1)} ms; instance and progress preserved.`);
    await page.locator('#close-mods').click();
    await page.locator('#restart').click();
    await page.waitForFunction(() => document.getElementById('session-label').textContent === 'NOW PLAYING');
    const restarted = page.frames().find(f => f.url().includes('player.html'));
    assert.notEqual(restarted, frame, 'restart replaces the old game instance');
    assert.equal(await restarted.evaluate(() => {
      const wasm = window.testGame;
      return new DataView(wasm.memory.buffer).getInt32(wasm.ball_speed.value, true);
    }), 100, 'restart resets mod values');
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
  await mobile.addInitScript(observeWasm);
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
  const cross = mobileFrame.locator('#pad-cross');
  await cross.waitFor({ state: 'visible', timeout: 10000 });
  await cross.tap({ trial: true });
  const touch = await cross.boundingBox();
  const session = await mobile.context().newCDPSession(mobile);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touch.x + touch.width / 2, y: touch.y + touch.height / 2 }] });
  await mobile.waitForTimeout(200);
  assert.equal(await cross.evaluate(el => el.classList.contains('pressed')), true, 'native touch reaches the launch button');
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
  await offline.route('**/*.wasm?*', route => route.abort());
  await offline.goto(base);
  await offline.locator('#play').click();
  await offline.waitForFunction(() => document.getElementById('status').classList.contains('error'));
  assert.match(await offline.locator('#status').innerText(), /could not load/);
  await offline.locator('#stop').click();
  assert.equal(await offline.locator('iframe').count(), 0);
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  assert.deepEqual(externalRequests, [], 'gameplay requires no external services');
  console.log('Passed: both compiled Wasm games boot and play; live color/size change the guest framebuffer; speed values reach Wasm memory; defaults restore; desktop and touch mod controls work.');
} finally {
  await browser?.close();
  server?.kill();
}
