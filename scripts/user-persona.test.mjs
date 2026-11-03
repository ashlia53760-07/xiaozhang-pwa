// Isolated Chrome profile and synthetic records only; no real API credentials or requests.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
await context.addInitScript(() => {
  localStorage.setItem('xiaozhang-pet-position', JSON.stringify({ x: 10, y: 400 }));
  for (const name of ['auto-moments', 'auto-diary', 'proactive-enabled']) localStorage.setItem('xiaozhang-' + name, 'false');
});
const page = await context.newPage(), errors = [], checks = [], calls = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('https://persona-test.invalid/**', async route => {
  calls.push(route.request().postDataJSON());
  await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: '我听着，你接着说。' } }] })}\n\ndata: [DONE]\n\n` });
});
const check = label => { checks.push(label); console.log('PASS', label); };
const origin = process.env.PERSONA_TEST_URL || 'http://127.0.0.1:5173';
const sharedInputs = [
  ['role-user-name', 'userName', 'common-name'], ['role-preferences', 'userPreferences', 'common-persona'],
  ['role-custom-prompt', 'customPrompt', 'common-custom'], ['role-world-book', 'worldBook', 'common-world'],
  ['role-life-prompt', 'lifeSupplementPrompt', 'common-life'], ['role-date-prompt', 'dateSupplementPrompt', 'common-date'],
  ['role-date-xp', 'dateXpRelationship', 'common-xp'], ['role-date-observer', 'dateObserverRequests', 'common-observer'],
  ['role-date-style', 'dateStyleRequirements', 'common-style']
];
const expectedShared = { ...Object.fromEntries(sharedInputs.map(([, key, value]) => [key, value])), lifeTheatreEnabled: true, dateTheatreEnabled: false };
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
async function editor() { await page.click('#conversation-details'); await page.waitForSelector('#role-dialog[open]'); }
async function contact(id, name) {
  await page.click('#contacts-back'); await page.click(`[data-contact-id="${id}"]`);
  const displayName = await page.evaluate(async ({ id, name }) => (await (await import('/src/storage.ts')).storage.contactPreferences(id)).remark || name, { id, name });
  await page.waitForFunction(label => document.querySelector('#draft').placeholder.includes(label), displayName);
}
try {
  await page.goto(origin); await ready();
  await page.evaluate(async () => {
    const { storage } = await import('/src/storage.ts');
    const { emptyCharacterSettings } = await import('/src/characters.ts');
    await storage.saveProfile({ baseUrl: 'https://persona-test.invalid/v1', model: 'test', apiKey: 'SYNTHETIC_ONLY', temperature: .5, protocol: 'openai' });
    await storage.saveCharacterSettings({ ...emptyCharacterSettings(), userName: 'original', userPreferences: 'original-persona', relationship: 'primary-relationship', worldBook: 'primary-world' });
    await storage.saveContactPreferences('wu-xie', { remark: 'private-remark', affection: 17, settings: { ...emptyCharacterSettings(), userName: 'wu-original', userPreferences: 'wu-persona', relationship: 'wu-relationship', relationshipMode: 'romance', worldBook: 'wu-world', dateObserverRequests: 'wu-observer' }, voiceIds: { minimax: 'test-voice' }, api: { baseUrl: 'https://persona-test.invalid/v1', model: 'test', apiKey: 'SYNTHETIC_ONLY', temperature: .5 }, updatedAt: 1 });
  });
  await page.reload(); await ready(); await editor();
  assert.equal(await page.inputValue('#role-preferences'), 'original-persona');
  for (const [id, , value] of sharedInputs) await page.fill(`#${id}`, value);
  await page.locator('#role-life-theatre-enabled').check(); await page.locator('#role-date-theatre-enabled').uncheck();
  await page.fill('#role-relationship', 'pending-primary-relationship'); await page.selectOption('#role-relationship-mode', 'romance');
  const baseline = await page.evaluate(async () => (await import('/src/storage.ts')).storage.contactPreferences('wu-xie'));
  page.once('dialog', dialog => dialog.dismiss()); await page.click('#role-persona-sync');
  assert.equal(await page.evaluate(async () => (await (await import('/src/storage.ts')).storage.characterSettings()).userName), 'original');
  check('existing persona is visible; cancelling sync preserves stored values');
  page.once('dialog', dialog => dialog.accept()); await page.click('#role-persona-sync');
  await page.waitForFunction(() => document.querySelector('#role-persona-status').textContent.includes('已保存并同步'));
  const result = await page.evaluate(async () => {
    const { storage } = await import('/src/storage.ts'); const { characters } = await import('/src/characters.ts');
    return { all: await Promise.all(characters.map(c => storage.contactSettings(c.id))), wu: await storage.contactPreferences('wu-xie') };
  });
  assert.ok(result.all.length >= 16);
  for (const settings of result.all) for (const [key, value] of Object.entries(expectedShared)) assert.equal(settings[key], value, key);
  assert.equal(result.wu.remark, baseline.remark); assert.equal(result.wu.affection, baseline.affection);
  assert.deepEqual(result.wu.api, baseline.api); assert.deepEqual(result.wu.voiceIds, baseline.voiceIds);
  for (const key of ['relationship', 'relationshipMode']) assert.equal(result.wu.settings[key], baseline.settings[key]);
  assert.equal(result.all[0].relationship, 'primary-relationship'); assert.equal(result.all[0].relationshipMode, 'friendship');
  check('all 11 common fields sync; stored relationships/modes, remarks, voice and API stay independent');
  await page.locator('#role-dialog').evaluate(el => el.close());
  await contact('wu-xie', '吴邪'); await editor();
  for (const [id, , value] of sharedInputs) assert.equal(await page.inputValue(`#${id}`), value);
  await page.fill('#role-user-name', 'wu-only-name'); await page.fill('#role-preferences', 'wu-only-persona');
  await page.fill('#role-world-book', 'wu-only-world'); await page.fill('#role-custom-prompt', 'wu-only-custom');
  await page.fill('#role-life-prompt', 'wu-only-life'); await page.fill('#role-date-prompt', 'wu-only-date');
  await page.fill('#role-date-xp', 'wu-only-xp'); await page.fill('#role-date-observer', 'wu-only-observer');
  await page.fill('#role-date-style', 'wu-only-style');
  await page.locator('#role-life-theatre-enabled').uncheck(); await page.locator('#role-date-theatre-enabled').check();
  await page.click('#role-save');
  await page.waitForSelector('#role-dialog:not([open])', { state: 'attached' });
  await page.reload(); await ready(); await editor();
  assert.equal(await page.inputValue('#role-preferences'), 'wu-only-persona');
  for (const [id, , value] of sharedInputs) assert.equal(await page.inputValue(`#${id}`), value.replace('common-', 'wu-only-'));
  assert.equal(await page.locator('#role-life-theatre-enabled').isChecked(), false);
  assert.equal(await page.locator('#role-date-theatre-enabled').isChecked(), true);
  assert.equal(await page.evaluate(async () => (await (await import('/src/storage.ts')).storage.characterSettings()).userPreferences), 'common-persona');
  assert.equal(await page.evaluate(async () => (await (await import('/src/storage.ts')).storage.contactSettings('xie-yuchen')).userPreferences), 'common-persona');
  const preservedShared = await page.evaluate(async () => (await import('/src/storage.ts')).storage.characterSettings());
  for (const [key, value] of Object.entries(expectedShared)) assert.equal(preservedShared[key], value);
  check('all individual common-setting edits and switches survive reload without changing other characters');
  const abortResult = await page.evaluate(async () => {
    const { storage } = await import('/src/storage.ts');
    const before = await storage.characterSettings();
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (row, ...args) {
      if (row.key === 'contact:wu-xie') { this.transaction.abort(); return; }
      return original.call(this, row, ...args);
    };
    let failed = false;
    try { await storage.syncSharedSettingsToAll({ userName: 'must-not-save', userPreferences: 'must-not-save', customPrompt: 'must-not-save', worldBook: 'must-not-save' }); }
    catch { failed = true; }
    finally { IDBObjectStore.prototype.put = original; }
    return { failed, before, after: await storage.characterSettings() };
  });
  assert.equal(abortResult.failed, true); assert.deepEqual(abortResult.after, abortResult.before);
  check('aborted batch transaction rolls back earlier character updates');
  const backup = await page.evaluate(async () => (await import('/src/storage.ts')).storage.contactBackup());
  assert.equal(backup.contacts['wu-xie'].settings.userPreferences, 'wu-only-persona');
  assert.ok(!JSON.stringify(backup).includes('SYNTHETIC_ONLY'));
  check('existing contact backup includes individual persona and excludes API keys');
  await page.locator('.user-persona-editor').scrollIntoViewIfNeeded();
  await page.locator('.persona-sync-scope').evaluate(el => { el.open = true; });
  const folder = new URL('../.local-review/user-persona/', import.meta.url); await mkdir(folder, { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('mobile-390.png', folder)) });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const box = await page.locator('.user-persona-editor').evaluate(el => ({ w: el.clientWidth, sw: el.scrollWidth }));
    assert.ok(box.sw <= box.w + 1);
  }
  await page.locator('#role-dialog').evaluate(el => el.close());
  await page.fill('#draft', '用户人设测试'); await page.click('#send');
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
  assert.match(calls.at(-1).messages[0].content, /用户人设与偏好：wu-only-persona/);
  assert.doesNotMatch(calls.at(-1).messages[0].content, /common-persona/);
  await contact('zhang-qiling', '张起灵');
  await page.fill('#draft', '另一个角色的用户人设测试'); await page.click('#send');
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
  assert.match(calls.at(-1).messages[0].content, /用户人设与偏好：common-persona/);
  assert.doesNotMatch(calls.at(-1).messages[0].content, /wu-only-persona/);
  check('real chat request builder sends each character its own persona (mock API only)');
  await contact('wu-xie', '吴邪'); await editor();
  await page.fill('#role-preferences', 'second-sync-persona');
  await page.fill('#role-relationship', 'unsaved-relationship');
  page.once('dialog', dialog => dialog.accept()); await page.click('#role-persona-sync');
  await page.waitForFunction(() => document.querySelector('#role-persona-status').textContent.includes('已保存并同步'));
  const afterNpcSync = await page.evaluate(async () => {
    const { storage } = await import('/src/storage.ts');
    return { primary: await storage.characterSettings(), wu: await storage.contactSettings('wu-xie') };
  });
  assert.equal(afterNpcSync.primary.userPreferences, 'second-sync-persona');
  assert.equal(afterNpcSync.wu.userPreferences, 'second-sync-persona');
  assert.equal(afterNpcSync.wu.relationship, 'wu-relationship');
  assert.equal(afterNpcSync.primary.relationship, 'primary-relationship');
  assert.equal(afterNpcSync.primary.relationshipMode, 'friendship');
  assert.equal(afterNpcSync.wu.relationshipMode, 'romance');
  for (const [key, value] of Object.entries(expectedShared)) {
    if (key === 'userName' || key === 'userPreferences') continue;
    const expected = typeof value === 'string' ? value.replace('common-', 'wu-only-') : !value;
    assert.equal(afterNpcSync.primary[key], expected); assert.equal(afterNpcSync.wu[key], expected);
  }
  check('secondary-contact sync preserves each saved relationship/mode and ignores pending relationship edits');
  // Explicitly clearing a shared field must clear it on all contacts, not silently keep old text.
  await page.fill('#role-world-book', ''); await page.fill('#role-date-style', '');
  page.once('dialog', dialog => dialog.accept()); await page.click('#role-persona-sync');
  await page.waitForFunction(() => !document.querySelector('#role-persona-sync').disabled);
  const cleared = await page.evaluate(async () => {
    const { storage } = await import('/src/storage.ts'); const { characters } = await import('/src/characters.ts');
    return Promise.all(characters.map(c => storage.contactSettings(c.id)));
  });
  for (const settings of cleared) { assert.equal(settings.worldBook, ''); assert.equal(settings.dateStyleRequirements, ''); }
  check('confirmed empty fields overwrite consistently across all contacts');
  assert.deepEqual(errors, []); check('320px and 390px section fits; no page errors');
  console.log(JSON.stringify({ passed: true, checks, api: 'mocked requests only' }));
} finally { await browser.close(); }
