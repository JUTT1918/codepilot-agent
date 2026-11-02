import { Router, type Request, type Response } from "express";
import { createRateLimiter } from "../rateLimit.js";
import {
  GITHUB_DEVICE_URL,
  GITHUB_TOKEN_URL,
  GITHUB_VERIFICATION_URI,
  deleteGithubSession,
  fetchOAuthJson,
  githubApi,
  githubRouteError,
  githubSessions,
  pendingDevices,
  refreshSessionIfNeeded,
  storeGithubSession,
  storePendingDevice,
  type GithubSession,
  type OAuthTokenResponse,
} from "../github.js";

const router = Router();
const TEN_MINUTES = 10 * 60_000;
const MAX_FILE_BYTES = 260 * 1024;
const MAX_TOTAL_BYTES = 1_572_864;
const MAX_FILES = 48;
const MAX_REPOSITORY_PAGES = 10;
const SAFE_SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
const REPO_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const OWNER_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/;

type UnknownRecord = Record<string, unknown>;
type RepoInfo = {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  description?: string | null;
  permissions?: { pull?: boolean; push?: boolean; admin?: boolean };
};
type TreeEntry = { path?: string; mode?: string; type?: string; sha?: string; size?: number };
type TreeResponse = { truncated?: boolean; tree?: TreeEntry[] };
type GitCommitResponse = { tree?: { sha?: string }; committer?: { date?: string } };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function limiter(limit: number, message: string) {
  return createRateLimiter({ limit, windowMs: TEN_MINUTES, message });
}

function bearerSessionId(request: Request): string | null {
  const header = request.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{40,60})$/.exec(header);
  return match?.[1] ?? null;
}

async function requireSession(request: Request, response: Response): Promise<{ id: string; session: GithubSession } | null> {
  const id = bearerSessionId(request);
  if (!id) {
    response.status(401).json({ error: "A valid Codepilot GitHub session is required." });
    return null;
  }
  const current = githubSessions.get(id);
  if (!current) {
    response.status(401).json({ error: "GitHub session expired. Reconnect your account." });
    return null;
  }
  try {
    const session = await refreshSessionIfNeeded(id, current);
    return { id, session };
  } catch (error) {
    const result = githubRouteError(error);
    response.status(result.status).json(result.body);
    return null;
  }
}

function sendGithubError(response: Response, error: unknown): void {
  const result = githubRouteError(error);
  if (result.body.retryAfter !== undefined) response.setHeader("Retry-After", String(result.body.retryAfter));
  response.status(result.status).json(result.body);
}

function oauthErrorName(payload: OAuthTokenResponse): string {
  return typeof payload.error === "string" ? payload.error : "";
}

function oauthSeconds(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 30 * 24 * 60 * 60) : fallback;
}

function validateRepoName(value: unknown): { owner: string; repo: string; fullName: string } | null {
  if (typeof value !== "string" || value.length > 202 || value.split("/").length !== 2) return null;
  const [owner, repo] = value.split("/");
  if (!OWNER_NAME.test(owner) || !REPO_NAME.test(repo) || repo === "." || repo === "..") return null;
  return { owner, repo, fullName: `${owner}/${repo}` };
}

function validateBranch(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240 &&
    !value.startsWith("-") && !value.startsWith("/") && !value.endsWith("/") && !value.endsWith(".") &&
    !value.includes("..") && !value.includes("//") && !value.includes("@{") &&
    !/[\u0000-\u0020~^:?*\[\\]/.test(value) && value.split("/").every((part) => part.length > 0 && !part.startsWith(".") && !part.endsWith(".lock"));
}

function isExcludedPath(path: string): boolean {
  const lower = path.toLowerCase();
  const parts = lower.split("/");
  if (parts.some((part) => [".git", "node_modules", "build", "dist", "out", "coverage", ".next", ".turbo", "target"].includes(part))) return true;
  const base = parts.at(-1) ?? "";
  if (base === ".env" || (base.startsWith(".env.") && !/^\.env\.example$/i.test(base)) || base.endsWith(".env")) return true;
  if (/(^|[._-])(secret|secrets|credential|credentials)([._-]|$)/i.test(base)) return true;
  if (/\.(pem|key|p12|pfx|p7b|p7c|der|crt|cer|jks|keystore)$/i.test(base)) return true;
  if (/^(id_rsa|id_ed25519|authorized_keys|known_hosts)$/i.test(base)) return true;
  return false;
}

function isCanonicalRelativePath(path: unknown, forPush: boolean): path is string {
  if (typeof path !== "string" || path.length < 1 || path.length > 500 || path.startsWith("/") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return false;
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || part.toLowerCase() === ".git")) return false;
  if (isExcludedPath(path)) return false;
  if (forPush && /^\.github\/workflows\//i.test(path)) return false;
  return true;
}

function repoApiPath(owner: string, repo: string, suffix = ""): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
}

