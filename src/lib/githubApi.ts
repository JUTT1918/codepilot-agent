import type { GitHubChange, GitHubRemote, GitHubRepository, WorkspaceFile } from '../types';

export class GithubClientError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: number, readonly conflicts?: string[]) {
    super(message);
    this.name = 'GithubClientError';
  }
}

export type DeviceStart = {
  transactionId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

export type DevicePoll =
  | { status: 'pending'; retryAfter: number; interval: number }
  | { status: 'authorized'; sessionId: string; login: string; expiresAt: string };

export type GitHubSession = { sessionId: string; login: string };

export type PrivateImport = {
  name: string;
  source: string;
  files: WorkspaceFile[];
  remote: GitHubRemote;
};

export type PushResult = {
  branch: string;
  commitSha: string;
  treeSha: string;
  htmlUrl: string;
  commitUrl: string;
  files: string[];
};

async function githubRequest<T>(path: string, options: RequestInit = {}, sessionId?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (sessionId) headers.set('Authorization', `Bearer ${sessionId}`);
  const response = await fetch(`/api/github${path}`, { ...options, headers });
  if (!response.ok) {
    let body: { error?: string; retryAfter?: number; conflicts?: string[] } = {};
    try {
      body = await response.json() as typeof body;
    } catch {
      // Use a safe fallback when the service returns a non-JSON error.
    }
    throw new GithubClientError(body.error || 'The GitHub request could not be completed.', response.status, body.retryAfter, body.conflicts);
  }
  return response.json() as Promise<T>;
}

export function startDeviceFlow(clientId: string) {
  return githubRequest<DeviceStart>('/device/start', {
    method: 'POST',
    body: JSON.stringify({ clientId }),
  });
}

export function pollDeviceFlow(transactionId: string) {
  return githubRequest<DevicePoll>('/device/poll', {
    method: 'POST',
    body: JSON.stringify({ transactionId }),
  });
}

export function getGithubSession(sessionId: string) {
  return githubRequest<{ login: string; expiresAt: string }>('/session', {}, sessionId);
}

export function listGithubRepositories(sessionId: string) {
  return githubRequest<{ repositories: GitHubRepository[]; truncated: boolean }>('/repositories', {}, sessionId);
}

export function disconnectGithub(sessionId: string) {
  return githubRequest<{ ok: true }>('/session', { method: 'DELETE' }, sessionId);
}

export function importPrivateRepository(sessionId: string, fullName: string) {
  return githubRequest<PrivateImport>('/import', {
    method: 'POST',
    body: JSON.stringify({ fullName }),
  }, sessionId);
}

export function pushGithubBranch(sessionId: string, remote: GitHubRemote, changes: GitHubChange[], commitMessage: string, branchName: string) {
  return githubRequest<PushResult>('/push', {
    method: 'POST',
    body: JSON.stringify({
      owner: remote.owner,
      repo: remote.repo,
      sourceBranch: remote.sourceBranch,
      baseCommitSha: remote.baseCommitSha,
      baseTreeSha: remote.baseTreeSha,
      changes,
      commitMessage,
      branchName,
    }),
  }, sessionId);
}
