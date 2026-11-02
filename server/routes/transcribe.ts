import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";

const router = Router();

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 60_000;

const audioTypes: Record<string, string> = {
  ".webm": "audio/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AUDIO_BYTES,
    files: 1,
    fields: 0,
    parts: 1,
  },
});

type TranscriptionResponse = {
  error?: unknown;
  text?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

router.post("/", upload.single("file"), async (request: Request, response: Response) => {
  const file = request.file;
  if (!file || file.size === 0) {
    response.status(400).json({ error: "Attach one non-empty audio file in the file field." });
    return;
  }

  const extension = path.extname(file.originalname).toLowerCase();
  const mediaType = audioTypes[extension];
  if (!mediaType || (file.mimetype && file.mimetype !== "application/octet-stream" && !file.mimetype.startsWith("audio/"))) {
    response.status(400).json({ error: "Use a supported audio file format." });
    return;
  }

  const baseUrl = process.env.MANUS_API_URL?.trim();
  const apiKey = process.env.MANUS_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    response.status(503).json({ error: "The transcription service is unavailable." });
    return;
  }

  try {
    const form = new FormData();
    const audioBlob = new Blob([new Uint8Array(file.buffer)], { type: mediaType });
    form.append("file", audioBlob, `recording${extension}`);
    form.append("model", "whisper-1");

    const upstream = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    let result: TranscriptionResponse;
    try {
      result = (await upstream.json()) as TranscriptionResponse;
    } catch {
      response.status(502).json({ error: "The transcription service returned an invalid response." });
      return;
    }

    if (!upstream.ok || (isRecord(result) && result.error !== undefined)) {
      response.status(502).json({ error: "The transcription service could not complete the request." });
      return;
    }

    if (typeof result.text !== "string" || result.text.trim().length === 0) {
      response.status(502).json({ error: "The transcription service returned no text." });
      return;
    }

    response.status(200).json({ text: result.text.trim() });
  } catch {
    response.status(504).json({ error: "The transcription service timed out or is unavailable." });
  }
});

export default router;
