import { Router, type Request, type Response } from "express";

const router = Router();

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 60_000;
const UPSTREAM_TIMEOUT_MS = 60_000;

const CODEPILOT_SYSTEM_INSTRUCTION =
  "You are Codepilot, a careful professional coding assistant. Help users design, build, debug, and explain software across programming languages. Provide accurate, actionable code; state assumptions and security implications; do not claim to execute or modify files unless tool support explicitly exists. Keep responses focused and preserve user control.";

const allowedRoles = new Set(["user", "assistant", "system"]);

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type UpstreamResponse = {
  error?: unknown;
  choices?: Array<{
    message?: {
      role?: unknown;
      content?: unknown;
    };
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serviceConfiguration(): { endpoint: string; apiKey: string } | null {
  const baseUrl = process.env.MANUS_API_URL?.trim();
  const apiKey = process.env.MANUS_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;

  return {
    endpoint: `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`,
    apiKey,
  };
}

router.post("/", async (request: Request, response: Response) => {
  const body: unknown = request.body;
  const rawMessages = isRecord(body) ? body.messages : undefined;

  if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > MAX_MESSAGES) {
    response.status(400).json({ error: "Provide between 1 and 40 valid messages." });
    return;
  }

  const messages: ChatMessage[] = [];
  let totalChars = 0;

  for (const item of rawMessages) {
    if (!isRecord(item) || typeof item.role !== "string" || !allowedRoles.has(item.role)) {
      response.status(400).json({ error: "Messages must use user, assistant, or system roles." });
      return;
    }
    if (typeof item.content !== "string" || item.content.length > MAX_MESSAGE_CHARS) {
      response.status(400).json({ error: "Each message must contain text within the size limit." });
      return;
    }

    totalChars += item.content.length;
    if (totalChars > MAX_TOTAL_CHARS) {
      response.status(400).json({ error: "Combined message content exceeds the size limit." });
      return;
    }

    messages.push({ role: item.role as ChatMessage["role"], content: item.content });
  }

  const config = serviceConfiguration();
  if (!config) {
    response.status(503).json({ error: "The AI service is unavailable." });
    return;
  }

  try {
    const upstream = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: CODEPILOT_SYSTEM_INSTRUCTION },
          ...messages,
        ],
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    let result: UpstreamResponse;
    try {
      result = (await upstream.json()) as UpstreamResponse;
    } catch {
      response.status(502).json({ error: "The AI service returned an invalid response." });
      return;
    }

    if (!upstream.ok || (isRecord(result) && result.error !== undefined)) {
      response.status(502).json({ error: "The AI service could not complete the request." });
      return;
    }

    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      response.status(502).json({ error: "The AI service returned no message." });
      return;
    }

    response.status(200).json({
      message: { role: "assistant", content },
    });
  } catch {
    response.status(504).json({ error: "The AI service timed out or is unavailable." });
  }
});

export default router;