function repoCanPush(repo: RepoInfo): boolean {
  return repo.permissions?.push === true || repo.permissions?.admin === true;
}

async function getRepo(session: GithubSession, owner: string, repo: string): Promise<RepoInfo> {
  return githubApi<RepoInfo>(session, repoApiPath(owner, repo));
}

async function getBranchTip(session: GithubSession, owner: string, repo: string, branch: string): Promise<{ commitSha: string; treeSha: string; committedAt: string }> {
  const branchPath = branch.split("/").map(encodeURIComponent).join("/");
  const ref = await githubApi<{ object?: { sha?: string; type?: string } }>(session, repoApiPath(owner, repo, `/git/ref/heads/${branchPath}`));
  const commitSha = ref.object?.sha;
  if (!commitSha || !SAFE_SHA.test(commitSha)) throw new Error("GitHub returned an invalid branch reference.");
  const commit = await githubApi<GitCommitResponse>(session, repoApiPath(owner, repo, `/git/commits/${encodeURIComponent(commitSha)}`));
  const treeSha = commit.tree?.sha;
  if (!treeSha || !SAFE_SHA.test(treeSha)) throw new Error("GitHub returned an invalid commit tree.");
  return { commitSha, treeSha, committedAt: typeof commit.committer?.date === "string" ? commit.committer.date : new Date().toISOString() };
}

async function fetchFullTree(session: GithubSession, owner: string, repo: string, treeSha: string): Promise<TreeEntry[]> {
  const result = await githubApi<TreeResponse>(session, repoApiPath(owner, repo, `/git/trees/${encodeURIComponent(treeSha)}?recursive=1`));
  if (result.truncated || !Array.isArray(result.tree)) throw new Error("GitHub returned an incomplete repository tree; no changes were made.");
  return result.tree;
}

function isLikelyText(content: string): boolean {
  if (content.includes("\u0000")) return false;
  let suspicious = 0;
  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13 && code !== 12) suspicious += 1;
  }
  return suspicious <= Math.max(2, Math.floor(content.length * 0.01));
}

function decodeStrictUtf8(base64: string): string | null {
  try {
    const bytes = Buffer.from(base64, "base64");
    if (bytes.toString("base64").replace(/=+$/, "") !== base64.replace(/\s/g, "").replace(/=+$/, "")) return null;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const text = decoder.decode(bytes);
    return isLikelyText(text) ? text : null;
  } catch {
    return null;
  }
}

function filePriority(path: string): number {
  const lower = path.toLowerCase();
  const base = lower.split("/").at(-1) ?? "";
  const priorities: Record<string, number> = {
    "index.html": 0, "index.tsx": 1, "index.ts": 2, "main.tsx": 3, "main.ts": 4,
    "app.tsx": 5, "app.ts": 6, "package.json": 7, "vite.config.ts": 8,
    "readme.md": 9, "tsconfig.json": 10, "index.jsx": 11, "main.jsx": 12,
    "app.jsx": 13, "index.js": 14, "main.js": 15, "app.js": 16,
  };
  return priorities[base] ?? 100;
}

