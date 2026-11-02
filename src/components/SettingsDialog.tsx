import { Code2, Eye, FileSearch, LockKeyhole, X } from 'lucide-react';
import type { AgentMode, UserSettings } from '../types';

const MODES: Array<{ id: AgentMode; title: string; detail: string; Icon: typeof Code2 }> = [
  { id: 'build', title: 'Build', detail: 'Plan and shape a code change.', Icon: Code2 },
  { id: 'explain', title: 'Explain', detail: 'Break down code and concepts.', Icon: Eye },
  { id: 'review', title: 'Review', detail: 'Look for bugs, risks, and polish.', Icon: FileSearch },
];

export default function SettingsDialog({ settings, backendOnline, onChange, onClose }: { settings: UserSettings; backendOnline: boolean; onChange: (next: UserSettings) => void; onClose: () => void }) {
  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="dialog-header"><div><span className="dialog-kicker">PERSONALIZE</span><h2 id="settings-title">Agent settings</h2><p>Choose how Codepilot approaches the next request.</p></div><button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button></header>
        <div className="settings-section"><label className="field-label">DEFAULT MODE</label><div className="mode-choice-grid">{MODES.map(({ id, title, detail, Icon }) => <button key={id} className={`mode-choice${settings.agentMode === id ? ' selected' : ''}`} onClick={() => onChange({ ...settings, agentMode: id })}><span className="mode-choice-icon"><Icon size={17} /></span><span><b>{title}</b><small>{detail}</small></span><span className="radio-dot" /></button>)}</div></div>
        <div className="settings-section response-setting"><div><label className="field-label">RESPONSE DETAIL</label><p>Keep answers balanced, or ask for more explanation.</p></div><select value={settings.responseStyle} onChange={(event) => onChange({ ...settings, responseStyle: event.target.value as UserSettings['responseStyle'] })}><option value="balanced">Balanced</option><option value="detailed">More detail</option></select></div>
        <div className="settings-service"><div className="service-icon"><Code2 size={17} /></div><div><b>Manus-managed AI</b><span>No provider API key needed. Workspace text is sent with each prompt.</span></div><span className={`service-live${backendOnline ? '' : ' offline'}`}><i />{backendOnline ? 'BACKEND ONLINE' : 'BACKEND CHECK'}</span></div>
        <div className="settings-service"><div className="service-icon local"><LockKeyhole size={16} /></div><div><b>Local-first storage</b><span>Projects and chat history are saved in this browser.</span></div><span className="service-live local-state">LOCAL</span></div>
        <footer className="dialog-footer"><span><LockKeyhole size={13} />Credentials stay server-side.</span><button className="button-primary" onClick={onClose}>Done</button></footer>
      </section>
    </div>
  );
}
