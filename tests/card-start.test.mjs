// Real main.js/card storage modules with an in-memory DOM, OPFS and Worker
// boundary. No game binary, user storage, browser or network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_SIZE, loadSaves } from '../web/cards.js';

let fixtureId = 0;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const missing = () => Object.assign(new Error('missing'), { name: 'NotFoundError' });
const card = value => new Uint8Array(CARD_SIZE).fill(value);

async function page(t) {
  const entries = new Map();
  const files = new Map([['card0.mcr', card(1)]]);
  const workers = [];
  const reads = [];
  let commitGate = null;
  const saves = {
    async getFileHandle(name, options = {}) {
      if (!options.create && !files.has(name)) throw missing();
      return {
        kind: 'file',
        async getFile() {
          const bytes = files.get(name)?.slice();
          if (!bytes) throw missing();
          return { async arrayBuffer() { return bytes.buffer; } };
        },
        async createWritable() {
          let bytes;
          return {
            async write(value) { bytes = new Uint8Array(value).slice(); },
            async close() {
              if (commitGate) {
                commitGate.entered?.resolve();
                await commitGate.promise;
              }
              files.set(name, bytes);
            },
          };
        },
      };
    },
    async *entries() {
      for (const name of files.keys()) yield [name, await this.getFileHandle(name)];
    },
  };
  const root = {
    async getDirectoryHandle(name) {
      if (name === 'saves') return saves;
      if (name === 'disc') return { async getFileHandle() { return {}; } };
      if (name === 'mods') return { async getFileHandle() { throw missing(); } };
      throw missing();
    },
  };
  function element(id) {
    if (!entries.has(id)) entries.set(id, {
      listeners: {}, disabled: id === 'start', checked: false, value: '', files: [], textContent: '',
      addEventListener(name, fn) { this.listeners[name] = fn; },
      replaceChildren() {}, append() {}, getContext() { return {}; },
      click() { if (!this.disabled) return this.listeners.click?.({ target: this }); },
    });
    return entries.get(id);
  }
  const bindings = {
    window: {}, document: { getElementById: element, createElement: () => element('created') },
    navigator: { storage: { getDirectory: async () => root } },
    location: { search: '?cue=synthetic.cue', href: 'https://example.invalid/' },
    localStorage: { getItem: () => null }, crossOriginIsolated: true,
    addEventListener() {}, requestAnimationFrame() {},
    fetch: async () => ({ json: async () => ({}) }),
    AudioContext: class { audioWorklet = { addModule: async () => {} }; destination = {}; },
    AudioWorkletNode: class { connect() {} },
    Worker: class {
      constructor() { workers.push(this); }
      addEventListener() {}
      postMessage(message) {
        // Match worker.js's startup snapshot using its real loadSaves helper.
        if (message.type === 'start') reads.push(loadSaves(saves).then(value => { this.loaded = value; }));
      }
    },
  };
  const descriptors = new Map(Object.keys(bindings).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(bindings)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  await import(`../web/main.js?card-start-test=${++fixtureId}`);
  await new Promise(resolve => setImmediate(resolve));
  return {
    element, files, workers, setCommitGate(gate) { commitGate = gate; },
    async start() { await element('start').click(); await Promise.all(reads); },
    import(slot, file) {
      const input = element(`card${slot}`);
      input.files = [file];
      return input.listeners.change({ target: input });
    },
  };
}

for (const stage of ['file read', 'OPFS commit']) {
  test(`Start cannot snapshot the previous card during ${stage}`, async t => {
    const p = await page(t);
    const gate = deferred();
    if (stage === 'OPFS commit') {
      gate.entered = deferred();
      p.setCommitGate(gate);
    }
    const importing = p.import(0, { name: 'replacement.mcr', arrayBuffer: () => stage === 'file read' ? gate.promise : Promise.resolve(card(2).buffer) });
    try {
      if (gate.entered) await gate.entered.promise;
      await p.start();
      assert.equal(p.workers.length, 0, 'no Worker may start before the replacement card is committed');
      assert.match(p.element('status').textContent, /wait|import/i);
    } finally {
      gate.resolve(card(2).buffer);
      await importing;
    }
    await p.start();
    assert.equal(p.workers.length, 1);
    assert.deepEqual(p.workers[0].loaded.get('card0.mcr'), card(2));
  });
}

test('both card slots finish before Start, including repeated clicks', async t => {
  const p = await page(t);
  const first = deferred(), second = deferred();
  const imports = [
    p.import(0, { name: 'first.mcr', arrayBuffer: () => first.promise }),
    p.import(1, { name: 'second.mcr', arrayBuffer: () => second.promise }),
  ];
  try {
    first.resolve(card(3).buffer);
    await imports[0];
    await p.start(); await p.start();
    assert.equal(p.workers.length, 0);
  } finally {
    second.resolve(card(4).buffer);
    await Promise.all(imports);
  }
  await p.start();
  assert.deepEqual(p.workers[0].loaded.get('card0.mcr'), card(3));
  assert.deepEqual(p.workers[0].loaded.get('card1.mcr'), card(4));
});

test('a failed file read does not permanently block Start', async t => {
  const p = await page(t);
  const gate = deferred();
  const importing = p.import(0, { name: 'broken.mcr', arrayBuffer: () => gate.promise });
  try {
    await p.start();
    assert.equal(p.workers.length, 0);
  } finally {
    gate.reject(new Error('file read failed'));
    await importing;
  }
  assert.match(p.element('status').textContent, /file read failed/);
  await p.start();
  assert.deepEqual(p.workers[0].loaded.get('card0.mcr'), card(1));
});

test('wrong-size card errors leave the previous card intact and permit Start', async t => {
  const p = await page(t);
  await p.import(0, { name: 'short.mcr', arrayBuffer: async () => new Uint8Array(1).buffer });
  assert.match(p.element('status').textContent, /card image/);
  await p.start();
  assert.deepEqual(p.workers[0].loaded.get('card0.mcr'), card(1));
});

test('a rejected OPFS commit releases the Start guard without replacing the card', async t => {
  const p = await page(t);
  const gate = { ...deferred(), entered: deferred() };
  p.setCommitGate(gate);
  const importing = p.import(0, { name: 'replacement.mcr', arrayBuffer: async () => card(2).buffer });
  await gate.entered.promise;
  try {
    await p.start();
    assert.equal(p.workers.length, 0);
  } finally {
    gate.reject(new Error('storage commit failed'));
    await importing;
  }
  assert.match(p.element('status').textContent, /storage commit failed/);
  await p.start();
  assert.deepEqual(p.workers[0].loaded.get('card0.mcr'), card(1));
});

test('an empty card selection does not block Start', async t => {
  const p = await page(t);
  const input = p.element('card0');
  input.files = [];
  await input.listeners.change({ target: input });
  await p.start();
  assert.equal(p.workers.length, 1);
});

test('ordinary startup loads existing saves and refuses late card imports', async t => {
  const p = await page(t);
  await p.start();
  assert.equal(p.workers.length, 1);
  assert.deepEqual(p.workers[0].loaded.get('card0.mcr'), card(1));
  let read = false;
  await p.import(0, { name: 'late.mcr', arrayBuffer: async () => { read = true; return card(9).buffer; } });
  assert.equal(read, false);
  assert.match(p.element('status').textContent, /before pressing Start/);
  assert.deepEqual(p.files.get('card0.mcr'), card(1));
});
