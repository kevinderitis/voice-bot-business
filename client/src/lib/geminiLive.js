import { encodePCM16ToBase64, decodeBase64ToPCM16 } from './audioUtils.js';
import inputWorkletSource from '../worklets/audio-input.worklet.js?raw';

const INPUT_WORKLET_URL = URL.createObjectURL(new Blob([inputWorkletSource], { type: 'application/javascript' }));
const INPUT_RATE = 16000;
const DEFAULT_VOICE = 'Kore';
const DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';

const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);

export const VOICES = [
  { id: 'Puck', label: 'Aria' },
  { id: 'Charon', label: 'Liam' },
  { id: 'Kore', label: 'Maya' },
  { id: 'Fenrir', label: 'Diego' },
  { id: 'Aoede', label: 'Iris' },
];

export class GeminiLiveClient {
  constructor({ wsUrl, onEvent, systemInstruction, voice, model }) {
    this.wsUrl = wsUrl;
    this.onEvent = onEvent || (() => {});
    this.systemInstruction =
      systemInstruction ||
      'You are a friendly, helpful voice assistant. Always reply in the language you are spoken to. Be concise and natural, like a real conversation.';
    this.voice = voice || DEFAULT_VOICE;
    this.model = model || DEFAULT_MODEL;

    this.ws = null;
    this.audioContext = null;
    this.micStream = null;
    this.sourceNode = null;
    this.inputNode = null;
    this.outputNode = null;
    this.activeSources = new Set();
    this.playbackCursor = 0;
    this.ready = false;
    this.serverErrorShown = false;
    this.audioChunksSent = 0;
  }

  emit(type, payload = {}) {
    this.onEvent({ type, ...payload });
  }

  async connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    this.ensureAudioContextSync();

    this.emit('status', { state: 'connecting' });

