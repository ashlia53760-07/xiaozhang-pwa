import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/role-actions.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const folder = new URL('../.local-review/role-actions-20261025/', import.meta.url);
await (await import('node:fs/promises')).mkdir(folder, { recursive: true });
await (await import('node:fs/promises')).writeFile(new URL('role-actions.mjs', folder), code);
const { parseRoleReply } = await import(new URL('role-actions.mjs', folder));

const gift = parseRoleReply('我给你留了点东西。[[XZ_ACTION:{"type":"gift","title":"一杯热茶","note":"别凉了"}]]');
assert.equal(gift.text, '我给你留了点东西。');
assert.deepEqual(gift.action, { type: 'gift', title: '一杯热茶', note: '别凉了' });

const transfer = parseRoleReply('收下。<xz-action>{"type":"transfer","amount":12.5}</xz-action>');
assert.equal(transfer.action?.type, 'transfer');
assert.equal(transfer.action?.amount, 12.5);

const voice = parseRoleReply('我打给你。[[XZ_ACTION:{"type":"call","mode":"voice"}]]');
assert.deepEqual(voice.action, { type: 'call', mode: 'voice', reason: undefined });
const collection = parseRoleReply('今晚一起吃饭。[[XZ_ACTION:{"type":"group_collection","title":"晚饭和车费","amount":36,"note":"按实际参与"}]]');
assert.deepEqual(collection.action, { type: 'group_collection', title: '晚饭和车费', amount: 36, note: '按实际参与' });
assert.equal(parseRoleReply('普通消息 [[XZ_ACTION:{"type":"transfer","amount":999999}]]').action, undefined);
assert.equal(parseRoleReply('普通消息。').text, '普通消息。');
console.log('PASS structured role gifts/transfers/calls are validated and hidden from visible text');
