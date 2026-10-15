import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexClient, CodexAppServerError, findCodexBinary } from '../src/index.js';

const fixture = fileURLToPath(new URL('./fixtures/app-server.js', import.meta.url));
function client(t, options = {}, args = []) {
  const value = new CodexClient({ codexBinary: process.execPath,
    appServerArgs: [fixture, ...args], ...options });
  t.after(() => value.close());
  return value;
}
const schema = { type: 'object' };

test('correlates concurrent calls, initializes once, and collects early item events', async t => {
  const value = client(t);
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => value.invoke(`Hello ${index}`)));
  assert.equal(new Set(results.map(result => result.threadId)).size, 8);
  results.forEach((result, index) => {
    assert.equal(result.content, `[USER]\nHello ${index}`);
    assert.equal(result.model, 'test-default');
    assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });
  assert.equal((await value.invoke('again')).threadId, 'thread-9');
});

test('sends system/history/schema/effort and parses structured JSON', async t => {
  const value = client(t, { model: 'structured', reasoningEffort: 'low' });
  const result = await value.invoke([
    { role: 'system', content: 'Be exact.' }, { role: 'user', content: 'Question' },
    { role: 'assistant', content: 'Previous answer' }, { role: 'tool', name: 'lookup', content: '42' },
  ], { outputSchema: schema });
  assert.equal(result.output.thread.baseInstructions, 'Be exact.');
  assert.equal(result.output.turn.effort, 'low');
  assert.deepEqual(result.output.turn.outputSchema, schema);
  assert.match(result.output.turn.input[0].text, /\[TOOL \(lookup\)\]\n42/);
});

test('materializes images, preserves user files, and removes temporary files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'provider-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const image = join(directory, 'user.png');
  await writeFile(image, Buffer.from([1, 2, 3]));
  const value = client(t, { model: 'structured' });
  const result = await value.invoke([{ role: 'user', content: [
    { type: 'text', text: 'Inspect' }, { type: 'localImage', path: image },
    { type: 'image', url: 'data:image/png;base64,AA==' },
    { type: 'image', url: 'https://example.com/test.png' },
  ] }], { outputSchema: schema });
  assert.equal(result.output.images[0].bytes, 'AQID');
  assert.equal(result.output.images[1].bytes, 'AA==');
  await access(image);
  await assert.rejects(access(result.output.images[1].path));
  assert.deepEqual(result.output.turn.input.at(-1), { type: 'image', url: 'https://example.com/test.png' });
});

for (const [model, pattern] of [
  ['rpc-error', /Unsupported model/], ['failed', /Model unavailable/],
  ['crash', /exited|closed stdout/], ['malformed', /Invalid Codex/],
  ['invalid-output', /invalid structured JSON/],
]) {
  test(`rejects ${model} promptly`, async t => {
    const value = client(t, { model });
    await assert.rejects(value.invoke('Hello', { outputSchema: schema }), pattern);
  });
}

test('interrupts a timed-out turn and keeps the connection usable', async t => {
  const value = client(t, { model: 'hang' });
  await value.invoke('ready');
  await assert.rejects(value.invoke('Hello', { timeoutMs: 800 }), /cancelled or timed out/);
  assert.equal((await value.invoke('ready')).content, '[USER]\nready');
  assert.equal(value.closed, false);
});

test('times out startup and a turn/start without an id', async t => {
  const startup = client(t, { timeoutMs: 150 }, ['hang-init']);
  await assert.rejects(startup.invoke('Hello'), /cancelled or timed out/);
  const value = client(t, { model: 'hang-turn-start' });
  await assert.rejects(value.invoke('Hello', { timeoutMs: 800 }), /cancelled or timed out/);
  await assert.rejects(value.invoke('Again'), /closed/);
});

test('rejects pre-aborted signals, invalid input and timeout configuration', async t => {
  const value = client(t);
  await assert.rejects(value.invoke('Hello', { signal: AbortSignal.abort() }), CodexAppServerError);
  await assert.rejects(value.invoke([], {}), /nonempty message array/);
  await assert.rejects(value.invoke([{ role: 'wrong', content: 'x' }]), /role/);
  await assert.rejects(value.invoke('Hello', { timeoutMs: 0 }), /timeoutMs/);
  assert.throws(() => new CodexClient({ timeoutMs: -1 }), /timeoutMs/);
});

test('accepts final turn items and declines server tool/approval requests', async t => {
  for (const model of ['final-items', 'server-request']) {
    assert.equal((await client(t, { model }).invoke('Hello')).content, '[USER]\nHello');
  }
});

test('close rejects waiting turns and remains idempotent', async t => {
  const value = client(t, { model: 'hang' });
  await value.invoke('ready');
  const task = value.invoke('Hello');
  const rejection = assert.rejects(task, /closed/);
  await Promise.all([value.close(), value.close(), rejection]);
  assert.equal(value.closed, true);
  await assert.rejects(value.invoke('Again'), /closed/);
});

test('finds explicit native executables and refuses shell shims', async () => {
  assert.equal(await findCodexBinary(process.execPath), process.execPath);
  assert.equal(await findCodexBinary(join(tmpdir(), 'not-installed-codex')), null);
  assert.equal(await findCodexBinary('codex.cmd'), null);
});
