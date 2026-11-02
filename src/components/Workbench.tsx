import { lazy, Suspense, useMemo, useState } from 'react';
import { Code2, Download, Eye, FileCode2, FilePlus2, FolderOpen, GitBranch, RefreshCw, ShieldCheck } from 'lucide-react';
import type { GitHubRemote, WorkspaceFile } from '../types';
import { buildPreview } from '../lib/files';

const CodeEditor = lazy(() => import('./CodeEditor'));

type Props = {
  files: WorkspaceFile[];
  activeFilePath: string;
  mode: 'code' | 'preview';
  projectName: string;
  githubRemote?: GitHubRemote;
  githubConnected: boolean;
  onOpenGithub: () => void;
  onPush: () => void;
  onSelectFile: (path: string) => void;
  onChangeFile: (path: string, content: string) => void;
  onNewFile: () => void;
  onExport: () => void;
  onModeChange: (mode: 'code' | 'preview') => void;
};

export default function Workbench({ files, activeFilePath, mode, projectName, githubRemote, githubConnected, onOpenGithub, onPush, onSelectFile, onChangeFile, onNewFile, onExport, onModeChange }: Props) {
  const [previewVersion, setPreviewVersion] = useState(0);
  const activeFile = files.find((file) => file.path === activeFilePath) ?? files[0];
  const preview = useMemo(() => buildPreview(files), [files]);
  const nested = [...files].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <section className="workbench">
      <div className="workbench-head">
        <div className="workbench-title"><span className="workbench-icon"><Code2 size={15} /></span><div><b>Workspace</b><span>{projectName}</span></div></div>
        <div className="workbench-controls"><button className="icon-button workbench-refresh" title="Refresh preview" aria-label="Refresh preview" onClick={() => setPreviewVersion((version) => version + 1)}><RefreshCw size={15} /></button><button className="icon-button" title="Export project" aria-label="Export project" onClick={onExport}><Download size={15} /></button></div>
      </div>
      <div className="workbench-tabs"><div className="mode-tabs"><button className={mode === 'code' ? 'active' : ''} onClick={() => onModeChange('code')}><Code2 size={14} />Code</button><button className={mode === 'preview' ? 'active' : ''} onClick={() => onModeChange('preview')}><Eye size={14} />Preview</button></div><span className="workspace-kind"><span className="tiny-green-dot" />{githubRemote ? `GITHUB · ${githubRemote.sourceBranch}` : 'LOCAL WORKSPACE'}</span></div>
      {mode === 'code' ? (
        <div className="editor-layout">
          <div className="file-rail"><div className="file-rail-head"><span>FILES <small>{files.length}</small></span><button className="icon-button tiny" title="Create file" aria-label="Create file" onClick={onNewFile}><FilePlus2 size={14} /></button></div><div className="file-list">{nested.map((file) => <button key={file.path} className={`file-item${activeFile?.path === file.path ? ' active' : ''}`} onClick={() => onSelectFile(file.path)} title={file.path}><FileCode2 size={14} /><span>{file.path}</span></button>)}</div><div className="file-rail-footer"><ShieldCheck size={13} />Stored in this browser</div></div>
          <div className="editor-main"><div className="file-tab"><span className="file-tab-dot" /><span>{activeFile?.path ?? 'No file selected'}</span><span className="file-tab-state">SAVED</span></div>{activeFile ? <Suspense fallback={<div className="editor-loading"><span className="spinner" />Loading editor tools…</div>}><CodeEditor path={activeFile.path} value={activeFile.content} onChange={(value) => onChangeFile(activeFile.path, value)} /></Suspense> : <div className="empty-editor"><FolderOpen size={25} /><p>This workspace has no files yet.</p><button onClick={onNewFile}>Create a file</button></div>}</div>
        </div>
      ) : (
        <div className="preview-stage"><div className="preview-toolbar"><span className="browser-dots"><i /><i /><i /></span><span className="preview-url">workspace.local / {activeFile?.path ?? 'index.html'}</span><span className="preview-safe"><ShieldCheck size={12} />sandboxed</span></div><iframe key={previewVersion} title="Sandboxed project preview" className="live-preview" sandbox="allow-scripts" srcDoc={preview} /><div className="preview-footnote"><ShieldCheck size={13} />Preview executes only the current workspace’s HTML, CSS, and JavaScript in an isolated frame.</div></div>
      )}
      <div className="workbench-footer"><span><span className="tiny-green-dot" />All changes saved locally</span><div className="workbench-footer-actions"><button className="github-push-button" onClick={githubRemote && githubConnected ? onPush : onOpenGithub}><GitBranch size={12} />{githubRemote && githubConnected ? 'Push branch' : 'Connect GitHub'}</button><button onClick={onExport}><Download size={13} />Export project</button></div></div>
    </section>
  );
}
