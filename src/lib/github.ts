import type { GitHubRemote, WorkspaceFile } from '../types';

const MAX_FILES = 48;
const MAX_FILE_BYTES = 260_000;
const MAX_TOTAL_BYTES = 1_500_000;
const TEXT_FILE = /(^|\/)(readme|dockerfile|makefile|gemfile|procfile|license|\.gitignore|\.dockerignore)$|\.(html?|css|[cm]?jsx?|tsx?|json|md|mdx|ya?ml|toml|xml|svg|txt|py|go|rs|java|kt|swift|php|rb|sh|sql|c|cc|cpp|h|hpp|cs|vue|svelte|astro|env\.example)$/i;
const SKIP_PATH = /(^|\/)(node_modules|\.git|\.next|\.nuxt|dist|build|coverage|vendor)(\/|$)/i;

function repositoryParts(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Enter a valid public GitHub repository URL.');
  }
  if (url.hostname.toLowerCase() !== 'github.com') throw new Error('Only github.com repository URLs are supported.');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('Use a URL like github.com/owner/repository.');
  const owner = decodeURIComponent(parts[0]);
  const repo = decodeURIComponent(parts[1].replace(/\.git$/i, ''));
  let branch: string | undefined;
  const treeIndex = parts.indexOf('tree');
  if (treeIndex >= 0 && parts[treeIndex + 1]) branch = parts[treeIndex + 1];
  return { owner, repo, branch };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' } });
  if (response.status === 403 || response.status === 429) throw new Error('GitHub’s public API rate limit was reached. Try again later or upload a project archive.');
  if (!response.ok) throw new Error(response.status === 404 ? 'That public repository or branch could not be found.' : 'GitHub could not load this repository right now.');
  return response.json() as Promise<T>;
}

function decodeBase64Text(base64: string): string | null {
  try {
    const binary = atob(base64.replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0') || text.startsWith('version https://git-lfs.github.com/spec/v1')) return null;
    let suspicious = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code < 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13) suspicious += 1;
    }
    return suspicious <= Math.max(2, Math.floor(text.length * 0.01)) ? text : null;
  } catch {
    return null;
  }
}

export async function importPublicRepository(input: string) {
  const { owner, repo, branch: requestedBranch } = repositoryParts(input);
  const repoData = await getJson<{ default_branch: string; private: boolean }>(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  if (repoData.private) throw new Error('This repository is private. Use the Private access tab and authorize a GitHub App to import it.');
  const branch = requestedBranch ?? repoData.default_branch;
  const branchPath = branch.split('/').map(encodeURIComponent).join('/');
  const repositoryPath = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const ref = await getJson<{ object: { sha: string } }>(`${repositoryPath}/git/ref/heads/${branchPath}`);
  const baseCommitSha = ref.object.sha;
  const commit = await getJson<{ tree: { sha: string } }>(`${repositoryPath}/git/commits/${encodeURIComponent(baseCommitSha)}`);
  const baseTreeSha = commit.tree.sha;
  const tree = await getJson<{ truncated?: boolean; tree: Array<{ path: string; sha: string; type: string; size?: number }> }>(`${repositoryPath}/git/trees/${encodeURIComponent(baseTreeSha)}?recursive=1`);
  if (tree.truncated) throw new Error('GitHub returned an incomplete repository tree. Try uploading a project archive or import a smaller repository.');
  const candidates = tree.tree.filter((entry) => entry.type === 'blob' && TEXT_FILE.test(entry.path) && !SKIP_PATH.test(entry.path) && (entry.size ?? 0) <= MAX_FILE_BYTES).sort((a, b) => {
    const score = (path: string) => path.toLowerCase() === 'index.html' ? 5 : /(^|\/)(package\.json|readme(?:\.md)?|vite\.config\.[jt]s)$/.test(path.toLowerCase()) ? 4 : /(^|\/)src\//.test(path.toLowerCase()) ? 2 : 0;
    return score(b.path) - score(a.path) || a.path.localeCompare(b.path);
  }).slice(0, MAX_FILES);
  if (!candidates.length) throw new Error('No supported text or source files were found in that repository.');

  const files: Array<WorkspaceFile & { sha: string }> = [];
  let total = 0;
  for (let i = 0; i < candidates.length; i += 6) {
    const batch = candidates.slice(i, i + 6);
    const results = await Promise.all(batch.map(async (entry) => {
      const blob = await getJson<{ content?: string; encoding?: string }>(`${repositoryPath}/git/blobs/${encodeURIComponent(entry.sha)}`);
      if (blob.encoding !== 'base64' || typeof blob.content !== 'string') return null;
      const content = decodeBase64Text(blob.content);
      if (content === null || new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) return null;
      return { path: entry.path, content, updatedAt: new Date().toISOString(), sha: entry.sha };
    }));
    for (const file of results) {
      if (!file) continue;
      const size = new TextEncoder().encode(file.content).byteLength;
      if (total + size > MAX_TOTAL_BYTES) break;
      files.push(file);
      total += size;
    }
    if (total >= MAX_TOTAL_BYTES) break;
  }
  if (!files.length) throw new Error('The repository did not provide any readable source files.');
  const baselineShas = Object.fromEntries(files.map((file) => [file.path, file.sha]));
  const remote: GitHubRemote = {
    provider: 'github',
    owner,
    repo,
    private: false,
    sourceBranch: branch,
    baseCommitSha,
    baseTreeSha,
    baselineShas,
    htmlUrl: `https://github.com/${owner}/${repo}`,
  };
  return { files: files.map(({ sha: _sha, ...file }) => file), name: `${owner}/${repo}`, source: `https://github.com/${owner}/${repo}`, remote };
}
