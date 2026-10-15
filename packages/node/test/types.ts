import { CodexClient, type Completion, type Message } from 'codex-client-provider';

const client = new CodexClient({ reasoningEffort: 'low', timeoutMs: 120_000 });
const messages: Message[] = [{ role: 'user', content: [
  { type: 'text', text: 'Describe' }, { type: 'localImage', path: '/tmp/test.png' },
] }];
const result: Completion = await client.invoke(messages, {
  outputSchema: { type: 'object' }, signal: new AbortController().signal,
});
const content: string = result.content;
const closed: boolean = client.closed;
void content;
void closed;
// @ts-expect-error Completion.output requires runtime narrowing.
const answer: string = result.output;
void answer;
// @ts-expect-error Browser-style/unknown roles are rejected by the public contract.
client.invoke([{ role: 'human', content: 'hi' }]);
await client.close();
