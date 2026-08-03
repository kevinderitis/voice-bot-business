import { useCallback, useEffect, useRef, useState } from 'react';
import { GeminiLiveClient } from '../lib/geminiLive.js';

const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`);

export function useLiveSession({ wsUrl, systemInstruction, voice }) {
  const clientRef = useRef(null);
  const modelTurnRef = useRef(null);

  const [status, setStatus] = useState('idle');
  const [isMicOn, setIsMicOn] = useState(false);
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    return () => {
      clientRef.current?.destroy();
      clientRef.current = null;
    };
  }, []);

  const connect = useCallback(async () => {
    const client = new GeminiLiveClient({
      wsUrl,
      systemInstruction,
      voice,
      onEvent: (ev) => {
        switch (ev.type) {
          case 'status':
            setStatus(ev.state);
            break;
          case 'error':
            setError(ev.message);
            break;
          case 'micOn':
            setIsMicOn(true);
            break;
          case 'micOff':
            setIsMicOn(false);
            break;
          case 'userText':
            setTranscripts((t) => [...t, { id: uid(), role: 'user', text: ev.text }]);
            break;
          case 'modelText':
            if (!modelTurnRef.current) {
              modelTurnRef.current = { id: uid(), role: 'model', text: '' };
            }
            modelTurnRef.current.text += ev.text;
            setIsModelSpeaking(true);
            setTranscripts((t) => {
              const next = [...t];
              const idx = next.findIndex((m) => m.id === modelTurnRef.current.id);
              if (idx >= 0) {
                next[idx] = { ...modelTurnRef.current };
              } else {
                next.push({ ...modelTurnRef.current });
              }
              return next;
            });
            break;
          case 'interrupted':
            setIsModelSpeaking(false);
            break;
          case 'turnComplete':
            modelTurnRef.current = null;
            setIsModelSpeaking(false);
            break;
          default:
            break;
        }
      },
    });
    clientRef.current = client;
    setError(null);
    setTranscripts([]);
    try {
      await client.connect();
    } catch (err) {
      setStatus('idle');
      setError(err?.message || 'Could not connect to the voice server.');
    }
  }, [wsUrl, systemInstruction, voice]);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    modelTurnRef.current = null;
    setStatus('idle');
    setIsMicOn(false);
    setIsModelSpeaking(false);
  }, []);

  const startTalking = useCallback(async () => {
    await clientRef.current?.startMic();
  }, []);

  const stopTalking = useCallback(() => {
    clientRef.current?.stopMic();
  }, []);

  const sendText = useCallback(
    (text) => {
      clientRef.current?.sendText(text);
      setTranscripts((t) => [...t, { id: uid(), role: 'user', text }]);
    },
    []
  );

  const testAudio = useCallback(() => {
    clientRef.current?.playTestTone();
  }, []);

  return {
    status,
    isMicOn,
    isModelSpeaking,
    transcripts,
    error,
    connect,
    disconnect,
    startTalking,
    stopTalking,
    sendText,
    testAudio,
  };
}
