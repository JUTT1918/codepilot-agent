import { randomBytes } from "node:crypto";

export const GITHUB_API = "https://api.github.com";
export const GITHUB_DEVICE_URL = "https://github.com/login/device/code";
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_VERIFICATION_URI = "https://github.com/login/device";
export const GITHUB_API_VERSION = "2026-03-10";
export const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_PENDING = 1_000;
const MAX_SESSIONS = 500;
const SESSION_MAX_TTL_MS = 30 * 24 * 60 * 60_000;
const REFRESH_SKEW_MS = 60_000;

export type PendingDevice = {
  clientId: string;
  deviceCode: string;
  userCode: string;
  expiresAt: number;
  interval: number;
  nextPollAt: number;
};

export type GithubSession = {
  clientId: string;
  accessToken: string;
  refreshToken: string | null;
  refreshExpiresAt: number | null;
  accessExpiresAt: number;
  sessionExpiresAt: number;
  login: string;
};

export type GithubApiError = Error & {
  status: number;
  retryAfter: number | null;
  rateLimited: boolean;
};

export type OAuthTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  refresh_token_expires_in?: unknown;
  device_code?: unknown;
  user_code?: unknown;
  interval?: unknown;
  error?: unknown;
};

export type GithubUser = { login?: unknown };

export const pendingDevices = new Map<string, PendingDevice>();
export const githubSessions = new Map<string, GithubSession>();
const refreshFlights = new Map<string, Promise<GithubSession>>();

function randomId(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function createOpaqueId(): string {
  return randomId(32);
}

export function pruneGithubState(now = Date.now()): void {
  for (const [id, pending] of pendingDevices) {
    if (now >= pending.expiresAt) pendingDevices.delete(id);
  }
  for (const [id, session] of githubSessions) {
    if (now >= session.sessionExpiresAt || (session.refreshExpiresAt !== null && now >= session.refreshExpiresAt && now >= session.accessExpiresAt)) {
      githubSessions.delete(id);
    }
  }
}

const cleanupTimer = setInterval(() => pruneGithubState(), 60_000);
cleanupTimer.unref?.();

export function storePendingDevice(pending: PendingDevice): string | null {
  pruneGithubState();
  if (pendingDevices.size >= MAX_PENDING) return null;
  const id = createOpaqueId();
  pendingDevices.set(id, pending);
  return id;
}

export function storeGithubSession(session: GithubSession): string | null {
  pruneGithubState();
  if (githubSessions.size >= MAX_SESSIONS) return null;
  const id = createOpaqueId();
  githubSessions.set(id, session);
  return id;
}

export function parseRetryAfter(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return Math.max(1, Math.ceil(reset - Date.now() / 1000));
  return null;
}

export async function fetchOAuthJson(url: string, body: URLSearchParams): Promise<{ response: Response; payload: OAuthTokenResponse }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  let payload: OAuthTokenResponse;
  try {
    const parsed: unknown = await response.json();
    payload = typeof parsed === "object" && parsed !== null ? parsed as OAuthTokenResponse : {};
  } catch {
    throw new Error("GitHub returned an invalid authentication response.");
  }
  return { response, payload };
}

function upstreamError(status: number, retryAfter: number | null, rateLimited: boolean): GithubApiError {
  const error = new Error("GitHub API request failed.") as GithubApiError;
  error.status = status;
  error.retryAfter = retryAfter;
  error.rateLimited = rateLimited;
  return error;
}

export function isGithubApiError(error: unknown): error is GithubApiError {
  return error instanceof Error && "status" in error && "retryAfter" in error && "rateLimited" in error;
}

export async function githubApi<T>(session: GithubSession, path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("\n")) {
    throw new Error("Invalid GitHub API path.");
  }
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${session.accessToken}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const retryAfter = parseRetryAfter(response);
  if (response.status === 204) return undefined as T;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const rateLimited = response.status === 429 || (response.status === 403 && (response.headers.has("retry-after") || response.headers.get("x-ratelimit-remaining") === "0"));
    throw upstreamError(response.status, retryAfter, rateLimited);
  }
  return payload as T;
}

function boundedSeconds(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) : fallback;
}