router.post("/device/start", limiter(10, "Too many GitHub connection attempts. Please wait before trying again."), async (request: Request, response: Response) => {
  const body: unknown = request.body;
  const clientId = isRecord(body) && typeof body.clientId === "string" ? body.clientId.trim() : "";
  if (!clientId || clientId.length > 200 || /[\u0000-\u0020\u007f]/.test(clientId)) {
    response.status(400).json({ error: "Provide a valid GitHub App client ID." });
    return;
  }
  try {
    const { response: upstream, payload } = await fetchOAuthJson(GITHUB_DEVICE_URL, new URLSearchParams({ client_id: clientId, scope: "offline_access" }));
    if (!upstream.ok || typeof payload.device_code !== "string" || payload.device_code.length < 1 || payload.device_code.length > 2_000 || typeof payload.user_code !== "string" || !/^[A-Za-z0-9-]{1,40}$/.test(payload.user_code)) {
      const code = oauthErrorName(payload);
      response.status(502).json({ error: code === "device_flow_disabled" || code === "unsupported_grant_type" ? "GitHub device authorization is disabled for this App. Enable device flow in the GitHub App settings." : "GitHub could not start device authorization. Check the GitHub App client ID and device-flow settings." });
      return;
    }
    const expiresIn = Math.min(oauthSeconds(payload.expires_in, 900), 30 * 60);
    const interval = Math.max(5, Math.min(oauthSeconds(payload.interval, 5), 60));
    const now = Date.now();
    const transactionId = storePendingDevice({
      clientId,
      deviceCode: payload.device_code,
      userCode: payload.user_code,
      expiresAt: now + Math.min(expiresIn * 1000, 30 * 60_000),
      interval,
      nextPollAt: now + interval * 1000,
    });
    if (!transactionId) {
      response.status(503).json({ error: "Too many GitHub authorization attempts are active. Try again shortly." });
      return;
    }
    response.status(200).json({ transactionId, userCode: payload.user_code, verificationUri: GITHUB_VERIFICATION_URI, expiresIn, interval });
  } catch {
    response.status(502).json({ error: "GitHub authorization could not be started. Please try again." });
  }
});

router.post("/device/poll", limiter(200, "Too many GitHub authorization polls. Please wait before trying again."), async (request: Request, response: Response) => {
  const body: unknown = request.body;
  const transactionId = isRecord(body) && typeof body.transactionId === "string" ? body.transactionId : "";
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(transactionId)) {
    response.status(400).json({ error: "Provide a valid authorization transaction ID." });
    return;
  }
  const pending = pendingDevices.get(transactionId);
  if (!pending) {
    response.status(410).json({ error: "GitHub authorization expired or is no longer available. Start again." });
    return;
  }
  const now = Date.now();
  if (now >= pending.expiresAt) {
    pendingDevices.delete(transactionId);
    response.status(410).json({ error: "GitHub authorization expired. Start again." });
    return;
  }
  if (now < pending.nextPollAt) {
    const retryAfter = Math.max(1, Math.ceil((pending.nextPollAt - now) / 1000));
    response.status(202).json({ status: "pending", retryAfter, interval: pending.interval });
    return;
  }
  // Advance before the network call so concurrent requests cannot poll faster than GitHub's interval.
  pending.nextPollAt = now + pending.interval * 1000;
  let obtainedAccessToken = false;
  try {
    const { response: upstream, payload } = await fetchOAuthJson(GITHUB_TOKEN_URL, new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: pending.clientId,
      device_code: pending.deviceCode,
    }));
    const oauthError = oauthErrorName(payload);
    if (!upstream.ok || oauthError) {
      if (oauthError === "authorization_pending") {
        response.status(202).json({ status: "pending", retryAfter: pending.interval, interval: pending.interval });
        return;
      }
      if (oauthError === "slow_down") {
        pending.interval = Math.min(300, pending.interval + 5);
        pending.nextPollAt = Date.now() + pending.interval * 1000;
        response.status(202).json({ status: "pending", retryAfter: pending.interval, interval: pending.interval });
        return;
      }
      if (oauthError === "access_denied") {
        pendingDevices.delete(transactionId);
        response.status(403).json({ error: "GitHub authorization was denied." });
        return;
      }
      if (oauthError === "expired_token") {
        pendingDevices.delete(transactionId);
        response.status(410).json({ error: "GitHub authorization expired. Start again." });
        return;
      }
      if (oauthError === "device_flow_disabled" || oauthError === "unsupported_grant_type") {
        pendingDevices.delete(transactionId);
        response.status(400).json({ error: "GitHub device authorization is disabled for this App. Enable device flow in the GitHub App settings." });
        return;
      }
      response.status(502).json({ error: "GitHub could not complete device authorization." });
      return;
    }
    if (typeof payload.access_token !== "string" || !payload.access_token) {
      response.status(502).json({ error: "GitHub returned an invalid authorization response." });
      return;
    }
    obtainedAccessToken = true;
    const provisional: GithubSession = {
      clientId: pending.clientId,
      accessToken: payload.access_token,
      refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
      accessExpiresAt: Date.now() + oauthSeconds(payload.expires_in, 8 * 60 * 60) * 1000,
      refreshExpiresAt: typeof payload.refresh_token === "string" ? Date.now() + oauthSeconds(payload.refresh_token_expires_in, 30 * 24 * 60 * 60) * 1000 : null,
      sessionExpiresAt: Date.now() + Math.min(oauthSeconds(payload.refresh_token_expires_in, 8 * 60 * 60), 30 * 24 * 60 * 60) * 1000,
      login: "",
    };
    const user = await githubApi<{ login?: unknown }>(provisional, "/user");
    if (typeof user.login !== "string" || !user.login) {
      pendingDevices.delete(transactionId);
      response.status(502).json({ error: "GitHub did not return a valid account identity." });
      return;
    }
    provisional.login = user.login;
    const sessionId = storeGithubSession(provisional);
    pendingDevices.delete(transactionId);
    if (!sessionId) {
      response.status(503).json({ error: "Too many active GitHub sessions. Disconnect an account or try later." });
      return;
    }
    response.status(200).json({ status: "authorized", sessionId, login: user.login, expiresAt: new Date(provisional.sessionExpiresAt).toISOString() });
  } catch {
    if (obtainedAccessToken) {
      pendingDevices.delete(transactionId);
      response.status(502).json({ error: "GitHub issued a token but account verification failed. Start a new connection; the token was not stored." });
      return;
    }
    response.status(502).json({ error: "GitHub authorization could not be checked. Try again after the indicated interval.", retryAfter: pending.interval });
  }
});

