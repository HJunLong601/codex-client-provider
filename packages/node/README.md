# Codex Client Provider for Node.js

An unofficial, dependency-free ESM package with TypeScript declarations for a
locally signed-in `codex app-server`. No Python process or API key is required.
Authentication stays with Codex; this package never reads its authentication files.

Requires **Node.js 20.3+**, a compatible native Codex executable, and an active
Codex login on the machine running Node.js. Protocol reference:
[official OpenAI documentation](https://developers.openai.com/codex/app-server/).

## Install from this repository

This Node package has not been published to npm. Build a local tarball first:

```console
cd packages/node
npm pack
```

Then install the resulting file in your Node.js or Next.js project:

```console
npm install /absolute/path/to/codex-client-provider-0.1.0.tgz
codex login
codex login status
```

JavaScript ships directly; there is no transpilation step or runtime dependency.
The npm name is proposed and must be available or changed before publishing.

## Basic usage

```js
import { CodexClient } from 'codex-client-provider';

const client = new CodexClient({ reasoningEffort: 'low', timeoutMs: 120_000 });
try {
  const result = await client.invoke('Explain React hooks in one sentence.');
  console.log(result.content);
  console.log(result.usage);
} finally {
  await client.close();
}
```

Reuse one client for a long-running server; close it when the host shuts down.
`close()` is permanent and rejects in-flight calls. Each `invoke` creates a fresh
ephemeral thread. To continue a conversation, pass the history explicitly:

```js
const result = await client.invoke([
  { role: 'system', content: 'Reply concisely in Chinese.' },
  { role: 'user', content: '什么是 React？' },
  { role: 'assistant', content: 'React 是用于构建用户界面的库。' },
  { role: 'user', content: '它的 hook 呢？' },
]);
```

## React / Next.js

The package runs on a **Node.js server or Electron main process**. React running
in a browser calls your HTTP endpoint; it cannot spawn Codex. The package export
has a Node-only condition to prevent accidental browser imports. Edge runtimes
are unsupported.

Copy [the Next.js example](examples/nextjs/) into an existing App Router project.
It contains a Node route, a client component, and a shared server client for hot
reload. The call path is:

```text
React component → POST /api/chat → CodexClient → local codex app-server
```

The Codex process and login must exist **where the Node backend runs**. Deploying
the React website does not grant access to a visitor's local Codex login. The
example is for local development; authenticate and authorize users before
exposing a server's account-backed endpoint. Use a persistent Node host capable
of spawning the native binary.

## Structured output

```js
const result = await client.invoke('Return a short greeting.', {
  outputSchema: {
    type: 'object',
    properties: { greeting: { type: 'string' } },
    required: ['greeting'],
    additionalProperties: false,
  },
});
console.log(result.output); // unknown in TypeScript; narrow/validate in your app
```

The schema is passed to Codex and the response is parsed as JSON. This package
does not perform independent JSON Schema validation. The `content` field keeps
the original text. Invalid JSON rejects the call.

## Images

```js
await client.invoke([{ role: 'user', content: [
  { type: 'text', text: 'Describe this screenshot.' },
  { type: 'localImage', path: '/absolute/path/screenshot.png' },
  // Or: { type: 'image', url: 'data:image/png;base64,...' }
  // Or: { type: 'image', url: 'https://example.com/image.png' }
] }]);
```

Images are supported in user messages. Base64 PNG/JPEG/GIF/WebP data URLs become
private temporary files, cleaned up after the call. Local files are kept intact.
Unlike the Python adapter, this version does not resize or compress images.

## Options and cancellation

| Option | Default | Purpose |
| --- | --- | --- |
| `model` | Codex default | Model name; `auto`/`default` omit the model override. |
| `reasoningEffort` | Codex default | Effort supported by the selected model. |
| `timeoutMs` | `120000` | Call deadline, including startup. |
| `cwd` | `process.cwd()` | Server-side working directory. |
| `codexBinary` | Discovery | Native executable path. |
| `clientName`, `clientTitle` | Package identity | App Server handshake identity. |
| `serviceName` | `codex-client-provider-node` | Thread service identity. |
| `appServerArgs` | `['app-server', '--listen', 'stdio://']` | Advanced launch override. |

Discovery checks `CODEX_CLIENT_BIN`, the legacy `ARTEMIS_CODEX_BIN`, PATH, and
the Windows desktop installation. On Windows, point at the native `codex.exe`;
`.cmd` and `.bat` wrappers are not launched through a shell.

`invoke` accepts `outputSchema`, a per-call `timeoutMs`, and an `AbortSignal`:

```js
const controller = new AbortController();
const pending = client.invoke('Explain this.', { signal: controller.signal });
controller.abort();
await pending; // rejects with CodexAppServerError
```

Cancellation attempts `turn/interrupt` with up to one extra second for cleanup.
If startup or turn creation times out before a turn id is known, or interruption
fails, the client closes to stop orphaned work. This also rejects concurrent
calls on that client; create a new client for subsequent calls. Thread cleanup
may take up to one further second. Process exit rejects pending calls promptly.

Calls use `approvalPolicy: never` and the read-only sandbox. Instructions ask
Codex to avoid built-in tools; server-originated tool/approval requests are
rejected. These instructions are not an isolation boundary against reading
files available inside that sandbox. This initial Node release has no LangChain
JS / Vercel AI SDK adapter, automatic host tool execution, or streaming API.

## Development

```console
npm test
npm run typecheck
npm pack --dry-run
```

Tests use a real child process implementing an offline protocol fixture; no login,
device, network, or model usage is needed. `npm run smoke` is an opt-in live call
that expects a Codex login and uses its account quota. CI covers Node 20/22/24 on
Linux, macOS, and Windows.

## 中文说明

这是原 Python Provider 的独立 Node.js 实现，包含 TypeScript 类型定义。
Next.js 请在 `runtime = 'nodejs'` 的服务端路由中调用，React 客户端只调用该路由。
运行 Node 的机器需要安装并登录 Codex；网页无法直接复用访问者电脑上的登录态。
目前尚未发布 npm，可通过 `npm pack` 生成安装包后在其他项目中安装。