    await new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);
      } catch (err) {
        reject(err);
        return;
      }
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => {
        this.emit('error', { message: 'Could not connect to the voice server. Is it running?' });
        reject(new Error('websocket error'));
      };
    });

    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = async (e) => {
      let raw = e.data;
      if (raw instanceof ArrayBuffer) {
        raw = new TextDecoder().decode(raw);
      } else if (raw instanceof Blob) {
        raw = await raw.text();
      } else if (raw && raw.data) {
        raw = raw.data;
      }
      raw = typeof raw === 'string' ? raw : String(raw);
      this.handleMessage(raw);
    };
    this.ws.onclose = (e) => {
      this.ready = false;
      this.stopMic();
      this.emit('status', { state: 'disconnected' });
      const normalClose = [1000, 1001, 1005].includes(e.code);
      if (e.code && !normalClose && !this.serverErrorShown) {
        this.emit('error', { message: `The connection was closed (code ${e.code}).` });
      }
      this.serverErrorShown = false;
    };

    this.sendSetup();

    try {
      await this.ensureMicStream();
    } catch (err) {
      this.emit('error', { message: 'Could not access the microphone: ' + (err?.message || err) });
    }

    try {
      await this.setupAudio();
    } catch (err) {
      this.emit('error', { message: 'Problem setting up audio: ' + (err?.message || err) });
    }

    await this.startMic();
    console.log('[live] mic auto-started — full duplex listening');
  }

  disconnect() {
    this.ready = false;
    this.stopMic();
    this.clearAudioQueue();
    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
    this.ws = null;
  }

  destroy() {
    this.disconnect();
    if (this._visListener) {
      document.removeEventListener('visibilitychange', this._visListener);
      this._visListener = null;
    }
    try {
      this.audioContext?.close();
    } catch {
      /* noop */
    }
    this.audioContext = null;
    this.inputNode = null;
  }

  ensureAudioContextSync() {
    if (this.audioContext) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AC();
    const ctx = this.audioContext;
    console.log(`[live] AudioContext created (state=${ctx.state}, sampleRate=${ctx.sampleRate})`);
    ctx.onstatechange = () => {
      console.log(`[live] AudioContext state -> ${ctx.state}`);
    };
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (!this._visListener) {
      this._visListener = () => {
        if (!document.hidden && this.audioContext?.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', this._visListener);
    }
  }

  sendSetup() {
    const setup = {
      setup: {
        model: `models/${this.model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } } },
        },
        systemInstruction: { parts: [{ text: this.systemInstruction }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    };
    console.log('[live] sending setup:', JSON.stringify(setup).slice(0, 200));
    this.send(setup);
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendText(text) {
    this.send({ realtimeInput: { text } });
  }

  sendRealtimeInput(base64) {
    this.send({ realtimeInput: { audio: { data: base64, mimeType: `audio/pcm;rate=${INPUT_RATE}` } } });
  }

  async setupAudio() {
    this.ensureAudioContextSync();
    if (this.inputNode) {
      if (this.audioContext.state === 'suspended') await this.audioContext.resume();
      return;
    }

    const ctx = this.audioContext;
    if (!IS_IOS) {
      try {
        await ctx.audioWorklet.addModule(INPUT_WORKLET_URL);
        console.log('[live] input worklet registered');
        this.inputNode = new AudioWorkletNode(ctx, 'audio-input-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
        });
        this.inputNode.port.onmessage = (e) => {
          if (!this.ready) return;
          const base64 = encodePCM16ToBase64(e.data);
          if (this.audioChunksSent++ < 5) console.log(`[live] audio -> ${base64.length} chars`);
          this.sendRealtimeInput(base64);
        };
        this.inputNode.connect(ctx.destination);
        console.log('[live] input capture via AudioWorklet');
        return;
      } catch (err) {
        console.warn('[live] AudioWorklet unavailable, falling back to ScriptProcessor:', err.message);
      }
    } else {
      console.warn('[live] iOS detected — using ScriptProcessor instead of AudioWorklet to avoid Safari crashes');
    }
    this.setupScriptProcessor();
  }

  setupScriptProcessor() {
    const ctx = this.audioContext;
    const node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      if (!this.ready) return;
      const input = e.inputBuffer.getChannelData(0);
      const ratio = INPUT_RATE / ctx.sampleRate;
      const outLen = Math.max(1, Math.floor(input.length * ratio));
      const out = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const pos = i / ratio;
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const s0 = input[i0];
        const s1 = input[i0 + 1] ?? s0;
        out[i] = s0 + (s1 - s0) * frac;
      }
      const pcm16 = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const s = Math.max(-1, Math.min(1, out[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      const base64 = encodePCM16ToBase64(pcm16.buffer);
      if (this.audioChunksSent++ < 5) console.log(`[live] audio -> ${base64.length} chars`);
      this.sendRealtimeInput(base64);
    };
    node.connect(ctx.destination);
    this.inputNode = node;
    console.log('[live] input capture via ScriptProcessor');
  }

  async ensureMicStream() {
    if (this.micStream) return this.micStream;
    console.log('[live] requesting mic permission…');
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    console.log('[live] mic granted');
    this.emit('micOn');
    return this.micStream;
  }

  async startMic() {
    console.log('[live] startMic', {
      hasAudioContext: !!this.audioContext,
      hasInputNode: !!this.inputNode,
      hasSourceNode: !!this.sourceNode,
      ready: this.ready,
    });
    if (!this.audioContext) return;
    if (!this.sourceNode) {
      try {
        const stream = await this.ensureMicStream();
        this.sourceNode = this.audioContext.createMediaStreamSource(stream);
        this.sourceNode.connect(this.inputNode);
        console.log('[live] mic wired to input worklet');
      } catch (err) {
        console.error('[live] startMic error:', err);
        this.emit('error', { message: 'Could not access the microphone: ' + (err?.message || err) });
        return;
      }
    }
    this.clearAudioQueue();
    this.emit('micOn');
  }

  stopMic() {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        /* noop */
      }
      this.sourceNode = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.emit('micOff');
  }

  clearAudioQueue() {
    for (const src of this.activeSources) {
      try {
        src.stop();
      } catch {
        /* noop */
      }
    }
    this.activeSources.clear();
    this.playbackCursor = 0;
  }

  playTestTone() {
    if (!this.audioContext) {
      console.warn('[live] playTestTone: no audio context yet');
      return;
    }
    const rate = 24000;
    const n = Math.floor(rate * 0.5);
    const float = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      float[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / rate);
    }
    console.log(`[live] test tone (${n} samples)`);
    this.playBufferSource(float);
  }

  playBufferSource(float) {
    if (!this.audioContext || float.length === 0) return;
    let buffer;
    try {
      buffer = this.audioContext.createBuffer(1, float.length, 24000);
      buffer.copyToChannel(float, 0);
    } catch (err) {
      console.error('[live] createBuffer failed:', err);
      return;
    }
    const src = this.audioContext.createBufferSource();
    src.buffer = buffer;
    src.connect(this.audioContext.destination);
    const now = this.audioContext.currentTime;
    const t = Math.max(now, this.playbackCursor);
    src.start(t);
    this.playbackCursor = t + buffer.duration;
    this.activeSources.add(src);
    src.onended = () => this.activeSources.delete(src);
  }

  playAudio(base64) {
    const pcm16 = decodeBase64ToPCM16(base64);
    if (this.audioContext && this.audioContext.state !== 'running') {
      console.warn(`[live] AudioContext state=${this.audioContext.state} — resuming`);
      this.audioContext.resume();
    }
    const float = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float[i] = pcm16[i] / 32768;
    }
    if ((this._playedChunks = (this._playedChunks || 0) + 1) <= 3 || this._playedChunks % 50 === 0) {
      console.log(`[live] audio chunk #${this._playedChunks} (${float.length} samples)`);
    }
    this.playBufferSource(float);
  }

  handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      console.error('[live] JSON parse error:', err.message);
      return;
    }

    if (msg.setupComplete) {
      this.ready = true;
      this.emit('status', { state: 'ready' });
      return;
    }

    if (msg.serverContent) {
      const sc = msg.serverContent;

      if (sc.inputTranscription && sc.inputTranscription.text) {
        console.log('[live] 🎤 you:', sc.inputTranscription.text);
        this.emit('userText', { text: sc.inputTranscription.text });
      }

      if (sc.outputTranscription && sc.outputTranscription.text) {
        console.log('[live] 🤖 bot:', sc.outputTranscription.text);
        this.emit('modelText', { text: sc.outputTranscription.text });
      }

      const content = sc.content;
      if (content && content.parts) {
        const role = content.role;
        const partKinds = content.parts.map((p) => (p.text ? 'text' : p.inlineData ? 'audio' : '?')).join(',');
        console.log(`[live] serverContent.content role=${role} parts=[${partKinds}]`);
        for (const part of content.parts) {
          if (part.text) {
            if (role === 'user') this.emit('userText', { text: part.text });
            else if (role === 'model') this.emit('modelText', { text: part.text });
          }
          if (part.inlineData && part.inlineData.data) {
            this.playAudio(part.inlineData.data);
          }
        }
      }

      if (sc.modelTurn && sc.modelTurn.parts) {
        const partKinds = sc.modelTurn.parts.map((p) => (p.text ? 'text' : p.inlineData ? 'audio' : '?')).join(',');
        console.log(`[live] model audio turn (${partKinds})`);
        for (const part of sc.modelTurn.parts) {
          if (part.text) this.emit('modelText', { text: part.text });
          if (part.inlineData && part.inlineData.data) {
            this.playAudio(part.inlineData.data);
          }
        }
      }

      if (sc.interrupted) {
        this.clearAudioQueue();
        this.emit('interrupted');
      }
      if (sc.generationComplete || sc.turnComplete) {
        this.emit('turnComplete');
      }
      return;
    }

    if (msg.error) {
      this.serverErrorShown = true;
      this.emit('error', { message: msg.error.message || 'Error desconocido del servidor', code: msg.error.code });
    }
  }
}
