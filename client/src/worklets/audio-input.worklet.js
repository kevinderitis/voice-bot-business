class AudioInputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.ratio = this.targetRate / sampleRate;
    this.buffer = new Float32Array(0);
    this.port.onmessage = (e) => {
      if (e.data === 'reset') {
        this.buffer = new Float32Array(0);
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || input[0].length === 0) return true;
    const channel = input[0];

    const tmp = new Float32Array(this.buffer.length + channel.length);
    tmp.set(this.buffer);
    tmp.set(channel, this.buffer.length);
    this.buffer = tmp;

    const outLen = Math.floor(this.buffer.length * this.ratio);
    if (outLen > 0) {
      const out = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const pos = i / this.ratio;
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const s0 = this.buffer[i0];
        const s1 = this.buffer[i0 + 1];
        out[i] = s0 + (s1 - s0) * frac;
      }
      const consumed = Math.floor(outLen / this.ratio);
      this.buffer = this.buffer.slice(consumed);

      const pcm16 = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const s = Math.max(-1, Math.min(1, out[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
    return true;
  }
}

registerProcessor('audio-input-processor', AudioInputProcessor);
