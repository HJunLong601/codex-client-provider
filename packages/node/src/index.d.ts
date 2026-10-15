export type JsonSchema = Record<string, unknown>;
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'localImage'; path: string };

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  name?: string;
}

export interface CodexClientOptions {
  model?: string;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  timeoutMs?: number;
  cwd?: string;
  codexBinary?: string;
  clientName?: string;
  clientTitle?: string;
  serviceName?: string;
  /** Advanced: replace app-server launch arguments, e.g. for a test server. */
  appServerArgs?: string[];
}

export interface InvokeOptions {
  outputSchema?: JsonSchema;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface Completion {
  content: string;
  /** Parsed JSON when outputSchema is supplied. Validate/narrow it in your application. */
  output?: unknown;
  threadId: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export class CodexAppServerError extends Error {
  constructor(message: string, options?: ErrorOptions);
}
export function findCodexBinary(configured?: string): Promise<string | null>;
export class CodexClient {
  constructor(options?: CodexClientOptions);
  readonly closed: boolean;
  invoke(input: string | Message[], options?: InvokeOptions): Promise<Completion>;
  /** Permanently close this client and reject pending calls. */
  close(): Promise<void>;
}
