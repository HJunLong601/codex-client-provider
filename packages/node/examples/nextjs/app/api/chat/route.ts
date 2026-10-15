import { getCodex } from '../../../lib/codex';

export const runtime = 'nodejs';

// Local development example. Add authentication before exposing this endpoint.
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || !('prompt' in body) ||
      typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 20_000) {
    return Response.json({ error: 'Provide a prompt of 1–20000 characters.' }, { status: 400 });
  }
  try {
    const result = await getCodex().invoke(body.prompt, { signal: request.signal });
    return Response.json({ content: result.content });
  } catch {
    return Response.json({ error: 'Codex request failed. Check the server installation and login.' }, { status: 502 });
  }
}