router.get("/session", limiter(30, "Too many GitHub session requests. Please wait before trying again."), async (request: Request, response: Response) => {
  const auth = await requireSession(request, response);
  if (!auth) return;
  response.status(200).json({ login: auth.session.login, expiresAt: new Date(auth.session.sessionExpiresAt).toISOString() });
});

router.delete("/session", limiter(30, "Too many GitHub session requests. Please wait before trying again."), (request: Request, response: Response) => {
  const id = bearerSessionId(request);
  if (id) deleteGithubSession(id);
  response.status(200).json({ ok: true });
});

router.get("/repositories", limiter(30, "Too many GitHub repository requests. Please wait before trying again."), async (request: Request, response: Response) => {
  const auth = await requireSession(request, response);
  if (!auth) return;
  try {
    const repositories: Array<{ id: number; fullName: string; private: boolean; defaultBranch: string; htmlUrl: string; canPush: boolean; description?: string }> = [];
    let truncated = false;
    for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
      const items = await githubApi<RepoInfo[]>(auth.session, `/user/repos?affiliation=owner%2Ccollaborator%2Corganization_member&per_page=100&page=${page}&sort=updated`);
      if (!Array.isArray(items)) throw new Error("GitHub returned an invalid repository list.");
      for (const repo of items) {
        if (typeof repo.id !== "number" || typeof repo.full_name !== "string" || typeof repo.default_branch !== "string" || typeof repo.html_url !== "string") continue;
        repositories.push({
          id: repo.id,
          fullName: repo.full_name,
          private: repo.private === true,
          defaultBranch: repo.default_branch,
          htmlUrl: repo.html_url,
          canPush: repoCanPush(repo),
          ...(typeof repo.description === "string" && repo.description ? { description: repo.description.slice(0, 500) } : {}),
        });
      }
      if (items.length < 100) break;
      if (page === MAX_REPOSITORY_PAGES) truncated = true;
    }
    response.status(200).json({ repositories, truncated });
  } catch (error) {
    sendGithubError(response, error);
  }
});

