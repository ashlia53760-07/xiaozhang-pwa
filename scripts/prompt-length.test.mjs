import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
await context.addInitScript(() => {
  localStorage.setItem('xiaozhang-pet-position', JSON.stringify({ x: 10, y: 400 }));
  for (const name of ['auto-moments', 'auto-diary', 'proactive-enabled']) localStorage.setItem('xiaozhang-' + name, 'false');
});
const page = await context.newPage();
const calls = [];
await page.route('https://prompt-length.invalid/**', async route => {
  calls.push(route.request().postDataJSON());
  await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: '我听着。' } }] })}\n\ndata: [DONE]\n\n` });
});
const fields = {
  'role-preferences': 'userPreferences', 'role-relationship': 'relationship',
  'role-custom-prompt': 'customPrompt', 'role-world-book': 'worldBook',
  'role-life-prompt': 'lifeSupplementPrompt', 'role-date-prompt': 'dateSupplementPrompt',
  'role-date-xp': 'dateXpRelationship', 'role-date-observer': 'dateObserverRequests',
  'role-date-style': 'dateStyleRequirements'
};
const values = Object.fromEntries(Object.keys(fields).map(id => [id, `${id}-` + '长'.repeat(5500) + '-END']));
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
try {
  await page.goto(process.env.PERSONA_TEST_URL || 'http://127.0.0.1:4192'); await ready();
  await page.evaluate(async () => {
    const { storage } = await import('/src/storage.ts');
    await storage.saveProfile({ baseUrl: 'https://prompt-length.invalid/v1', model: 'test', apiKey: 'SYNTHETIC_ONLY', temperature: .5, protocol: 'openai' });
  });
  await page.click('#conversation-details'); await page.waitForSelector('#role-dialog[open]');
  for (const [id, value] of Object.entries(values)) {
    assert.equal(await page.locator(`#${id}`).evaluate(el => el.maxLength), -1, id);
    await page.fill(`#${id}`, value);
  }
  await page.setInputFiles('#role-life-prompt-file', { name: 'long.txt', mimeType: 'text/plain', buffer: Buffer.from(values['role-life-prompt']) });
  await page.waitForFunction(value => document.querySelector('#role-life-prompt').value === value, values['role-life-prompt']);
  await page.click('#role-save');
  await page.waitForSelector('#role-dialog:not([open])', { state: 'attached' });
  const saved = await page.evaluate(async () => (await import('/src/storage.ts')).storage.characterSettings());
  for (const [id, key] of Object.entries(fields)) assert.equal(saved[key], values[id], key);
  await page.reload(); await ready(); await page.click('#conversation-details'); await page.waitForSelector('#role-dialog[open]');
  for (const [id, value] of Object.entries(values)) assert.equal(await page.inputValue(`#${id}`), value, id);
  await page.locator('#role-dialog').evaluate(el => el.close());
  await page.fill('#draft', '测试长设定'); await page.click('#send');
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
  const prompt = calls.at(-1).messages.map(message => message.content).join('\n');
  for (const id of ['role-preferences', 'role-relationship', 'role-custom-prompt', 'role-world-book']) assert.ok(prompt.includes(values[id]), id);
  console.log('PASS long prompts, TXT import, persistence and private chat request');
} finally {
  await context.close(); await browser.close();
}
