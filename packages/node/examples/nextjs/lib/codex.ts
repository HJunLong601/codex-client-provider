// Import this module only from server code.
import { CodexClient } from 'codex-client-provider';

const state = globalThis as typeof globalThis & { localCodexClient?: CodexClient };
export function getCodex() {
  if (!state.localCodexClient || state.localCodexClient.closed) {
    state.localCodexClient = new CodexClient({ reasoningEffort: 'low', timeoutMs: 120_000 });
  }
  return state.localCodexClient;
}
