import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'cleanTheatreReply');
assert.ok(declaration);
const js = ts.transpile('export ' + declaration.getText(ast), { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 });
const { cleanTheatreReply } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
for (const [input, expected] of [
  ['<content>他合上书。\n“走吧。”</content>', '他合上书。\n“走吧。”'],
  ['<think>internal reasoning</think><content>他看向窗外。</content>', '他看向窗外。'],
  ['<CONTENT>正文</CONTENT>', '正文'],
  ['<content>未闭合的正文', '未闭合的正文'],
  ['正文</content>', '正文'],
  ['<think>尚未完成的内部分析', ''],
  ['<content> </content>', ''],
  ['雨停了。\n他收起伞。', '雨停了。\n他收起伞。'],
  ['1 < 2；<em>原有文本</em>', '1 < 2；<em>原有文本</em>']
]) assert.equal(cleanTheatreReply(input), expected);
console.log('theatre output: 9 response normalization checks passed');
