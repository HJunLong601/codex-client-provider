'use client';

import { useState, type FormEvent } from 'react';

export default function ChatPage() {
  const [prompt, setPrompt] = useState('用一句话解释 React hooks');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setAnswer('');
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Request failed.');
      setAnswer(data.content);
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : 'Request failed.');
    } finally { setBusy(false); }
  }

  return (
    <main>
      <h1>Local Codex chat</h1>
      <form onSubmit={submit}>
        <label htmlFor="prompt">消息</label>
        <textarea id="prompt" value={prompt} maxLength={20_000}
          onChange={event => setPrompt(event.target.value)} />
        <button disabled={busy || !prompt.trim()}>{busy ? '回答中…' : '发送'}</button>
      </form>
      <pre aria-live="polite" style={{ whiteSpace: 'pre-wrap' }}>{answer}</pre>
    </main>
  );
}
