export type ApiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

export async function sendChat(messages: ApiMessage[], signal?: AbortSignal) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!response.ok) throw new Error(await readError(response, 'The assistant could not complete that request.'));

  const body = (await response.json()) as { message?: { content?: string } };
  if (!body.message?.content?.trim()) throw new Error('The assistant returned an empty response. Try again.');
  return body.message.content;
}

export async function transcribeAudio(blob: Blob) {
  const form = new FormData();
  const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  form.append('file', blob, `voice-note.${extension}`);

  const response = await fetch('/api/transcribe', { method: 'POST', body: form });
  if (!response.ok) throw new Error(await readError(response, 'Voice transcription is unavailable right now.'));
  const body = (await response.json()) as { text?: string };
  if (!body.text?.trim()) throw new Error('No speech was detected. Try recording again.');
  return body.text.trim();
}
