import { CodexClient } from 'codex-client-provider';

const client = new CodexClient({ reasoningEffort: 'low' });
try {
  const result = await client.invoke('Reply with exactly PROVIDER_READY');
  if (result.content.trim() !== 'PROVIDER_READY') throw new Error('Unexpected smoke response.');
  console.log(`PROVIDER_READY model=${result.model}`);
} finally {
  await client.close();
}
