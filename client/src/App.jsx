import { useMemo, useState } from 'react';
import { useLiveSession } from './hooks/useLiveSession.js';
import { VOICES } from './lib/geminiLive.js';

const DEFAULT_PROMPT =
  'Eres un asistente de voz amable, carismático y servicial. Responde siempre en el idioma en el que te hablen. Sé conciso y natural, como en una conversación real.';

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787/ws`;

const STATUS_LABELS = {
  idle: 'Desconectado',
  connecting: 'Conectando…',
  connected: 'Conectado',
  ready: 'Conectado · listo',
  disconnected: 'Desconectado',
};

export default function App() {
  const [voice, setVoice] = useState(VOICES[0]);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const [textInput, setTextInput] = useState('');

  const session = useLiveSession({ wsUrl: WS_URL, systemInstruction: systemPrompt, voice });

  const isConnected = session.status === 'ready' || session.status === 'connected';
  const canTalk = session.status === 'ready';
  const canInterrupt = isConnected && session.isMicOn === false && session.isModelSpeaking;

  const onMicClick = () => {
    console.log('[ui] mic toggle clicked, canTalk=', canTalk, 'status=', session.status, 'isMicOn=', session.isMicOn);
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

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <span className="logo-badge">◆</span>
          <div>
            <h1>Voice Bot</h1>
            <p>Gemini 3.1 Flash Live</p>
          </div>
        </div>
        <div className={`status-pill ${isConnected ? 'on' : ''}`}>
          <span className="status-dot" />
          {STATUS_LABELS[session.status] || session.status}
        </div>
      </header>

      {session.error && <div className="error-banner">{session.error}</div>}

      <main className="main">
        <section className="card voice-card">
          <div className="mic-wrap">
            <button
              className={`mic-btn ${session.isMicOn ? 'talking' : ''} ${canTalk ? 'enabled' : ''}`}
              onClick={onMicClick}
              onContextMenu={(e) => e.preventDefault()}
              disabled={!canTalk}
              aria-label={session.isMicOn ? 'Silenciar micrófono' : 'Reactivar micrófono'}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="mic-icon">
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
                <path d="M19 11a7 7 0 0 1-14 0H3a9 9 0 0 0 8 8.94V22h2v-2.06A9 9 0 0 0 21 11h-2z" />
              </svg>
            </button>
            <p className="mic-hint">
              {!canTalk
                ? 'Conecta la sesión para empezar'
                : session.isMicOn
                  ? 'Escuchando… habla con normalidad'
                  : 'Silenciado… toca para reactivar'}
            </p>
          </div>

          <div className="controls">
            {isConnected ? (
              <button className="btn danger" onClick={session.disconnect}>
                Desconectar
              </button>
            ) : (
              <button className="btn primary" onClick={session.connect} disabled={session.status === 'connecting'}>
                {session.status === 'connecting' ? 'Conectando…' : 'Conectar'}
              </button>
            )}

            {canInterrupt && (
              <button className="btn ghost" onClick={onInterrupt}>
                Interrumpir
              </button>
            )}

            {isConnected && (
              <button className="btn ghost" onClick={session.testAudio}>
                Probar audio
              </button>
            )}

            <label className="field">
              <span>Voz</span>
              <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                {VOICES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="card chat-card">
          <div className="chat-head">
            <h2>Transcripción</h2>
            {session.isModelSpeaking && <span className="speaking-badge">hablando…</span>}
          </div>

          <div className="transcript">
            {transcriptList.length === 0 ? (
              <p className="empty">Aún no hay mensajes. Conecta y empieza a hablar: escucharás la respuesta en vivo.</p>
            ) : (
              transcriptList.map((m) => (
                <div key={m.id} className={`msg ${m.role}`}>
                  <span className="msg-role">{m.role === 'user' ? 'Tú' : 'Bot'}</span>
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
              placeholder="O escribe un mensaje de texto…"
              disabled={!canTalk}
            />
            <button className="btn primary" type="submit" disabled={!canTalk || !textInput.trim()}>
              Enviar
            </button>
          </form>
        </section>

        <section className="card prompt-card">
          <label className="field">
            <span>Instrucciones del sistema</span>
            <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={4} />
          </label>
          <p className="note">
            Aplica a la próxima sesión. Genera tu API key en aistudio.google.com/app/apikey y guárdala en server/.env.
          </p>
        </section>
      </main>
    </div>
  );
}