router.post("/import", limiter(30, "Too many GitHub imports. Please wait before trying again."), async (request: Request, response: Response) => {
  const auth = await requireSession(request, response);
  if (!auth) return;
  const body: unknown = request.body;
  const target = validateRepoName(isRecord(body) ? body.fullName : undefined);
  if (!target) {
    response.status(400).json({ error: "Provide a valid repository name in owner/repository form." });
    return;
  }
  try {
    const repo = await getRepo(auth.session, target.owner, target.repo);
    if (!repo.default_branch || !validateBranch(repo.default_branch)) throw new Error("GitHub returned an invalid default branch.");
    const tip = await getBranchTip(auth.session, target.owner, target.repo, repo.default_branch);
    const tree = await fetchFullTree(auth.session, target.owner, target.repo, tip.treeSha);
    const candidates = tree.filter((entry) => entry.type === "blob" && typeof entry.path === "string" && isCanonicalRelativePath(entry.path, false) && Number.isInteger(entry.size) && (entry.size as number) >= 0 && (entry.size as number) <= MAX_FILE_BYTES && typeof entry.sha === "string" && SAFE_SHA.test(entry.sha));
    candidates.sort((a, b) => filePriority(a.path as string) - filePriority(b.path as string) || (a.path as string).localeCompare(b.path as string));
    const files: Array<{ path: string; content: string; updatedAt: string }> = [];
    const baselineShas: Record<string, string> = {};
    let totalBytes = 0;
    for (const entry of candidates) {
      if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) break;
      const path = entry.path as string;
      const size = entry.size as number;
      if (totalBytes + size > MAX_TOTAL_BYTES) continue;
      try {
        const blob = await githubApi<{ content?: unknown; encoding?: unknown }>(auth.session, repoApiPath(target.owner, target.repo, `/git/blobs/${encodeURIComponent(entry.sha as string)}`));
        if (typeof blob.content !== "string" || blob.encoding !== "base64") continue;
        const content = decodeStrictUtf8(blob.content);
        if (content === null || Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) continue;
        const actualSize = Buffer.byteLength(content, "utf8");
        if (totalBytes + actualSize > MAX_TOTAL_BYTES) continue;
        files.push({ path, content, updatedAt: tip.committedAt });
        baselineShas[path] = entry.sha as string;
        totalBytes += actualSize;
      } catch (error) {
        if (isRecord(error) && error.status === 404) continue;
        throw error;
      }
    }
    response.status(200).json({
      name: repo.full_name,
      source: repo.html_url,
      files,
      remote: {
        provider: "github",
        owner: target.owner,
        repo: target.repo,
        private: repo.private === true,
        sourceBranch: repo.default_branch,
        baseCommitSha: tip.commitSha,
        baseTreeSha: tip.treeSha,
        baselineShas,
        htmlUrl: repo.html_url,
      },
    });
  } catch (error) {
    sendGithubError(response, error);
  }
});

type Change = { path: string; content: string | null; baseSha: string | null };

function validateChanges(raw: unknown): Change[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_FILES) return null;
  const changes: Change[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const value of raw) {
    if (!isRecord(value) || !isCanonicalRelativePath(value.path, true) || seen.has(value.path)) return null;
    if (value.baseSha !== null && (typeof value.baseSha !== "string" || !SAFE_SHA.test(value.baseSha))) return null;
    if (value.content !== null && typeof value.content !== "string") return null;
    if (typeof value.content === "string") {
      if (!isLikelyText(value.content)) return null;
      const bytes = Buffer.byteLength(value.content, "utf8");
      if (bytes > MAX_FILE_BYTES) return null;
      totalBytes += bytes;
      if (totalBytes > MAX_TOTAL_BYTES) return null;
    }
    seen.add(value.path);
    changes.push({ path: value.path, content: value.content as string | null, baseSha: value.baseSha as string | null });
  }
  for (const path of seen) {
    for (const other of seen) {
      if (path !== other && other.startsWith(`${path}/`)) return null;
    }
  }
  return changes;
}

