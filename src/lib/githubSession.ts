import type { GitHubSession } from './githubApi';

const SESSION_KEY = 'codepilot.github.session.v1';

export function loadGithubSession(): GitHubSession | null {
  try {
    const value = sessionStorage.getItem(SESSION_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<GitHubSession>;
    if (typeof parsed.sessionId !== 'string' || !/^[A-Za-z0-9_-]{40,60}$/.test(parsed.sessionId) || typeof parsed.login !== 'string') return null;
    return { sessionId: parsed.sessionId, login: parsed.login };
  } catch {
    return null;
  }
}

export function saveGithubSession(session: GitHubSession | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // An in-memory session remains usable when browser storage is unavailable.
  }
}