export async function refreshSessionIfNeeded(sessionId: string, _session: GithubSession): Promise<GithubSession> {
  const flight = refreshFlights.get(sessionId);
  if (flight) return flight;
  const current = githubSessions.get(sessionId);
  if (!current) throw Object.assign(new Error("GitHub session expired. Reconnect your account."), { statusCode: 401 });
  if (Date.now() < current.accessExpiresAt - REFRESH_SKEW_MS) return current;

  const refresh = rotateGithubSession(sessionId, current);
  refreshFlights.set(sessionId, refresh);
  try {
    return await refresh;
  } finally {
    if (refreshFlights.get(sessionId) === refresh) refreshFlights.delete(sessionId);
  }
}

async function rotateGithubSession(sessionId: string, session: GithubSession): Promise<GithubSession> {
  if (Date.now() >= session.sessionExpiresAt || !session.refreshToken || (session.refreshExpiresAt !== null && Date.now() >= session.refreshExpiresAt)) {
    if (githubSessions.get(sessionId)?.refreshToken === session.refreshToken) githubSessions.delete(sessionId);
    throw Object.assign(new Error("GitHub session expired. Reconnect your account."), { statusCode: 401 });
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: session.clientId,
    refresh_token: session.refreshToken,
  });
  try {
    const { response, payload } = await fetchOAuthJson(GITHUB_TOKEN_URL, body);
    if (!response.ok || typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string") {
      if (githubSessions.get(sessionId)?.refreshToken === session.refreshToken) githubSessions.delete(sessionId);
      throw Object.assign(new Error("GitHub session expired. Reconnect your account."), { statusCode: 401 });
    }
    const latest = githubSessions.get(sessionId);
    if (!latest || latest.refreshToken !== session.refreshToken || latest.clientId !== session.clientId) {
      throw Object.assign(new Error("GitHub session was disconnected during token refresh."), { statusCode: 401 });
    }
    const now = Date.now();
    const accessSeconds = boundedSeconds(payload.expires_in, 8 * 60 * 60, 30 * 24 * 60 * 60);
    const refreshExpiry = typeof payload.refresh_token_expires_in === "number" && Number.isFinite(payload.refresh_token_expires_in) && payload.refresh_token_expires_in > 0
      ? now + Math.min(Math.floor(payload.refresh_token_expires_in), 365 * 24 * 60 * 60) * 1000
      : latest.refreshExpiresAt;
    const updated: GithubSession = {
      ...latest,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      accessExpiresAt: now + accessSeconds * 1000,
      refreshExpiresAt: refreshExpiry,
      sessionExpiresAt: Math.min(refreshExpiry ?? now + SESSION_MAX_TTL_MS, now + SESSION_MAX_TTL_MS),
    };
    githubSessions.set(sessionId, updated);
    return updated;
  } catch (error) {
    if (error instanceof Error && "statusCode" in error) throw error;
    // The refresh POST may have rotated the token even if its response was lost; do not retry it.
    if (githubSessions.get(sessionId)?.refreshToken === session.refreshToken) deleteGithubSession(sessionId);
    throw Object.assign(new Error("GitHub token refresh failed. Reconnect your account."), { statusCode: 401 });
  }
}

export function deleteGithubSession(sessionId: string): void {
  githubSessions.delete(sessionId);
}

export function githubRouteError(error: unknown): { status: number; body: { error: string; retryAfter?: number } } {
  if (isGithubApiError(error)) {
    if (error.rateLimited) {
      const retryAfter = error.retryAfter ?? 60;
      return { status: 429, body: { error: "GitHub is rate limiting requests. Please wait before trying again.", retryAfter } };
    }
    if (error.status === 401) return { status: 401, body: { error: "GitHub authorization expired. Reconnect your account." } };
    if (error.status === 403) return { status: 403, body: { error: "GitHub denied this request. Check repository access and app permissions." } };
    if (error.status === 404) return { status: 404, body: { error: "Repository or GitHub resource was not found or is not accessible. Confirm the GitHub App is installed and authorized for this repository." } };
    return { status: 502, body: { error: "GitHub could not complete the request." } };
  }
  if (error instanceof Error && "statusCode" in error) {
    return { status: Number((error as Error & { statusCode: unknown }).statusCode) || 401, body: { error: error.message } };
  }
  return { status: 502, body: { error: "GitHub is temporarily unavailable. Please try again." } };
}
