import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowDownToLine, ArrowUpRight, Check, Clock3, Copy, ExternalLink, GitBranch, LockKeyhole, RefreshCw, ShieldCheck, Upload, X } from 'lucide-react';
import type { GitHubRemote, GitHubRepository, UserSettings, WorkspaceFile } from '../types';
import { importProjectArchive } from '../lib/files';
import { importPublicRepository } from '../lib/github';
import { disconnectGithub, getGithubSession, GithubClientError, importPrivateRepository, listGithubRepositories, pollDeviceFlow, startDeviceFlow, type GitHubSession } from '../lib/githubApi';

type ImportResult = { name: string; files: WorkspaceFile[]; source?: string; remote?: GitHubRemote };
type Props = {
  onClose: () => void;
  onImport: (result: ImportResult) => void;
  settings: UserSettings;
  onSettingsChange: (next: UserSettings) => void;
  githubSession: GitHubSession | null;
  onGithubSessionChange: (next: GitHubSession | null) => void;
};

type Tab = 'public' | 'archive' | 'private';
type DeviceFlow = { transactionId: string; userCode: string; verificationUri: string; interval: number; expiresAt: number };
const APP_SETUP_URL = 'https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app';
const INSTALL_SETUP_URL = 'https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app';

export default function RepoDialog({ onClose, onImport, settings, onSettingsChange, githubSession, onGithubSessionChange }: Props) {
  const [tab, setTab] = useState<Tab>('public');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [repoLoading, setRepoLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [repositoriesTruncated, setRepositoriesTruncated] = useState(false);
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlow | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [pollStatus, setPollStatus] = useState('');
  const [copyState, setCopyState] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function importUrl() {
    setError(''); setSuccess(''); setLoading(true);
    try {
      const result = await importPublicRepository(url);
      onImport(result);
      setSuccess(`Imported ${result.files.length} source files from ${result.name}.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Repository import failed.');
    } finally {
      setLoading(false);
    }
  }

  async function importArchive(file?: File) {
    if (!file) return;
    setError(''); setSuccess(''); setLoading(true);
    try {
      const files = await importProjectArchive(file);
      const name = file.name.replace(/\.zip$/i, '').replace(/[-_]+/g, ' ').trim() || 'Imported project';
      onImport({ name, files });
      setSuccess(`Imported ${files.length} source files from ${file.name}.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Project import failed.');
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function beginAuthorization() {
    setError(''); setSuccess(''); setLoading(true);
    try {
      const flow = await startDeviceFlow(settings.githubAppClientId.trim());
      const expiresAt = Date.now() + flow.expiresIn * 1_000;
      setDeviceFlow({ ...flow, expiresAt });
      setRemainingSeconds(flow.expiresIn);
      setPollStatus('Waiting for you to authorize Codepilot in GitHub…');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not start GitHub authorization.');
    } finally {
      setLoading(false);
    }
  }

  async function loadRepositories(sessionId: string) {
    setRepoLoading(true); setError('');
    try {
      const [identity, result] = await Promise.all([getGithubSession(sessionId), listGithubRepositories(sessionId)]);
      onGithubSessionChange({ sessionId, login: identity.login });
      setRepositories(result.repositories);
      setRepositoriesTruncated(result.truncated);
    } catch (problem) {
      if (problem instanceof GithubClientError && problem.status === 401) onGithubSessionChange(null);
      setError(problem instanceof Error ? problem.message : 'Could not load authorized repositories.');
      setRepositories([]);
      setRepositoriesTruncated(false);
    } finally {
      setRepoLoading(false);
    }
  }

  useEffect(() => {
    if (tab !== 'private' || !githubSession) return;
    let active = true;
    setRepoLoading(true); setError('');
    Promise.all([getGithubSession(githubSession.sessionId), listGithubRepositories(githubSession.sessionId)]).then(([identity, result]) => {
      if (!active) return;
      onGithubSessionChange({ sessionId: githubSession.sessionId, login: identity.login });
      setRepositories(result.repositories);
      setRepositoriesTruncated(result.truncated);
    }).catch((problem: unknown) => {
      if (!active) return;
      if (problem instanceof GithubClientError && problem.status === 401) onGithubSessionChange(null);
      setRepositories([]);
      setRepositoriesTruncated(false);
      setError(problem instanceof Error ? problem.message : 'Could not load authorized repositories.');
    }).finally(() => { if (active) setRepoLoading(false); });
    return () => { active = false; };
  }, [tab, githubSession?.sessionId]);

  useEffect(() => {
    if (!deviceFlow) return;
    let active = true;
    let timer = 0;
    const tick = () => {
      if (active) setRemainingSeconds(Math.max(0, Math.ceil((deviceFlow.expiresAt - Date.now()) / 1_000)));
    };
    tick();
    const countdown = window.setInterval(tick, 1_000);
    const poll = async () => {
      if (!active) return;
      if (Date.now() >= deviceFlow.expiresAt) {
        setError('The GitHub device code expired. Start a new authorization.');
        setDeviceFlow(null);
        return;
      }
      try {
        const result = await pollDeviceFlow(deviceFlow.transactionId);
        if (!active) return;
        if (result.status === 'authorized') {
          onGithubSessionChange({ sessionId: result.sessionId, login: result.login });
          setDeviceFlow(null);
          setPollStatus('GitHub connected. Loading repositories…');
          await loadRepositories(result.sessionId);
          return;
        }
        setPollStatus(`Still waiting for GitHub approval · next check in ${result.retryAfter}s`);
        timer = window.setTimeout(() => void poll(), Math.max(1, result.retryAfter) * 1_000);
      } catch (problem) {
        if (!active) return;
        if (problem instanceof GithubClientError && [400, 403, 410].includes(problem.status)) {
          setError(problem.message);
          setDeviceFlow(null);
          return;
        }
        const retry = problem instanceof GithubClientError ? Math.max(5, problem.retryAfter ?? 10) : 10;
        setPollStatus(`GitHub is temporarily unavailable · retrying in ${retry}s`);
        timer = window.setTimeout(() => void poll(), retry * 1_000);
      }
    };
    timer = window.setTimeout(() => void poll(), Math.max(5, deviceFlow.interval) * 1_000);
    return () => { active = false; window.clearInterval(countdown); window.clearTimeout(timer); };
  }, [deviceFlow?.transactionId]);

  async function importPrivate(fullName: string) {
    if (!githubSession) return;
    setError(''); setSuccess(''); setLoading(true);
    try {
      const result = await importPrivateRepository(githubSession.sessionId, fullName);
      onImport(result);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Private repository import failed.');
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    if (!githubSession) return;
    setLoading(true); setError('');
    try {
      await disconnectGithub(githubSession.sessionId);
      onGithubSessionChange(null);
      setRepositories([]);
      setRepositoriesTruncated(false);
      setSuccess('GitHub disconnected. Server-side session cleared.');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'GitHub could not be disconnected.');
    } finally {
      setLoading(false);
    }
  }

  async function copyCode() {
    if (!deviceFlow) return;
    try {
      await navigator.clipboard.writeText(deviceFlow.userCode);
      setCopyState(true);
      window.setTimeout(() => setCopyState(false), 1_500);
    } catch {
      setError('Clipboard access is unavailable. Select and copy the code manually.');
    }
  }

  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog repo-dialog" role="dialog" aria-modal="true" aria-labelledby="repo-title">
        <header className="dialog-header"><div><span className="dialog-kicker">PROJECT ACCESS</span><h2 id="repo-title">Connect a repository</h2><p>Import a project into your local Codepilot workspace.</p></div><button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button></header>
        <div className="dialog-tabs"><button className={tab === 'public' ? 'active' : ''} onClick={() => { setTab('public'); setError(''); }}><GitBranch size={15} />Public GitHub</button><button className={tab === 'archive' ? 'active' : ''} onClick={() => { setTab('archive'); setError(''); }}><Upload size={15} />Upload archive</button><button className={tab === 'private' ? 'active' : ''} onClick={() => { setTab('private'); setError(''); }}><LockKeyhole size={15} />Private access</button></div>

        {tab === 'public' && <div className="repo-panel"><label className="field-label" htmlFor="repo-url">PUBLIC REPOSITORY URL</label><div className="url-field"><GitBranch size={17} /><input id="repo-url" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void importUrl(); }} placeholder="https://github.com/owner/repository" /><ArrowUpRight size={15} /></div><div className="permission-note"><Check size={14} /><span>Read-only import. Files stay in this browser; no changes are pushed to GitHub until you explicitly confirm a branch push.</span></div><button className="button-primary full-button" onClick={() => void importUrl()} disabled={loading || !url.trim()}>{loading ? <span className="spinner" /> : <ArrowDownToLine size={15} />}{loading ? 'Importing repository…' : 'Import public repository'}</button><p className="dialog-footnote">Public repositories can be imported without sign-in. To access a private repository, use Private access. ZIP archives are an alternative.</p></div>}

        {tab === 'archive' && <div className="repo-panel archive-panel"><button className="archive-drop" onClick={() => inputRef.current?.click()}><span className="upload-emblem"><Upload size={20} /></span><b>Choose a project ZIP</b><span>Up to 20 MB · source and text files only</span><small>Archives are processed locally in this browser.</small></button><input ref={inputRef} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={(event) => void importArchive(event.target.files?.[0])} /><p className="dialog-footnote">Dependencies, build folders, private credential files, and hidden Git metadata are skipped.</p></div>}

        {tab === 'private' && <div className="repo-panel private-panel github-private-panel">
          <div className="github-setup-banner"><span className="lock-emblem"><LockKeyhole size={20} /></span><div><h3>Authorize through your GitHub App</h3><p>Codepilot uses GitHub's device flow; it never asks for your GitHub password or personal token.</p></div></div>
          {!githubSession && !deviceFlow && <>
            <div className="github-setup-steps"><b>One-time setup</b><ol><li>Register a GitHub App and enable <strong>Device Flow</strong>.</li><li>Grant only <strong>Contents: read/write</strong> and <strong>Metadata: read</strong>.</li><li>Install it with <strong>Only select repositories</strong> and choose the repos you want Codepilot to access.</li></ol><div className="github-doc-links"><a href={APP_SETUP_URL} target="_blank" rel="noreferrer">Register a GitHub App <ExternalLink size={12} /></a><a href={INSTALL_SETUP_URL} target="_blank" rel="noreferrer">Choose repository access <ExternalLink size={12} /></a></div></div>
            <label className="field-label" htmlFor="github-client-id">PUBLIC GITHUB APP CLIENT ID</label><div className="url-field github-client-field"><LockKeyhole size={15} /><input id="github-client-id" autoComplete="off" spellCheck={false} value={settings.githubAppClientId} onChange={(event) => onSettingsChange({ ...settings, githubAppClientId: event.target.value })} placeholder="Iv1.…" /></div>
            <div className="permission-note"><ShieldCheck size={14} /><span>This ID is public app configuration, not a GitHub credential. The user token will remain in server memory; reconnect after a Preview/server restart.</span></div>
            <button className="button-primary full-button" onClick={() => void beginAuthorization()} disabled={loading || !settings.githubAppClientId.trim()}>{loading ? <span className="spinner" /> : <LockKeyhole size={15} />}{loading ? 'Starting GitHub authorization…' : 'Continue with GitHub'}</button>
          </>}

          {deviceFlow && <div className="device-flow-card"><span className="device-flow-kicker"><Clock3 size={13} />AUTHORIZE THIS DEVICE</span><p>Open GitHub in a new tab, enter this one-time code, then return here. Codepilot will keep checking at GitHub's allowed interval.</p><div className="device-user-code"><strong>{deviceFlow.userCode}</strong><button className="icon-button" aria-label="Copy device code" onClick={() => void copyCode()}><Copy size={14} /></button></div>{copyState && <small className="copy-confirmation">Code copied</small>}<a className="device-verify-link" href={deviceFlow.verificationUri} target="_blank" rel="noreferrer">Open GitHub device page <ExternalLink size={13} /></a><div className="device-status-line"><span className="spinner" />{pollStatus || 'Waiting for authorization…'}<b>{Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, '0')}</b></div><button className="button-secondary full-button" onClick={() => setDeviceFlow(null)}>Cancel authorization</button></div>}

          {githubSession && <div className="github-connected"><div className="github-account-row"><span className="github-connected-icon"><Check size={16} /></span><div><b>Connected as @{githubSession.login}</b><small>Only repositories authorized for this GitHub App are listed.</small></div><button className="button-secondary github-disconnect" onClick={() => void disconnect()} disabled={loading}>Disconnect</button></div><div className="github-repository-heading"><b>Repositories available to Codepilot</b><button className="icon-button tiny" aria-label="Refresh repositories" onClick={() => void loadRepositories(githubSession.sessionId)} disabled={repoLoading}><RefreshCw size={13} /></button></div>{repositoriesTruncated && <div className="github-truncated-note"><AlertCircle size={13} /><span>Showing the first 1,000 accessible repositories; more may exist. Narrow this GitHub App installation to the repositories you need, then refresh.</span></div>}{repoLoading ? <div className="github-repos-loading"><span className="spinner" />Loading GitHub repositories…</div> : repositories.length ? <div className="github-repository-list">{repositories.map((repository) => <article className="github-repository-card" key={repository.id}><div className="github-repository-main"><b>{repository.fullName}</b><span><span className={repository.private ? 'repo-visibility private' : 'repo-visibility'}>{repository.private ? 'PRIVATE' : 'PUBLIC'}</span>{repository.defaultBranch} · {repository.canPush ? 'write access' : 'read-only'}</span>{repository.description && <small>{repository.description}</small>}</div><button className="button-secondary" onClick={() => void importPrivate(repository.fullName)} disabled={loading}>{loading ? <span className="spinner" /> : <ArrowDownToLine size={13} />}Import</button></article>)}</div> : <div className="github-empty-state"><AlertCircle size={16} /><span>No repositories are available to this app. Install it on the account and select repositories in GitHub, then refresh this list.</span></div>}</div>}
        </div>}

        {error && <div className="dialog-error"><AlertCircle size={15} />{error}</div>}{success && <div className="dialog-success"><Check size={15} />{success}</div>}
        <footer className="dialog-footer"><span><LockKeyhole size={13} />Workspace files stay local; prompted text is shared with Manus AI.</span><button onClick={onClose}>Cancel</button></footer>
      </section>
    </div>
  );
}
