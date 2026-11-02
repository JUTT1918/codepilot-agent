import type { GitHubChange, GitHubRemote, WorkspaceFile } from '../types';

const SECRET_PATH = /(^|\/)(\.env(?!\.example$)[^/]*|id_rsa|id_ed25519|[^/]+\.(pem|key|p12|pfx))$/i;
const OMIT_PATH = /(^|\/)(\.git|node_modules)(\/|$)/i;

export async function gitBlobSha(content: string) {
  if (!globalThis.crypto?.subtle) throw new Error('This browser cannot calculate Git checksums securely. Open Codepilot in a secure browser context and try again.');
  const bytes = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const payload = new Uint8Array(header.byteLength + bytes.byteLength);
  payload.set(header, 0);
  payload.set(bytes, header.byteLength);
  const digest = await globalThis.crypto.subtle.digest('SHA-1', payload);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validatePath(path: string) {
  if (!path || path.length > 240 || path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`The path “${path}” is not a safe repository-relative path.`);
  }
  if (OMIT_PATH.test(path)) throw new Error(`The path “${path}” is Git metadata or a dependency folder and cannot be pushed.`);
  if (SECRET_PATH.test(path)) throw new Error(`The path “${path}” looks like a private credential and cannot be pushed.`);
  if (path.toLowerCase().startsWith('.github/workflows/')) throw new Error('Workflow-file changes are disabled because the connected GitHub App does not request Workflows permission.');
}

export async function calculateGitHubChanges(files: WorkspaceFile[], remote: GitHubRemote): Promise<GitHubChange[]> {
  const currentPaths = new Set<string>();
  const changes: GitHubChange[] = [];
  for (const file of files) {
    validatePath(file.path);
    currentPaths.add(file.path);
    const baseSha = remote.baselineShas[file.path] ?? null;
    const currentSha = await gitBlobSha(file.content);
    if (currentSha !== baseSha) changes.push({ path: file.path, content: file.content, baseSha });
  }
  for (const [path, baseSha] of Object.entries(remote.baselineShas)) {
    validatePath(path);
    if (!currentPaths.has(path)) changes.push({ path, content: null, baseSha });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export async function buildGitHubBaseline(files: WorkspaceFile[]) {
  const entries = await Promise.all(files.map(async (file) => [file.path, await gitBlobSha(file.content)] as const));
  return Object.fromEntries(entries);
}
