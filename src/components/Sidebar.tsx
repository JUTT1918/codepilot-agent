import { FilePlus2, FolderGit2, History, MessageSquarePlus, PanelLeftClose, Plus, Settings2, X } from 'lucide-react';
import type { ChatThread, Project } from '../types';
import Brand from './Brand';

type Props = {
  projects: Project[];
  project: Project;
  activeThreadId: string;
  open: boolean;
  onClose: () => void;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  onNewThread: () => void;
  onSelectThread: (id: string) => void;
  onConnect: () => void;
  onSettings: () => void;
};

function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const days = Math.floor((Date.now() - date.valueOf()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Sidebar({ projects, project, activeThreadId, open, onClose, onSelectProject, onNewProject, onNewThread, onSelectThread, onConnect, onSettings }: Props) {
  const threads = [...project.threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <>
      {open && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={onClose} />}
      <aside className={`sidebar${open ? ' sidebar-open' : ''}`}>
        <div className="sidebar-topline">
          <Brand />
          <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={onClose}><X size={17} /></button>
          <span className="sidebar-build-label">BETA</span>
        </div>

        <div className="project-select-wrap">
          <span className="eyebrow-label">WORKSPACE</span>
          <div className="project-select-row">
            <span className="project-dot" />
            <select aria-label="Choose workspace" value={project.id} onChange={(event) => onSelectProject(event.target.value)}>
              {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button className="icon-button tiny" aria-label="Create workspace" onClick={onNewProject}><Plus size={15} /></button>
          </div>
        </div>

        <div className="sidebar-actions">
          <button className="sidebar-action sidebar-action-primary" onClick={onNewThread}><MessageSquarePlus size={16} /><span>New conversation</span><kbd>⌘ K</kbd></button>
          <button className="sidebar-action" onClick={onNewProject}><FilePlus2 size={16} /><span>New workspace</span></button>
          <button className="sidebar-action" onClick={onConnect}><FolderGit2 size={16} /><span>Connect repository</span></button>
        </div>

        <div className="history-heading"><span><History size={13} /> HISTORY</span><span>{threads.length.toString().padStart(2, '0')}</span></div>
        <nav className="history-list" aria-label="Conversation history">
          {threads.map((thread: ChatThread) => (
            <button key={thread.id} className={`history-item${activeThreadId === thread.id ? ' active' : ''}`} onClick={() => onSelectThread(thread.id)}>
              <span className="history-item-text">{thread.title}</span><span className="history-date">{shortDate(thread.updatedAt)}</span>
            </button>
          ))}
          {!threads.length && <p className="history-empty">Your conversations will appear here.</p>}
        </nav>

        <div className="sidebar-bottom">
          <div className="local-status"><span className="status-led" /><span>Saved in this browser</span></div>
          <button className="sidebar-action settings-link" onClick={onSettings}><Settings2 size={16} /><span>Agent settings</span></button>
          <div className="account-row"><span className="avatar-small">CP</span><span><b>Local workspace</b><small>No account required</small></span><PanelLeftClose className="account-more" size={16} /></div>
        </div>
      </aside>
    </>
  );
}
