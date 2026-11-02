import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Check, Code2, Eye, GitBranch, Menu, MessageSquare, Settings2, Sparkles } from 'lucide-react';
import type { AppState, Attachment, ChatMessage, ChatThread, GitHubRemote, Project, UserSettings, WorkspaceFile } from './types';
import { sendChat } from './lib/api';
import { downloadWorkspace, textContext } from './lib/files';
import { checkService } from './lib/health';
import { getGithubSession, GithubClientError, type GitHubSession } from './lib/githubApi';
import { loadGithubSession, saveGithubSession } from './lib/githubSession';
import { createProject, createThread, loadState, newId, saveState } from './lib/workspace';
import Sidebar from './components/Sidebar';
import ChatPane from './components/ChatPane';
import Workbench from './components/Workbench';
import RepoDialog from './components/RepoDialog';
import SettingsDialog from './components/SettingsDialog';
import PushDialog from './components/PushDialog';
import Brand from './components/Brand';

const timestamp = () => new Date().toISOString();

export default function App() {
  const [appState, setAppState] = useState<AppState>(() => loadState());
  const [activeFilePath, setActiveFilePath] = useState('index.html');
  const [workbenchMode, setWorkbenchMode] = useState<'code' | 'preview'>('preview');
  const [mobileView, setMobileView] = useState<'chat' | 'code' | 'preview'>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [repoDialogOpen, setRepoDialogOpen] = useState(false);
  const [pushDialogOpen, setPushDialogOpen] = useState(false);
  const [githubSession, setGithubSession] = useState<GitHubSession | null>(() => loadGithubSession());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serviceReady, setServiceReady] = useState(false);
  const [saved, setSaved] = useState(true);
  const [toast, setToast] = useState('');

  const project = appState.projects.find((item) => item.id === appState.activeProjectId) ?? appState.projects[0];
  const thread = project.threads.find((item) => item.id === project.activeThreadId) ?? project.threads[0];
  const activeFile = project.files.find((item) => item.path === activeFilePath) ?? project.files[0];

  useEffect(() => {
    setSaved(saveState(appState));
  }, [appState]);

  useEffect(() => {
    void checkService().then(setServiceReady);
  }, []);

  useEffect(() => {
    if (!githubSession) return;
    let active = true;
    void getGithubSession(githubSession.sessionId).then((identity) => {
      if (active && identity.login !== githubSession.login) {
        const next = { ...githubSession, login: identity.login };
        setGithubSession(next);
        saveGithubSession(next);
      }
    }).catch((problem: unknown) => {
      if (active && problem instanceof GithubClientError && problem.status === 401) {
        setGithubSession(null);
        saveGithubSession(null);
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (project.files.length && !project.files.some((file) => file.path === activeFilePath)) setActiveFilePath(project.files[0].path);
    if (!project.files.length) setActiveFilePath('');
  }, [project.id, project.files, activeFilePath]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const updateProject = (projectId: string, change: (current: Project) => Project) => {
    setAppState((current) => ({
      ...current,
      projects: current.projects.map((item) => item.id === projectId ? change(item) : item),
    }));
  };

  const updateThread = (projectId: string, threadId: string, change: (current: ChatThread) => ChatThread) => {
    updateProject(projectId, (current) => ({
      ...current,
      updatedAt: timestamp(),
      threads: current.threads.map((item) => item.id === threadId ? change(item) : item),
    }));
  };

  function selectProject(id: string) {
    setAppState((current) => ({ ...current, activeProjectId: id }));
    const next = appState.projects.find((item) => item.id === id);
    setActiveFilePath(next?.files[0]?.path ?? '');
    setMobileView('chat');
    setSidebarOpen(false);
  }

  function startNewThread() {
    const nextThread = createThread();
    updateProject(project.id, (current) => ({ ...current, activeThreadId: nextThread.id, threads: [nextThread, ...current.threads], updatedAt: timestamp() }));
    setMobileView('chat');
    setSidebarOpen(false);
  }

  function newWorkspace() {
    const name = window.prompt('Name your workspace', 'New project');
    if (name === null) return;
    const created = createProject(name);
    setAppState((current) => ({ ...current, projects: [created, ...current.projects], activeProjectId: created.id }));
    setActiveFilePath(created.files[0]?.path ?? '');
    setMobileView('chat');
    setSidebarOpen(false);
    setToast('New local workspace created.');
  }

  function selectThread(id: string) {
    updateProject(project.id, (current) => ({ ...current, activeThreadId: id }));
    setMobileView('chat');
    setSidebarOpen(false);
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        startNewThread();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [project.id]);

  async function handleSend(text: string, attachments: Attachment[]) {
    const activeProject = project;
    const activeThread = thread;
    if (!text.trim() && !attachments.length) return;
    setBusy(true);
    const createdAt = timestamp();
    const userMessage: ChatMessage = {
      id: newId(),
      role: 'user',
      content: text,
      createdAt,
      attachments: attachments.map((item) => item.name),
    };
    const firstUserMessage = !activeThread.messages.some((message) => message.role === 'user');
    const nextTitle = firstUserMessage ? (text.trim().slice(0, 46) || 'File review') : activeThread.title;
    updateThread(activeProject.id, activeThread.id, (current) => ({
      ...current,
      title: nextTitle,
      updatedAt: createdAt,
      messages: [...current.messages, userMessage],
    }));

    const modePrompt = appState.settings.agentMode === 'build'
      ? 'Mode: Build. Propose concrete, maintainable code changes, explain where they belong, and flag assumptions.'
      : appState.settings.agentMode === 'explain'
        ? 'Mode: Explain. Teach clearly and incrementally, using examples from the current files when useful.'
        : 'Mode: Review. Prioritize concrete correctness, security, accessibility, and maintainability findings before praise.';
    const detailPrompt = appState.settings.responseStyle === 'detailed' ? ' Give enough detail for a developer to follow the reasoning.' : ' Keep the answer focused and practical.';
    const fileContext = textContext(activeProject.files, 9_000);
    const workspaceInstruction = `${modePrompt}${detailPrompt}\n\nCurrent browser workspace files (context only; do not claim to have edited them):${fileContext || '\nNo project files are available yet.'}`;
    let attachmentContext = '';
    for (const attachment of attachments) {
      const remaining = 4_000 - attachmentContext.length;
      if (remaining <= 0) break;
      const detail = attachment.content ? `\n\n--- attached file: ${attachment.name} ---\n${attachment.content}` : `\n\n[Binary attachment: ${attachment.name}. Codepilot cannot inspect this file type yet and receives only its filename.]`;
      attachmentContext += detail.slice(0, remaining);
    }
    const recent = activeThread.messages.slice(-8).map((message) => ({
      role: message.role,
      content: message.content.slice(-1_700),
    }));
    const apiMessages = [
      { role: 'system' as const, content: workspaceInstruction.slice(0, 14_500) },
      ...recent,
      { role: 'user' as const, content: `${text.slice(0, 8_000)}${attachmentContext}` },
    ];

    try {
      const response = await sendChat(apiMessages);
      const assistantMessage: ChatMessage = { id: newId(), role: 'assistant', content: response, createdAt: timestamp() };
      updateThread(activeProject.id, activeThread.id, (current) => ({ ...current, updatedAt: assistantMessage.createdAt, messages: [...current.messages, assistantMessage] }));
    } catch {
      const assistantMessage: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: 'I couldn’t reach the managed AI service just now. Your message is saved in this browser; check the connection and send it again when you’re ready.',
        createdAt: timestamp(),
      };
      updateThread(activeProject.id, activeThread.id, (current) => ({ ...current, updatedAt: assistantMessage.createdAt, messages: [...current.messages, assistantMessage] }));
      throw new Error('Message saved. The managed AI service is temporarily unavailable.');
    } finally {
      setBusy(false);
      setMobileView('chat');
    }
  }

  function changeFile(path: string, content: string) {
    updateProject(project.id, (current) => ({
      ...current,
      updatedAt: timestamp(),
      files: current.files.map((file) => file.path === path ? { ...file, content, updatedAt: timestamp() } : file),
    }));
  }

  function addFile() {
    const path = window.prompt('File path', 'src/App.tsx');
    if (!path?.trim()) return;
    const normalized = path.trim().replace(/^\/+/, '').replace(/\.\.(\/|$)/g, '');
    if (!normalized || project.files.some((file) => file.path === normalized)) {
      setToast('That file path already exists or is not valid.');
      return;
    }
    const file: WorkspaceFile = { path: normalized, content: '', updatedAt: timestamp() };
    updateProject(project.id, (current) => ({ ...current, files: [...current.files, file], updatedAt: timestamp() }));
    setActiveFilePath(normalized);
    setWorkbenchMode('code');
    setMobileView('code');
  }

  function applyCode(code: string) {
    const target = activeFile?.path ?? 'index.html';
    if (!project.files.some((file) => file.path === target)) {
      updateProject(project.id, (current) => ({ ...current, files: [...current.files, { path: target, content: code, updatedAt: timestamp() }] }));
    } else {
      changeFile(target, code);
    }
    setActiveFilePath(target);
    setWorkbenchMode('code');
    setMobileView('code');
    setToast(`Code applied to ${target}. Review the change before using it.`);
  }

  function importProject(result: { name: string; files: WorkspaceFile[]; source?: string; remote?: GitHubRemote }) {
    const created = createProject(result.name, result.files, result.source, result.remote);
    setAppState((current) => ({ ...current, projects: [created, ...current.projects], activeProjectId: created.id }));
    setActiveFilePath(result.files[0]?.path ?? '');
    setRepoDialogOpen(false);
    setWorkbenchMode('code');
    setMobileView('code');
    setToast(`Imported ${result.files.length} files into a local workspace.`);
  }

  const updateSettings = useCallback((settings: UserSettings) => {
    setAppState((current) => ({ ...current, settings }));
  }, []);

  const updateGithubSession = useCallback((next: GitHubSession | null) => {
    setGithubSession(next);
    saveGithubSession(next);
  }, []);

  function handlePushComplete(remote: GitHubRemote) {
    updateProject(project.id, (current) => ({ ...current, githubRemote: remote, updatedAt: timestamp() }));
  }

  async function exportProject() {
    try {
      await downloadWorkspace(project.files, project.name);
      setToast('Project ZIP exported.');
    } catch {
      setToast('The ZIP could not be created. Please try again.');
    }
  }

  const mobileWorkbenchMode = useMemo(() => mobileView === 'preview' ? 'preview' : workbenchMode, [mobileView, workbenchMode]);

  return (
    <div className="app-shell">
      <Sidebar projects={appState.projects} project={project} activeThreadId={thread.id} open={sidebarOpen} onClose={() => setSidebarOpen(false)} onSelectProject={selectProject} onNewProject={newWorkspace} onNewThread={startNewThread} onSelectThread={selectThread} onConnect={() => setRepoDialogOpen(true)} onSettings={() => setSettingsOpen(true)} />
      <main className="app-main">
        <header className="workspace-header">
          <div className="workspace-breadcrumb"><button className="icon-button mobile-only-menu" aria-label="Open history" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button><div className="mobile-brand"><Brand compact /></div><span className="breadcrumb-project">{project.name}</span><span className="breadcrumb-separator">/</span><span className="breadcrumb-current">{project.source ? 'GitHub import' : 'Local workspace'}</span></div>
          <div className="header-actions"><span className={`managed-indicator${serviceReady ? '' : ' checking'}`}><i />{serviceReady ? 'Backend online' : 'Backend starting'}</span><button className="connect-button" onClick={() => setRepoDialogOpen(true)}><GitBranch size={14} /><span>{project.source ? 'Repository details' : 'Connect repository'}</span><span className="connect-arrow">↗</span></button><button className="icon-button header-settings" title="Agent settings" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /></button></div>
        </header>

        <div className="workspace-content">
          <div className={`chat-column${mobileView === 'chat' ? ' mobile-visible' : ''}`}><ChatPane messages={thread.messages} busy={busy} projectName={project.name} mode={appState.settings.agentMode} onSend={handleSend} onApplyCode={applyCode} onOpenSidebar={() => setSidebarOpen(true)} /></div>
          <div className={`workbench-column${mobileView !== 'chat' ? ' mobile-visible' : ''}`}><Workbench files={project.files} activeFilePath={activeFile?.path ?? ''} mode={mobileWorkbenchMode} projectName={project.name} githubRemote={project.githubRemote} githubConnected={Boolean(githubSession)} onOpenGithub={() => setRepoDialogOpen(true)} onPush={() => setPushDialogOpen(true)} onSelectFile={(path) => { setActiveFilePath(path); setWorkbenchMode('code'); setMobileView('code'); }} onChangeFile={changeFile} onNewFile={addFile} onExport={exportProject} onModeChange={(mode) => { setWorkbenchMode(mode); setMobileView(mode); }} /></div>
        </div>

        <nav className="mobile-tabs" aria-label="Workspace views"><button className={mobileView === 'chat' ? 'active' : ''} onClick={() => setMobileView('chat')}><MessageSquare size={17} /><span>Agent</span></button><button className={mobileView === 'code' ? 'active' : ''} onClick={() => { setMobileView('code'); setWorkbenchMode('code'); }}><Code2 size={17} /><span>Code</span></button><button className={mobileView === 'preview' ? 'active' : ''} onClick={() => { setMobileView('preview'); setWorkbenchMode('preview'); }}><Eye size={17} /><span>Preview</span></button></nav>
        <div className="save-indicator" aria-live="polite"><span className={saved ? 'save-check' : 'save-warning'}>{saved ? <Check size={11} /> : <Activity size={11} />}</span>{saved ? 'Saved locally' : 'Storage is full — export your work'}</div>
      </main>

      {repoDialogOpen && <RepoDialog onClose={() => setRepoDialogOpen(false)} onImport={importProject} settings={appState.settings} onSettingsChange={updateSettings} githubSession={githubSession} onGithubSessionChange={updateGithubSession} />}
      {settingsOpen && <SettingsDialog settings={appState.settings} backendOnline={serviceReady} onChange={updateSettings} onClose={() => setSettingsOpen(false)} />}
      {pushDialogOpen && project.githubRemote && githubSession && <PushDialog project={project} sessionId={githubSession.sessionId} onClose={() => setPushDialogOpen(false)} onPushed={handlePushComplete} />}
      {toast && <div className="toast-message"><Sparkles size={14} />{toast}</div>}
    </div>
  );
}
