class AudioOutputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sourceRate = 24000;
    this.ratio = this.sourceRate / sampleRate;
    this.queue = new Float32Array(0);
    this.offset = 0;
    this.port.onmessage = (e) => {
      const data = e.data;
      if (data.type === 'clear') {
        this.queue = new Float32Array(0);
        this.offset = 0;
        return;
      }
      if (data.audio) {
        const chunk = new Float32Array(data.audio);
        if ((this.msgCount = (this.msgCount || 0) + 1) <= 3) {
          console.log(`[out-worklet] received chunk #${this.msgCount} (${chunk.length} samples)`);
        }
        const tmp = new Float32Array(this.queue.length + chunk.length);
        tmp.set(this.queue);
        tmp.set(chunk, this.queue.length);
        this.queue = tmp;
      }
    };
  }

  process(outputs) {
    this.procCount = (this.procCount || 0) + 1;
    if (this.procCount <= 5) {
      const shapes = outputs.map((o) => o.length).join(',');
      console.log(`[out-worklet] p#${this.procCount} outputs=[${shapes}] queue=${this.queue.length}`);
    }
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const n = output[0].length;

    const srcEnd = this.offset + n * this.ratio;
    const need = Math.ceil(srcEnd) + 1;

    if (this.queue.length < need) {
      for (let c = 0; c < output.length; c++) output[c].fill(0);
      return true;
    }

    for (let c = 0; c < output.length; c++) {
      const channel = output[c];
      for (let i = 0; i < n; i++) {
        const pos = this.offset + i * this.ratio;
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const s0 = this.queue[i0];
        const s1 = this.queue[i0 + 1];
        channel[i] = s0 + (s1 - s0) * frac;
      }
    }

    this.rendered = (this.rendered || 0) + 1;
    if (this.rendered <= 15 || this.rendered % 100 === 0) {
      let peak = 0;
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(output[0][i]));
      console.log(`[out-worklet] RENDER #${this.rendered} peak=${peak.toFixed(4)} queue=${this.queue.length}`);
    }

    const consumed = Math.floor(srcEnd);
    this.queue = this.queue.slice(consumed);
    this.offset = srcEnd - consumed;
    return true;
  }
}

registerProcessor('audio-output-processor', AudioOutputProcessor);