router.post("/push", limiter(5, "Too many GitHub push attempts. Please wait before trying again."), async (request: Request, response: Response) => {
  const auth = await requireSession(request, response);
  if (!auth) return;
  const body: unknown = request.body;
  if (!isRecord(body)) {
    response.status(400).json({ error: "Provide a valid push request." });
    return;
  }
  const target = validateRepoName(`${String(body.owner ?? "")}/${String(body.repo ?? "")}`);
  const branch = body.sourceBranch;
  const baseCommitSha = body.baseCommitSha;
  const baseTreeSha = body.baseTreeSha;
  const message = body.commitMessage;
  const requestedBranch = body.branchName;
  const changes = validateChanges(body.changes);
  if (!target || !validateBranch(branch) || typeof baseCommitSha !== "string" || !SAFE_SHA.test(baseCommitSha) || typeof baseTreeSha !== "string" || !SAFE_SHA.test(baseTreeSha) || !changes || typeof message !== "string" || message.trim().length < 1 || message.length > 200 || !validateBranch(requestedBranch) || !/^codepilot\/[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(requestedBranch) || requestedBranch.length > 100) {
    response.status(400).json({ error: "Push request is invalid. Check branch, commit message, file paths, and size limits." });
    return;
  }
  try {
    const repo = await getRepo(auth.session, target.owner, target.repo);
    if (!repoCanPush(repo)) {
      response.status(403).json({ error: "This GitHub account does not have Contents write permission for the repository. Confirm repository access and GitHub App installation permissions." });
      return;
    }
    const requestedRef = requestedBranch.split("/").map(encodeURIComponent).join("/");
    try {
      await githubApi(auth.session, repoApiPath(target.owner, target.repo, `/git/ref/heads/${requestedRef}`));
      response.status(409).json({ error: "That Codepilot branch already exists. Choose a different branch name before confirming the push." });
      return;
    } catch (error) {
      if (!(error instanceof Error && "status" in error && Number((error as Error & { status: unknown }).status) === 404)) throw error;
    }
    // Read and compare all requested paths before creating any Git objects.
    const current = await getBranchTip(auth.session, target.owner, target.repo, branch);
    const currentTree = await fetchFullTree(auth.session, target.owner, target.repo, current.treeSha);
    const currentByPath = new Map<string, TreeEntry>();
    for (const entry of currentTree) if (typeof entry.path === "string") currentByPath.set(entry.path, entry);
    const conflicts: string[] = [];
    for (const change of changes) {
      const currentEntry = currentByPath.get(change.path);
      const currentSha = currentEntry?.type === "blob" ? currentEntry.sha : null;
      if (change.baseSha === null ? currentSha !== null : currentSha !== change.baseSha) conflicts.push(change.path);
      if (currentEntry && currentEntry.type !== "blob") conflicts.push(change.path);
      if (currentTree.some((entry) => typeof entry.path === "string" && (entry.path.startsWith(`${change.path}/`) || (change.path.startsWith(`${entry.path}/`) && entry.type === "blob")))) conflicts.push(change.path);
    }
    if (conflicts.length) {
      response.status(409).json({ error: "Some files changed on GitHub since they were imported. Review conflicts and import the latest version before pushing.", conflicts: [...new Set(conflicts)].slice(0, MAX_FILES) });
      return;
    }
    const items = changes.map((change) => {
      const currentEntry = currentByPath.get(change.path);
      if (change.content === null) return { path: change.path, mode: currentEntry?.mode === "100755" ? "100755" : "100644", type: "blob", sha: null };
      return { path: change.path, mode: currentEntry?.mode === "100755" ? "100755" : "100644", type: "blob", content: change.content };
    });
    const treeResult = await githubApi<{ sha?: string }>(auth.session, repoApiPath(target.owner, target.repo, "/git/trees"), {
      method: "POST",
      body: JSON.stringify({ base_tree: current.treeSha, tree: items }),
    });
    if (!treeResult.sha || !SAFE_SHA.test(treeResult.sha)) throw new Error("GitHub did not return the created tree.");
    const commitResult = await githubApi<{ sha?: string }>(auth.session, repoApiPath(target.owner, target.repo, "/git/commits"), {
      method: "POST",
      body: JSON.stringify({ message: message.trim(), tree: treeResult.sha, parents: [current.commitSha] }),
    });
    if (!commitResult.sha || !SAFE_SHA.test(commitResult.sha)) throw new Error("GitHub did not return the created commit.");
    const newBranch = requestedBranch;
    try {
      await githubApi(auth.session, repoApiPath(target.owner, target.repo, "/git/refs"), {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: commitResult.sha }),
      });
    } catch (error) {
      // POST outcome can be ambiguous; never retry automatically. The commit may exist without a visible branch.
      response.status(502).json({ error: "GitHub did not confirm creation of the Codepilot branch. No automatic retry was attempted; check the repository branches before trying again." });
      return;
    }
    const branchUrl = `${repo.html_url.replace(/\/$/, "")}/tree/${newBranch.split("/").map(encodeURIComponent).join("/")}`;
    const commitUrl = `${repo.html_url.replace(/\/$/, "")}/commit/${encodeURIComponent(commitResult.sha)}`;
    response.status(201).json({ branch: newBranch, commitSha: commitResult.sha, treeSha: treeResult.sha, htmlUrl: branchUrl, commitUrl, files: changes.map((change) => change.path) });
  } catch (error) {
    sendGithubError(response, error);
  }
});

export default router;
