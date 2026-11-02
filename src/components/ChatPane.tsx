import { useEffect, useRef, useState } from 'react';
import { ArrowUp, AudioLines, Check, FileText, Mic, Plus, Sparkles, Square, X } from 'lucide-react';
import type { AgentMode, Attachment, ChatMessage } from '../types';
import { filesToAttachments } from '../lib/files';
import { transcribeAudio } from '../lib/api';
import MessageBody from './MessageBody';

type Props = {
  messages: ChatMessage[];
  busy: boolean;
  projectName: string;
  mode: AgentMode;
  onSend: (text: string, attachments: Attachment[]) => Promise<void>;
  onApplyCode: (code: string) => void;
  onOpenSidebar: () => void;
};

const SUGGESTIONS = [
  { title: 'Build a landing page', prompt: 'Create a polished, responsive landing page for a new product. Explain the key files I should edit.' },
  { title: 'Review my code', prompt: 'Review the current workspace files for bugs, accessibility issues, and practical improvements.' },
  { title: 'Explain this project', prompt: 'Explain how the files in this workspace fit together, using beginner-friendly language.' },
];

export default function ChatPane({ messages, busy, projectName, mode, onSend, onApplyCode, onOpenSidebar }: Props) {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [composerError, setComposerError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy]);

  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function addFiles(list?: FileList | null) {
    if (!list?.length) return;
    setComposerError('');
    try {
      const next = await filesToAttachments(list);
      setAttachments((previous) => [...previous, ...next].slice(0, 8));
      const unreadable = next.filter((item) => item.content === undefined).map((item) => item.name);
      if (unreadable.length) setComposerError(`${unreadable.join(', ')} can be attached by name only; use text or source files to share contents.`);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : 'That file could not be attached.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function send(value = draft) {
    if (busy || transcribing || (!value.trim() && attachments.length === 0)) return;
    setComposerError('');
    const currentFiles = attachments;
    const prompt = value.trim() || 'Please review the attached file.';
    try {
      await onSend(prompt, currentFiles);
      setDraft('');
      setAttachments([]);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : 'The message could not be sent.');
    }
  }

  async function startRecording() {
    setComposerError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setComposerError('Microphone recording is not supported in this browser. You can attach a voice note instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
      const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (!blob.size) return;
        setTranscribing(true);
        try {
          const text = await transcribeAudio(blob);
          setDraft((current) => current ? `${current.trim()} ${text}` : text);
          textareaRef.current?.focus();
        } catch (error) {
          setComposerError(error instanceof Error ? error.message : 'Voice transcription failed.');
        } finally {
          setTranscribing(false);
        }
      };
      recorder.start();
      setRecording(true);
    } catch {
      setComposerError('Microphone access was not granted. You can enable it in your browser settings.');
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
    setRecording(false);
  }

  function handleMic() {
    if (recording) stopRecording();
    else void startRecording();
  }

  const isFresh = messages.length <= 1;
  const modeLabel = mode === 'build' ? 'Build mode' : mode === 'explain' ? 'Explain mode' : 'Review mode';

  return (
    <section className="chat-pane">
      <div className="chat-header">
        <button className="icon-button mobile-menu-button" aria-label="Open history" onClick={onOpenSidebar}><span className="menu-lines" /></button>
        <div className="chat-heading"><div className="chat-heading-title"><span className="agent-avatar"><Sparkles size={15} /></span><div><b>Codepilot</b><span>{projectName}</span></div></div><span className="mode-pill"><span />{modeLabel}</span></div>
        <button className="icon-button chat-more" aria-label="More chat options" title="New conversations live in History"><AudioLines size={16} /></button>
      </div>

      <div className="transcript-scroll">
        <div className="transcript-inner">
          {isFresh && <div className="greeting-block"><span className="greeting-kicker"><span className="tiny-green-dot" />YOUR CODING PARTNER</span><h1>Build something<br /><em>worth shipping.</em></h1><p>Describe the change. Keep control of the files.</p><div className="suggestion-grid">{SUGGESTIONS.map((item, index) => <button className="suggestion-card" key={item.title} onClick={() => void send(item.prompt)}><span className="suggestion-number">0{index + 1}</span><b>{item.title}</b><span className="suggestion-arrow">↗</span></button>)}</div></div>}
          {messages.map((message) => <article key={message.id} className={`message-row ${message.role}`}>
            <div className={`message-avatar ${message.role}`}>{message.role === 'assistant' ? <Sparkles size={14} /> : 'Y'}</div>
            <div className="message-content"><div className="message-meta"><b>{message.role === 'assistant' ? 'Codepilot' : 'You'}</b><span>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div><MessageBody content={message.content} onApplyCode={message.role === 'assistant' ? onApplyCode : undefined} />{message.attachments?.length ? <div className="message-attachments">{message.attachments.map((name) => <span key={name}><FileText size={12} />{name}</span>)}</div> : null}</div>
          </article>)}
          {busy && <div className="message-row assistant thinking-row"><div className="message-avatar assistant"><Sparkles size={14} /></div><div className="thinking-card"><span className="typing-dots"><i /><i /><i /></span><span>Working through the code…</span></div></div>}
          <div ref={transcriptEnd} />
        </div>
      </div>

      <div className="composer-area">
        {composerError && <div className="composer-error"><span>{composerError}</span><button aria-label="Dismiss" onClick={() => setComposerError('')}><X size={13} /></button></div>}
        {attachments.length > 0 && <div className="attachment-list">{attachments.map((item, index) => <span className="attachment-chip" key={`${item.name}-${index}`}><FileText size={13} /><span>{item.name}</span><button aria-label={`Remove ${item.name}`} onClick={() => setAttachments((previous) => previous.filter((_, itemIndex) => itemIndex !== index))}><X size={12} /></button></span>)}</div>}
        <div className={`composer${recording ? ' is-recording' : ''}`}>
          <textarea ref={textareaRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} onInput={(event) => { const target = event.currentTarget; target.style.height = 'auto'; target.style.height = `${Math.min(target.scrollHeight, 144)}px`; }} placeholder={transcribing ? 'Transcribing your voice…' : 'Ask Codepilot to build, review, or explain…'} rows={1} disabled={transcribing} aria-label="Message Codepilot" />
          <div className="composer-toolbar"><div className="composer-tools"><button className="composer-tool attach-tool" title="Attach files" aria-label="Attach files" onClick={() => fileInput.current?.click()}><Plus size={16} /><span>Attach</span></button><input ref={fileInput} className="visually-hidden" type="file" multiple onChange={(event) => void addFiles(event.target.files)} /><button className={`composer-tool mic-tool${recording ? ' recording' : ''}`} title={recording ? 'Stop recording' : 'Talk to Codepilot'} aria-label={recording ? 'Stop recording' : 'Talk to Codepilot'} onClick={handleMic} disabled={transcribing || busy}>{recording ? <Square size={13} /> : transcribing ? <span className="spinner" /> : <Mic size={15} />}{recording ? <span>Stop</span> : transcribing ? <span>Listening…</span> : <span>Voice</span>}</button>{recording && <span className="recording-indicator"><i />Recording</span>}</div><button className="send-button" aria-label="Send message" onClick={() => void send()} disabled={busy || transcribing || (!draft.trim() && attachments.length === 0)}>{busy ? <span className="spinner" /> : transcribing ? <AudioLines size={16} /> : <ArrowUp size={17} />}</button></div>
        </div>
        <p className="composer-note"><span><Check size={11} />Workspace code is shared with AI when you send</span><span>Codepilot can make mistakes. Review before using.</span></p>
      </div>
    </section>
  );
}
