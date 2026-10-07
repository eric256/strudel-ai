// 🔀 Routing audio: a Web Audio block for each node of the routing graph (lib/routing.js). Every block has an input,
// an output, an analyser on its output (for the panel's little scope), set(params) and off (bypass: the sound goes
// straight through). features/routing.js wires the blocks together between the mixer's channels and the master.

import { EQ_BANDS } from './lib/eq.js';

const dbToGain = (db) => Math.pow(10, db / 20);
const glide = (param, v, t) => param.setTargetAtTime(v, t, 0.02);

// a soft-clip curve (tanh), shared
let satCurve = null;
function curve() {
  if (satCurve) return satCurve;
  const n = 2048;
  satCurve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; satCurve[i] = Math.tanh(x * 3) / Math.tanh(3); }
  return satCurve;
}
// a reverb tail: stereo noise with an exponential decay of `size` seconds
function impulse(ac, size) {
  const len = Math.max(1, Math.round(ac.sampleRate * size));
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return buf;
}

// 🦆 Duck: an envelope follower (an AudioWorklet, loaded once per AudioContext) that listens to the key and turns its
// level into gain reduction: it outputs -amount·min(1, env·sens), added to a gain of 1.
const DUCK_WORKLET = `
class DuckEnv extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'amount', defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 0.005, minValue: 0.0005, maxValue: 1, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.18, minValue: 0.005, maxValue: 5, automationRate: 'k-rate' },
      { name: 'sens', defaultValue: 3, minValue: 0, maxValue: 100, automationRate: 'k-rate' }];
  }
  constructor() { super(); this.env = 0; }
  process(inputs, outputs, p) {
    const ins = inputs[0] || [], out = outputs[0][0];
    const a = Math.exp(-1 / (sampleRate * p.attack[0])), r = Math.exp(-1 / (sampleRate * p.release[0]));
    const amount = p.amount[0], sens = p.sens[0];
    let env = this.env;
    for (let i = 0; i < out.length; i++) {
      let x = 0;
      for (let c = 0; c < ins.length; c++) { const v = Math.abs(ins[c][i]); if (v > x) x = v; }
      const k = x > env ? a : r;
      env = x + (env - x) * k;
      out[i] = -amount * Math.min(1, env * sens);
    }
    this.env = env;
    return true;
  }
}
registerProcessor('strudel-ai-duck', DuckEnv);
`;
const duckModules = new WeakMap();
function duckModule(ac) {
  if (!ac.audioWorklet) return Promise.reject(new Error('no AudioWorklet'));
  if (!duckModules.has(ac)) {
    const url = URL.createObjectURL(new Blob([DUCK_WORKLET], { type: 'text/javascript' }));
    duckModules.set(ac, ac.audioWorklet.addModule(url));
  }
  return duckModules.get(ac);
}

