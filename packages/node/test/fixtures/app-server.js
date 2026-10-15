// Offline protocol peer. Runs as a real child process on every supported OS.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const threads = new Map();
let initialized = false, acknowledged = false, sequence = 0;
const mode = process.argv[2];
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  if (message.error) {
    assert.equal(message.error.code, -32601);
    return;
  }
  if (method === 'initialize') {
    assert.equal(initialized, false);
    initialized = true;
    if (mode === 'hang-init') return;
    return send({ id, result: {} });
  }
  if (method === 'initialized') { acknowledged = true; return; }
  assert.equal(acknowledged, true);
  if (method === 'thread/start') {
    assert.equal(params.approvalPolicy, 'never');
    assert.equal(params.sandbox, 'read-only');
    assert.equal(params.ephemeral, true);
    const threadId = `thread-${++sequence}`;
    threads.set(threadId, params);
    if (params.model === 'rpc-error') return send({ id, error: { code: -1, message: 'Unsupported model' } });
    return send({ id, result: { thread: { id: threadId }, model: params.model ?? 'test-default' } });
  }
  if (method === 'turn/interrupt') {
    send({ id, result: {} });
    send({ method: 'turn/completed', params: { threadId: params.threadId, turn: { id: params.turnId, status: 'interrupted' } } });
    return;
  }
  if (method === 'thread/unsubscribe') {
    threads.delete(params.threadId);
    return send({ id, result: {} });
  }
  assert.equal(method, 'turn/start');
  const thread = threads.get(params.threadId);
  const model = thread.model;
  const turnId = `turn-${params.threadId}`;
  const textInput = params.input.find(item => item.type === 'text').text;
  if (model === 'crash') return process.exit(1);
  if (model === 'malformed') return process.stdout.write('broken JSON\n');
  if (model === 'hang' && textInput !== '[USER]\nready') {
    send({ id, result: { turn: { id: turnId } } });
    return;
  }
  if (model === 'hang-turn-start') return;
  if (model === 'server-request') send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: {} });
  const images = params.input.filter(item => item.type === 'localImage').map(item => ({
    path: item.path, bytes: readFileSync(item.path).toString('base64'),
  }));
  const content = model === 'structured' ? JSON.stringify({ thread, turn: params, images })
    : model === 'invalid-output' ? 'not JSON' : textInput;
  // Deliberately emit item/completed and turn/completed BEFORE the turn/start response.
  send({ method: 'thread/tokenUsage/updated', params: { threadId: params.threadId,
    tokenUsage: { last: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } } });
  send({ method: 'item/completed', params: { threadId: params.threadId,
    item: { id: 'commentary', type: 'agentMessage', text: 'Thinking...', phase: 'commentary' } } });
  const item = { id: 'answer', type: 'agentMessage', text: content, phase: 'final_answer' };
  send({ method: 'item/completed', params: { threadId: params.threadId, item } });
  send({ method: 'turn/completed', params: { threadId: params.threadId,
    turn: { id: turnId, status: model === 'failed' ? 'failed' : 'completed',
      error: model === 'failed' ? { message: 'Model unavailable' } : null,
      items: model === 'final-items' ? [item] : [] } } });
  send({ id, result: { turn: { id: turnId } } });
});
