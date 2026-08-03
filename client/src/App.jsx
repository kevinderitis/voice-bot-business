import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveSession } from './hooks/useLiveSession.js';
import { VOICES } from './lib/geminiLive.js';

const DEFAULT_PROMPT =
  'You are a friendly, charismatic, and helpful voice assistant. Always reply in the language you are spoken to. Be concise and natural, like a real conversation.';

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

const STATUS_LABELS = {
  idle: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
  ready: 'Ready',
  disconnected: 'Disconnected',
};

const loadSetting = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v != null ? v : fallback;
  } catch {
    return fallback;
  }
};

const saveSetting = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* noop */
  }
};

export default function App() {
  const [voice, setVoice] = useState(() => loadSetting('voice', VOICES[0].id));
  const [systemPrompt, setSystemPrompt] = useState(() => loadSetting('systemPrompt', DEFAULT_PROMPT));
  const [textInput, setTextInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    saveSetting('voice', voice);
  }, [voice]);

  useEffect(() => {
    saveSetting('systemPrompt', systemPrompt);
  }, [systemPrompt]);

  const session = useLiveSession({ wsUrl: WS_URL, systemInstruction: systemPrompt, voice });

  const isConnected = session.status === 'ready' || session.status === 'connected';
  const canTalk = session.status === 'ready';
  const canInterrupt = isConnected && session.isMicOn === false && session.isModelSpeaking;

  const voiceLabel = (id) => VOICES.find((v) => v.id === id)?.label || id;

  const onMicClick = () => {
    if (!canTalk) return;
    if (session.isMicOn) {
      session.stopTalking();
    } else {
      session.startTalking();
    }
  };

  const onInterrupt = () => {
    if (!canInterrupt) return;
    session.startTalking();
    setTimeout(() => session.stopTalking(), 250);
  };

  const onSubmitText = (e) => {
    e.preventDefault();
    const text = textInput.trim();
    if (!text) return;
    session.sendText(text);
    setTextInput('');
  };

  const transcriptList = useMemo(() => session.transcripts, [session.transcripts]);
  const transcriptRef = useRef(null);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcriptList]);

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <span className={`logo-badge ${isConnected ? 'online' : ''}`}>◆</span>
          <div>
            <h1>Voice Bot</h1>
            <p>Live Voice Assistant</p>
          </div>
        </div>
        <div className="header-right">
          {isConnected && (
            <div className="online-pill">
              <span className="online-dot" />
              Online
            </div>
          )}
          <div className={`status-pill ${isConnected ? 'on' : ''}`}>
            <span className="status-dot" />
            {STATUS_LABELS[session.status] || session.status}
          </div>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      {session.error && <div className="error-banner">{session.error}</div>}

      <main className={`main ${isConnected ? 'main-connected' : ''}`}>
        <section className="card voice-card">
          <div className="mic-wrap">
            <button
              className={`mic-btn ${session.isMicOn ? 'talking' : ''} ${canTalk ? 'enabled' : ''}`}
              onClick={onMicClick}
              onContextMenu={(e) => e.preventDefault()}
              disabled={!canTalk}
              aria-label={session.isMicOn ? 'Mute microphone' : 'Unmute microphone'}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="mic-icon">
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
                <path d="M19 11a7 7 0 0 1-14 0H3a9 9 0 0 0 8 8.94V22h2v-2.06A9 9 0 0 0 21 11h-2z" />
              </svg>
            </button>
            <p className="mic-hint">
              {!canTalk
                ? 'Connect the session to start'
                : session.isMicOn
                  ? 'Listening… just talk normally'
                  : 'Muted… tap to unmute'}
            </p>
          </div>

          <div className="controls">
            {isConnected ? (
              <button className="btn danger" onClick={session.disconnect}>
                Hang Up
              </button>
            ) : (
              <button className="btn primary" onClick={session.connect} disabled={session.status === 'connecting'}>
                {session.status === 'connecting' ? 'Connecting…' : 'Connect'}
              </button>
            )}

            {canInterrupt && (
              <button className="btn ghost" onClick={onInterrupt}>
                Interrupt
              </button>
            )}

            {isConnected && (
              <button className="btn ghost" onClick={session.testAudio}>
                Test Audio
              </button>
            )}

            <label className="field">
              <span>Voice</span>
              <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="card chat-card">
          <div className="chat-head">
            <h2>Transcript</h2>
            {session.isModelSpeaking && <span className="speaking-badge">speaking…</span>}
          </div>

          <div className="transcript" ref={transcriptRef}>
            {transcriptList.length === 0 ? (
              <p className="empty">No messages yet. Connect and start talking — you will hear the response live.</p>
            ) : (
              transcriptList.map((m) => (
                <div key={m.id} className={`msg ${m.role}`}>
                  <span className="msg-role">{m.role === 'user' ? 'You' : 'Assistant'}</span>
                  <p>{m.text}</p>
                </div>
              ))
            )}
          </div>

          <form className="text-row" onSubmit={onSubmitText}>
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Or type a message…"
              disabled={!canTalk}
            />
            <button className="btn primary" type="submit" disabled={!canTalk || !textInput.trim()}>
              Send
            </button>
          </form>
        </section>
      </main>

      {isConnected && (
        <div className="mobile-hangup">
          <button className="btn hangup" onClick={session.disconnect}>
            Hang Up
          </button>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Settings</h2>
              <button className="icon-btn" onClick={() => setSettingsOpen(false)} aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>System instructions</span>
                <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={8} />
              </label>
              <p className="note">Applies to the next session. Your API key lives in server/.env.</p>
            </div>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setSettingsOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
