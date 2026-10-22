// Sedi — microphone tap: hands raw audio frames to the page in ~1024-sample batches.
// A real file (not a blob: URL) so a strict Content-Security-Policy can allow it.
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) { this.buf.push(ch.slice(0)); this.n += ch.length; if (this.n >= 1024) { this.port.postMessage(this.buf); this.buf = []; this.n = 0; } }
    return true;
  }
}
registerProcessor('sedi-tap', Tap);