/** One node's audio block. node: { type, params, off } */
export function createBlock(ac, node) {
  const input = new GainNode(ac), output = new GainNode(ac);
  // the effect ends in `wet`, which passes a gate to the output; ⏻ off closes the gate and opens `through` (dry)
  const wet = new GainNode(ac), gate = new GainNode(ac), through = new GainNode(ac, { gain: 0 });
  const analyser = new AnalyserNode(ac, { fftSize: 512, smoothingTimeConstant: 0.5 });
  input.connect(through).connect(output);
  wet.connect(gate).connect(output);
  output.connect(analyser);
  const own = [input, output, wet, gate, through, analyser];
  const mk = (n) => { own.push(n); return n; };
  let set = () => {}, live = () => ({}), key = null, ready = Promise.resolve();

  // effects with a dry / wet mix: input → dry → wet-out, input → fx → mixWet → wet-out
  const mixed = (fxIn, fxOut) => {
    const dry = mk(new GainNode(ac)), wetMix = mk(new GainNode(ac));
    input.connect(dry).connect(wet);
    input.connect(fxIn);
    fxOut.connect(wetMix).connect(wet);
    return (mix, t) => { glide(dry.gain, Math.cos(mix * Math.PI / 2), t); glide(wetMix.gain, Math.sin(mix * Math.PI / 2), t); };
  };

  switch (node.type) {
    case 'gain': {
      input.connect(wet);
      set = (p, t) => glide(wet.gain, dbToGain(p.db), t);
      break;
    }
    case 'comp': {
      const c = mk(new DynamicsCompressorNode(ac, { knee: 6 })), mu = mk(new GainNode(ac));
      input.connect(c).connect(mu).connect(wet);
      set = (p, t) => { glide(c.threshold, p.thresh, t); glide(c.ratio, p.ratio, t); c.attack.setValueAtTime(p.attack / 1000, t); c.release.setValueAtTime(p.release / 1000, t); glide(mu.gain, dbToGain(p.makeup), t); };
      live = () => ({ gr: c.reduction });
      break;
    }
    case 'sat': {
      const pre = mk(new GainNode(ac)), ws = mk(new WaveShaperNode(ac, { curve: curve(), oversample: '4x' })), post = mk(new GainNode(ac));
      pre.connect(ws).connect(post);
      const mix = mixed(pre, post);
      set = (p, t) => { const d = dbToGain(p.drive); glide(pre.gain, d * 0.35, t); glide(post.gain, 1 / Math.max(1, Math.sqrt(d * 0.35) * 1.1), t); mix(p.mix, t); };
      break;
    }
    case 'eq': {
      const lo = mk(new BiquadFilterNode(ac, { type: 'lowshelf', frequency: 200 })), mid = mk(new BiquadFilterNode(ac, { type: 'peaking', frequency: 1000, Q: 0.8 })), hi = mk(new BiquadFilterNode(ac, { type: 'highshelf', frequency: 4000 }));
      input.connect(lo).connect(mid).connect(hi).connect(wet);
      set = (p, t) => { glide(lo.gain, p.low, t); glide(mid.gain, p.mid, t); glide(hi.gain, p.high, t); };
      break;
    }
    case 'geq': {
      const bands = EQ_BANDS.map((b) => mk(new BiquadFilterNode(ac, { type: b.type, frequency: b.f, Q: b.q || 0.7, gain: 0 })));
      bands.reduce((a, b) => a.connect(b), input).connect(wet);
      set = (p, t) => bands.forEach((b, i) => glide(b.gain, p[`b${i}`] || 0, t));
      break;
    }
    case 'filter': {
      const hp = mk(new BiquadFilterNode(ac, { type: 'highpass', Q: 0.7 })), lp = mk(new BiquadFilterNode(ac, { type: 'lowpass', Q: 0.7 }));
      input.connect(hp).connect(lp).connect(wet);
      set = (p, t) => { glide(hp.frequency, p.hp, t); glide(lp.frequency, Math.min(p.lp, ac.sampleRate / 2 - 100), t); };
      break;
    }
    case 'verb': {
      const conv = mk(new ConvolverNode(ac)), pre = mk(new BiquadFilterNode(ac, { type: 'highpass', frequency: 150 }));
      pre.connect(conv);
      const mix = mixed(pre, conv);
      let size = null, timer = 0;
      set = (p, t) => {
        mix(p.mix, t);
        if (p.size !== size) { size = p.size; clearTimeout(timer); timer = setTimeout(() => { conv.buffer = impulse(ac, size); }, conv.buffer ? 150 : 0); }
      };
      break;
    }
    case 'delay': {
      const d = mk(new DelayNode(ac, { maxDelayTime: 2 })), fb = mk(new GainNode(ac)), tone = mk(new BiquadFilterNode(ac, { type: 'lowpass', frequency: 4500 }));
      d.connect(tone).connect(fb).connect(d);
      const mix = mixed(d, tone);
      set = (p, t) => { glide(d.delayTime, p.time, t); glide(fb.gain, p.feedback, t); mix(p.mix, t); };
      break;
    }
    case 'duck': {
      // the sound through a gain the key pulls down; the key comes in on the block's `key` input (port 2)
      const g = mk(new GainNode(ac)), probe = mk(new AnalyserNode(ac, { fftSize: 256 }));
      key = mk(new GainNode(ac));
      input.connect(g).connect(wet);
      let env = null, last = null;
      const apply = (p, t) => {
        last = p;
        if (!env) return;
        const at = (name, v) => env.parameters.get(name).setValueAtTime(v, t);
        at('amount', 1 - dbToGain(p.depth)); at('attack', p.attack / 1000); at('release', p.release / 1000); at('sens', p.sens);
      };
      ready = duckModule(ac).then(() => {
        env = mk(new AudioWorkletNode(ac, 'strudel-ai-duck', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }));
        key.connect(env);
        env.connect(g.gain);
        env.connect(probe);
        if (last) apply(last, ac.currentTime);
      }).catch(() => {}); // no worklet: the sound passes as it is
      set = apply;
      const buf = new Float32Array(probe.fftSize);
      live = () => {
        if (!env) return {};
        probe.getFloatTimeDomainData(buf);
        const gain = Math.max(1e-4, 1 + buf[buf.length - 1]);
        return { duck: Math.round(20 * Math.log10(gain) * 10) / 10 };
      };
      break;
    }
    default: // split, sum: the sound as it is
      input.connect(wet);
  }

  const block = {
    input, output, analyser, type: node.type, live, key, ready,
    set(params, off) {
      const t = ac.currentTime;
      set(params, t);
      glide(through.gain, off ? 1 : 0, t);
      glide(gate.gain, off ? 0 : 1, t);
    },
    dispose() { for (const n of own) { try { n.disconnect(); } catch {} } },
  };
  block.set(node.params, node.off);
  return block;
}
