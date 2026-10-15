import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createInterface } from 'node:readline';

export class CodexAppServerError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'CodexAppServerError';
  }
}

/** Find a native executable; never launch a command through a shell. */
export async function findCodexBinary(configured) {
  configured ||= process.env.CODEX_CLIENT_BIN || process.env.ARTEMIS_CODEX_BIN;
  const windows = process.platform === 'win32';
  const candidates = configured
    ? [resolve(configured.replace(/^~(?=[/\\])/, homedir()))]
    : (process.env.PATH || '').split(delimiter).filter(Boolean)
      .flatMap(dir => windows ? [join(dir, 'codex.exe'), join(dir, 'codex')] : [join(dir, 'codex')]);
  if (!configured && windows && process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'));
  }
  for (const candidate of candidates) {
    // Windows npm .cmd shims need a shell. Point CODEX_CLIENT_BIN at the native exe instead.
    if (/\.(cmd|bat)$/i.test(candidate)) continue;
    try {
      await access(candidate, windows ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch { /* Try the next location. */ }
  }
  return null;
}

function deferred() {
  let resolvePromise, reject;
  const promise = new Promise((res, rej) => { resolvePromise = res; reject = rej; });
  // Events can arrive before the caller starts awaiting this promise.
  promise.catch(() => {});
  return { promise, resolve: resolvePromise, reject };
}

function abortError(signal) {
  return new CodexAppServerError('Codex call cancelled or timed out.', { cause: signal.reason });
}

function withSignal(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((res, rej) => {
    const abort = () => rej(abortError(signal));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(res, rej).finally(() => signal.removeEventListener('abort', abort));
  });
}

function positiveTimeout(value) {
  if (!Number.isInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new TypeError('timeoutMs must be a positive 32-bit integer.');
  }
  return value;
}

export class CodexClient {
  #options;
  #process;
  #starting;
  #closing;
  #closed = false;
  #nextId = 1;
  #pending = new Map();
  #threads = new Map();

  constructor(options = {}) {
    positiveTimeout(options.timeoutMs ?? 120_000);
    this.#options = { ...options };
  }

  get closed() { return this.#closed; }

  async #start() {
    if (this.#closed) throw new CodexAppServerError('Codex client is closed. Create a new client.');
    if (this.#starting) return this.#starting;
    if (this.#process) return;
    this.#starting = this.#initialize();
    try { await this.#starting; } finally { this.#starting = undefined; }
  }

  async #initialize() {
    const binary = await findCodexBinary(this.#options.codexBinary);
    if (!binary) throw new CodexAppServerError('Codex CLI not found. Set CODEX_CLIENT_BIN to the native executable.');
    if (this.#closed) throw new CodexAppServerError('Codex client is closed.');
    const child = spawn(binary, this.#options.appServerArgs ?? ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false,
    });
    this.#process = child;
    const fail = error => {
      if (this.#process !== child) return;
      this.#process = undefined;
      this.#fail(error);
      child.kill();
    };
    child.on('error', error => fail(new CodexAppServerError(`Could not start Codex: ${error.message}`, { cause: error })));
    child.on('exit', () => fail(new CodexAppServerError('Codex app-server exited before the call completed.')));
    child.stdin.on('error', error => fail(new CodexAppServerError(`Codex stdin failed: ${error.message}`)));
    // Drain stderr without storing or logging potentially sensitive diagnostics.
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', line => {
      if (this.#process !== child) return;
      try { this.#receive(JSON.parse(line)); } catch (error) {
        fail(new CodexAppServerError('Invalid Codex app-server message.', { cause: error }));
      }
    });
    lines.on('close', () => fail(new CodexAppServerError('Codex app-server closed stdout.')));
    try {
      await this.#request('initialize', {
        clientInfo: {
          name: this.#options.clientName ?? 'codex_client_provider_node',
          title: this.#options.clientTitle ?? 'Codex Client Provider (Node.js)',
          version: '0.1.0',
        },
        capabilities: { experimentalApi: false },
      }, AbortSignal.timeout(Math.min(this.#options.timeoutMs ?? 120_000, 10_000)));
      this.#write({ method: 'initialized', params: {} });
    } catch (error) { fail(error); throw error; }
  }

  #fail(error) {
    for (const pending of this.#pending.values()) pending.reject(error);
    for (const listener of this.#threads.values()) listener.reject(error);
  }

  #write(payload) {
    if (!this.#process) throw new CodexAppServerError('Codex app-server is not running.');
    this.#process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  async #request(method, params, signal) {
    const id = this.#nextId++;
    const pending = deferred();
    this.#pending.set(id, pending);
    try {
      signal.throwIfAborted();
      this.#write({ id, method, params });
      return await withSignal(pending.promise, signal);
    } finally { this.#pending.delete(id); }
  }

  #receive(message) {
    if (message.id != null && !message.method) {
      const pending = this.#pending.get(message.id);
      if (message.error) pending?.reject(new CodexAppServerError(message.error.message ?? 'Codex RPC failed.'));
      else pending?.resolve(message.result);
    } else if (message.id != null && message.method) {
      this.#write({ id: message.id, error: { code: -32601, message: 'The host does not expose Codex tools or approvals.' } });
    } else {
      const params = message.params ?? {};
      this.#threads.get(params.threadId)?.event(message.method, params);
    }
  }

  /** Each invocation creates an ephemeral thread; send message history explicitly. */
  async invoke(input, options = {}) {
    const timeoutMs = positiveTimeout(options.timeoutMs ?? this.#options.timeoutMs ?? 120_000);
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
    if (signal.aborted) throw abortError(signal);
    const prepared = await prepareMessages(input);
    let threadId, turnId;
    let completion;
    let healthy = true;
    try {
      await withSignal(this.#start(), signal);
      const started = await this.#request('thread/start', {
        cwd: resolve(this.#options.cwd ?? process.cwd()),
        approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true,
        serviceName: this.#options.serviceName ?? 'codex-client-provider-node',
        baseInstructions: prepared.system || 'Follow the user instructions.',
        developerInstructions: 'Do not use built-in tools, run commands, browse, or read files. Return only the requested output.',
        ...(!['default', 'auto', undefined].includes(this.#options.model) ? { model: this.#options.model } : {}),
      }, signal);
      threadId = started?.thread?.id;
      if (!threadId) throw new CodexAppServerError('Codex did not return a thread id.');
      completion = deferred();
      const items = new Map();
      let usage;
      this.#threads.set(threadId, {
        reject: completion.reject,
        event(method, params) {
          if (method === 'thread/tokenUsage/updated') usage = params.tokenUsage?.last;
          if (method === 'turn/started') turnId = params.turn?.id;
          if (method === 'item/completed' && params.item?.type === 'agentMessage') {
            items.set(params.item.id ?? 'final', params.item);
          }
          if (method === 'turn/completed') completion.resolve(params.turn);
        },
      });
      const turn = await this.#request('turn/start', {
        threadId, input: prepared.inputs,
        ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
        ...(this.#options.reasoningEffort ? { effort: this.#options.reasoningEffort } : {}),
      }, signal);
      turnId = turn?.turn?.id ?? turnId;
      const result = await withSignal(completion.promise, signal);
      if (result?.status !== 'completed') {
        throw new CodexAppServerError(`Codex turn failed: ${result?.error?.message ?? result?.status ?? 'unknown'}`);
      }
      const finalItems = result.items?.filter(item => item.type === 'agentMessage');
      const messages = finalItems?.length ? finalItems : [...items.values()];
      const finals = messages.filter(item => item.phase === 'final_answer');
      const content = (finals.length ? finals : messages).map(item => item.text ?? '').join('\n');
      if (!content) throw new CodexAppServerError('Codex turn completed without an assistant message.');
      let output;
      if (options.outputSchema) {
        try { output = JSON.parse(content); } catch (cause) {
          throw new CodexAppServerError('Codex returned invalid structured JSON.', { cause });
        }
      }
      return { content, ...(options.outputSchema ? { output } : {}), threadId,
        model: started.model ?? this.#options.model ?? 'default',
        ...(usage ? { usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0,
          totalTokens: usage.totalTokens ?? 0 } } : {}),
      };
    } catch (error) {
      if (signal.aborted) {
        // If turn/start timed out before returning an id, the server may still be running it.
        if (threadId && turnId && this.#process) {
          try {
            await this.#request('turn/interrupt', { threadId, turnId }, AbortSignal.timeout(1000));
          } catch { healthy = false; }
        } else { healthy = false; }
        if (!healthy) await this.close();
        throw abortError(signal);
      }
      throw error;
    } finally {
      if (threadId) this.#threads.delete(threadId);
      // Release ephemeral thread resources after success or error, without hiding the result.
      if (threadId && healthy && this.#process) {
        await this.#request('thread/unsubscribe', { threadId }, AbortSignal.timeout(1000)).catch(() => {});
      }
      await prepared.cleanup();
    }
  }

  async close() {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#closing = this.#shutdown();
    return this.#closing;
  }

  async #shutdown() {
    const child = this.#process;
    this.#process = undefined;
    this.#fail(new CodexAppServerError('Codex client closed.'));
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolveExit => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, 1000);
      child.once('close', () => { clearTimeout(timer); resolveExit(); });
      child.kill();
    });
  }
}

async function prepareMessages(input) {
  const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
  if (!Array.isArray(messages) || !messages.length) throw new TypeError('Input must be a string or a nonempty message array.');
  const system = [], sections = [], images = [];
  let tempDir;
  const cleanup = async () => { if (tempDir) await rm(tempDir, { recursive: true, force: true }); };
  try {
    for (const message of messages) {
      if (!['system', 'user', 'assistant', 'tool'].includes(message.role)) throw new TypeError('Unsupported message role.');
      const texts = [];
      const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
      if (!Array.isArray(blocks)) throw new TypeError('Message content must be text or content blocks.');
      for (const block of blocks) {
        if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
        else if (message.role === 'user' && block.type === 'localImage' && typeof block.path === 'string') {
          if (!isAbsolute(block.path)) throw new TypeError('Local image paths must be absolute.');
          await access(block.path, constants.R_OK);
          images.push({ type: 'localImage', path: block.path });
        } else if (message.role === 'user' && block.type === 'image' && typeof block.url === 'string') {
          const data = /^data:image\/(png|jpeg|gif|webp);base64,([a-z\d+/]*={0,2})$/i.exec(block.url);
          if (data) {
            tempDir ??= await mkdtemp(join(tmpdir(), 'codex-provider-'));
            const path = join(tempDir, `${images.length}.${data[1].toLowerCase()}`);
            await writeFile(path, Buffer.from(data[2], 'base64'), { mode: 0o600 });
            images.push({ type: 'localImage', path });
          } else if (/^https?:\/\//i.test(block.url)) images.push({ type: 'image', url: block.url });
          else throw new TypeError('Images must be HTTP(S) URLs or base64 PNG/JPEG/GIF/WebP data URLs.');
        } else throw new TypeError('Unsupported content block (images are supported in user messages only).');
      }
      if (message.role === 'system') system.push(...texts);
      else sections.push(`[${message.role.toUpperCase()}${message.name ? ` (${message.name})` : ''}]\n${texts.join('\n')}`);
    }
    return { system: system.join('\n\n'), inputs: [{ type: 'text', text: sections.join('\n\n') }, ...images], cleanup };
  } catch (error) { await cleanup(); throw error; }
}
