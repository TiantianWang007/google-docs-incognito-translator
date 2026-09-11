import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, translationUrl } from '../chrome-translate-ten-tabs/languages.mjs';
import { createLauncher, friendlyError } from '../chrome-translate-ten-tabs/launcher.mjs';

function mockApi(overrides = {}) {
  const windows = [], saved = [];
  return {
    windows, saved,
    api: {
      windows: { create: overrides.create ?? (async data => { windows.push(data); }) },
      storage: { local: { set: overrides.set ?? (async data => { saved.push(data); }) } }
    }
  };
}

test('German URL exactly matches the requested document link; all target codes round-trip', () => {
  assert.equal(translationUrl('de'), 'https://translate.google.com/?hl=zh-cn&sl=auto&tl=de&op=docs');
  assert.equal(new Set(LANGUAGES.map(([code]) => code)).size, LANGUAGES.length);
  for (const [code] of LANGUAGES) {
    const url = new URL(translationUrl(code));
    assert.equal(url.origin, 'https://translate.google.com');
    assert.equal(url.searchParams.get('tl'), code);
    assert.equal(url.searchParams.get('sl'), 'auto');
    assert.equal(url.searchParams.get('op'), 'docs');
  }
});

test('one new incognito window with exactly ten identical URLs; undefined create result is successful', async () => {
  const { api, windows, saved } = mockApi();
  assert.deepEqual(await createLauncher(api)('zh-TW'), { ok: true, count: 10, remembered: true });
  assert.equal(windows.length, 1);
  assert.deepEqual(windows[0], { incognito: true, type: 'normal', focused: true, url: Array(10).fill(translationUrl('zh-TW')) });
  assert.deepEqual(saved, [{ targetLanguage: 'zh-TW', tabCount: 10 }]);
});

test('requested tab counts, including both limits, are respected and stored', async () => {
  for (const count of [1, 7, 100]) {
    const { api, windows, saved } = mockApi();
    assert.deepEqual(await createLauncher(api)('de', count), { ok: true, count, remembered: true });
    assert.equal(windows.length, 1);
    assert.equal(windows[0].incognito, true);
    assert.deepEqual(windows[0].url, Array(count).fill(translationUrl('de')));
    assert.deepEqual(saved, [{ targetLanguage: 'de', tabCount: count }]);
  }
});

test('invalid counts fail before creating a window or changing saved preferences', async () => {
  const { api, windows, saved } = mockApi();
  const launch = createLauncher(api);
  for (const count of [0, -1, 1.5, 101, NaN, Infinity, null, '', '3', {}]) {
    await assert.rejects(launch('de', count), /整数/);
  }
  assert.deepEqual(windows, []);
  assert.deepEqual(saved, []);
  assert.equal((await launch('de', 3)).count, 3);
});

test('invalid input cannot open any URL or save preferences', async () => {
  const { api, windows, saved } = mockApi();
  const launch = createLauncher(api);
  for (const input of [undefined, null, {}, '', 'auto', 'xx', 'de&op=text', 'https://example.com']) {
    await assert.rejects(launch(input), /请选择/);
  }
  assert.deepEqual(windows, []);
  assert.deepEqual(saved, []);
});

test('overlapping clicks cannot create multiple windows, but a later intentional launch can', async () => {
  let finish;
  const { api, windows } = mockApi({ set: () => new Promise(resolve => { finish = resolve; }) });
  const launch = createLauncher(api);
  const first = launch('fr');
  await assert.rejects(launch('de'), /重复点击/);
  finish();
  await first;
  const later = launch('ja');
  finish();
  await later;
  assert.equal(windows.length, 2);
  assert.equal(new URL(windows[1].url[0]).searchParams.get('tl'), 'ja');
});

test('failed language storage still allows the requested window', async () => {
  const { api, windows } = mockApi({ set: async () => { throw new Error('Storage unavailable'); } });
  assert.equal((await createLauncher(api)('en')).remembered, false);
  assert.equal(windows.length, 1);
});

test('blocked incognito reports failure, never falls back to normal, and releases the click lock', async () => {
  const calls = [];
  const { api } = mockApi({ create: async data => { calls.push(data); throw new Error('Incognito mode is disabled.'); } });
  const launch = createLauncher(api);
  await assert.rejects(launch('de'), /disabled/);
  await assert.rejects(launch('ja'), /disabled/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.incognito === true));
  assert.match(friendlyError(new Error('Incognito mode is disabled.')), /无痕模式已被停用/);
});
