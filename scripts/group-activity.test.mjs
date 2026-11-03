import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import ts from 'typescript';

const folder = new URL('../.local-review/contact-expansion-20261025/rules/', import.meta.url);
await mkdir(folder, { recursive: true });
for (const name of ['groups', 'characters', 'checkup', 'phone-messages']) {
  let output = ts.transpileModule(await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText;
  for (const dep of ['characters', 'checkup', 'phone-messages']) output = output.replaceAll(`"./${dep}"`, `"./${dep}.mjs"`);
  await writeFile(new URL(`${name}.mjs`, folder), output);
}
const { selectGroupSpeakers } = await import(new URL('groups.mjs', folder));
const { characters } = await import(new URL('characters.mjs', folder));
const roster = characters.slice(0, 7);
const group = { id: 'rules', title: '群', members: roster.map(c => ({ ...c, enabled: true })), createdAt: 1, updatedAt: 1 };
const user = content => ({ id: 'turn', role: 'user', kind: 'text', content, createdAt: 1 });
const pick = (content, fields = {}, history = []) => selectGroupSpeakers({ ...group, ...fields }, user(content), history);
const checks = [];
const expanded = { ...group, members: characters.map(c => ({ ...c, enabled: true })) };
const check = (name, run) => { run(); checks.push(name); console.log('PASS', name); };
check('expanded sixteen-member roster includes final contacts and explicit mentions', () => {
assert.equal(selectGroupSpeakers({ ...expanded, activity: 'lively' }, user('大家都说说吧'), []).length, 16);
assert.equal(selectGroupSpeakers({ ...expanded, replyMode: 'all' }, user('大家说说吧'), []).length, 16);
assert.deepEqual(selectGroupSpeakers(expanded, user('@张海琪 你怎么看'), []).map(m => m.name), ['张海琪']);
});
check('quiet ranges from one to two; normal ranges from two to four', () => {
  assert.equal(pick('早上好', { activity: 'quiet' }).length, 1);
  assert.equal(pick('大家聊聊', { activity: 'quiet' }).length, 2);
  assert.equal(pick('早上好').length, 2);
  assert.equal(pick('大家聊聊').length, 4);
});
check('lively allows three to five normally, and all seven when invited', () => {
  assert.equal(pick('早上好', { activity: 'lively' }).length, 3);
  assert.equal(pick('大家聊聊', { activity: 'lively' }).length, 5);
  assert.equal(pick('大家都说说吧', { activity: 'lively' }).length, 7);
});
check('genuinely shared topic may involve more than five without an all-members phrase', () => {
  assert.equal(pick('陪我看照片、吃饭，安排旅行计划，再用耳机听音乐', { activity: 'lively' }).length, 7);
});
check('custom natural cap is respected; absent legacy field retains dynamic scheduling', () => {
  for (const limit of [1, 2, 4, 6, 7]) assert.equal(pick('大家都说说吧', { activity: 'lively', replyLimit: limit }).length, limit);
  assert.equal(pick('大家都说说吧', { activity: 'lively', replyLimit: undefined }).length, 7);
  assert.equal(pick('大家都说说吧', { activity: 'lively', replyLimit: 0 }).length, 1);
  assert.equal(pick('大家都说说吧', { activity: 'lively', replyLimit: NaN }).length, 7);
});
check('explicit mentions, selected members and all-member modes override automatic cap', () => {
  assert.deepEqual(pick('@吴邪 @解雨臣 一起看看', { replyLimit: 1 }).map(m => m.name), ['吴邪', '解雨臣']);
  assert.equal(pick('说说吧', { replyMode: 'selected', selectedMemberIds: characters.slice(0, 3).map(c => c.id), replyLimit: 1 }).length, 3);
  assert.equal(pick('说说吧', { replyMode: 'all', replyLimit: 1 }).length, 7);
});
check('small, disabled and empty rosters never over-schedule; ordinary rotation reaches everyone', () => {
  assert.equal(pick('大家都说说吧', { activity: 'lively', members: group.members.slice(0, 2) }).length, 2);
  assert.equal(pick('大家都说说吧', { activity: 'lively', members: group.members.map(m => ({ ...m, enabled: false })) }).length, 0);
  const history = [], seen = new Set();
  for (let i = 0; i < 8; i++) {
    const selected = pick('早上好', {}, history);
    history.push({ ...user('早上好'), id: `u${i}` });
    for (const member of selected) { seen.add(member.id); history.push({ id: `${i}-${member.id}`, role: 'assistant', content: '在', speakerId: member.name, createdAt: i }); }
  }
  assert.equal(seen.size, 7);
});
await writeFile(new URL('rules-results.json', folder), JSON.stringify({ checks }, null, 2));
console.log(`group activity: ${checks.length} checks passed`);
