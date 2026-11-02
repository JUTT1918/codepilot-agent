import { useEffect, useState } from 'react';
import { AlertCircle, ArrowUpRight, Check, GitBranch, LockKeyhole, ShieldCheck, X } from 'lucide-react';
import type { GitHubRemote, Project } from '../types';
import { GithubClientError, pushGithubBranch } from '../lib/githubApi';
import { buildGitHubBaseline, calculateGitHubChanges } from '../lib/githubDiff';
import type { GitHubChange } from '../types';

type Props = {
  project: Project;
  sessionId: string;
  onClose: () => void;
  onPushed: (remote: GitHubRemote) => void;
};

function suggestedBranch() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ?? Math.random().toString(16).slice(2, 18);
  return `codepilot/${date}-${random}`;
}

function changeLabel(change: GitHubChange) {
  if (change.content === null) return { label: 'DELETE', className: 'delete' };
  if (change.baseSha === null) return { label: 'ADD', className: 'add' };
  return { label: 'EDIT', className: 'edit' };
}

export default function PushDialog({ project, sessionId, onClose, onPushed }: Props) {
  const remote = project.githubRemote;
  const [changes, setChanges] = useState<GitHubChange[]>([]);
  const [loadingChanges, setLoadingChanges] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(`Update ${project.name} from Codepilot`);
  const [branchName, setBranchName] = useState(suggestedBranch);
  const [result, setResult] = useState<{ htmlUrl: string; commitUrl: string; branch: string; files: string[] } | null>(null);

  useEffect(() => {
    if (!remote) return;
    let active = true;
    setLoadingChanges(true); setError('');
    void calculateGitHubChanges(project.files, remote).then((next) => {
      if (active) setChanges(next);
    }).catch((problem: unknown) => {
      if (active) setError(problem instanceof Error ? problem.message : 'Could not calculate repository changes.');
    }).finally(() => { if (active) setLoadingChanges(false); });
    return () => { active = false; };
  }, [project.files, remote]);

  async function confirmPush() {
    if (!remote || !changes.length || !message.trim() || !branchName.trim()) return;
    setSending(true); setError('');
    try {
      const baselineShas = await buildGitHubBaseline(project.files);
      const response = await pushGithubBranch(sessionId, remote, changes, message.trim(), branchName.trim());
      onPushed({ ...remote, sourceBranch: response.branch, baseCommitSha: response.commitSha, baseTreeSha: response.treeSha, baselineShas });
      setResult({ htmlUrl: response.htmlUrl, commitUrl: response.commitUrl, branch: response.branch, files: response.files });
    } catch (problem) {
      const conflicts = problem instanceof GithubClientError ? problem.conflicts : undefined;
      const baseMessage = problem instanceof Error ? problem.message : 'The GitHub branch push failed.';
      setError(conflicts?.length ? `${baseMessage} Conflicting paths: ${conflicts.join(', ')}` : `${baseMessage} If the connection was interrupted, check the repository branches before trying again.`);
    } finally {
      setSending(false);
    }
  }

  if (!remote) return null;

  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) onClose(); }}>
      <section className="dialog push-dialog" role="dialog" aria-modal="true" aria-labelledby="push-title">
        <header className="dialog-header"><div><span className="dialog-kicker">REVIEW BEFORE PUSH</span><h2 id="push-title">{result ? 'Branch created' : 'Push changes to GitHub'}</h2><p>{remote.owner}/{remote.repo} · based on <code>{remote.sourceBranch}</code></p></div><button className="icon-button" aria-label="Close" onClick={onClose} disabled={sending}><X size={18} /></button></header>

        {result ? <div className="push-result-panel"><span className="push-success-mark"><Check size={19} /></span><h3>Changes are on a new branch</h3><p><code>{result.branch}</code> was created in <b>{remote.owner}/{remote.repo}</b>. The source/default branch was not changed or merged.</p><div className="push-result-actions"><a className="button-primary" href={result.htmlUrl} target="_blank" rel="noreferrer">Review branch <ArrowUpRight size={14} /></a><a className="button-secondary" href={result.commitUrl} target="_blank" rel="noreferrer">View commit <ArrowUpRight size={14} /></a></div><p className="dialog-footnote">Open a pull request in GitHub if you want to propose merging this branch.</p></div> : <div className="push-review-body">
          <div className="push-guard-note"><ShieldCheck size={15} /><span>Only the listed source-text changes will be sent. Codepilot never writes to or force-updates the source branch.</span></div>
          <div className="push-field-group"><label className="field-label" htmlFor="push-branch">NEW BRANCH NAME</label><div className="url-field"><GitBranch size={15} /><input id="push-branch" value={branchName} onChange={(event) => setBranchName(event.target.value)} spellCheck={false} /></div><small>Created from the latest <code>{remote.sourceBranch}</code> tip. Review this exact branch name before confirming.</small></div>
          <div className="push-field-group"><label className="field-label" htmlFor="push-message">COMMIT MESSAGE</label><div className="url-field"><input id="push-message" value={message} maxLength={200} onChange={(event) => setMessage(event.target.value)} /></div></div>
          <div className="push-change-heading"><div><b>Files to send</b><span>{loadingChanges ? 'Calculating…' : `${changes.length} change${changes.length === 1 ? '' : 's'}`}</span></div><span className="push-scope-label"><LockKeyhole size={12} />Selected files only</span></div>
          {loadingChanges ? <div className="github-repos-loading"><span className="spinner" />Comparing with imported repository…</div> : changes.length ? <div className="push-change-list">{changes.map((change) => { const item = changeLabel(change); return <div className="push-change-row" key={change.path}><span className={`push-change-kind ${item.className}`}>{item.label}</span><code>{change.path}</code></div>; })}</div> : <div className="push-empty-state"><Check size={15} />No source-file changes to push.</div>}
          <div className="push-confirm-note"><AlertCircle size={14} /><span>GitHub authorization and Contents write permission are required. A successful push creates a reviewable branch; merging remains a separate GitHub action.</span></div>
          {error && <div className="dialog-error"><AlertCircle size={15} />{error}</div>}
          <footer className="push-dialog-footer"><button className="button-secondary" onClick={onClose} disabled={sending}>Cancel</button><button className="button-primary" onClick={() => void confirmPush()} disabled={loadingChanges || sending || !changes.length || !message.trim() || !/^codepilot\/[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(branchName.trim())}>{sending ? <span className="spinner" /> : <GitBranch size={14} />}{sending ? 'Creating branch…' : `Create branch and push ${changes.length || ''}`}</button></footer>
        </div>}
      </section>
    </div>
  );
}
