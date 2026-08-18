/**
 * The WebAudio side of 04-ui §5: play the notes `cues.ts` describes.
 *
 * Everything is generated — the project ships no audio files. One master gain at 0.2 feeds
 * an oscillator per note (or a burst of noise), each with the 5 ms attack and linear release
 * the spec asks for.
 *
 * Two rules the browser imposes and the tests rely on: nothing is created until the player
 * has pressed a key (an AudioContext built before a gesture is suspended and complains about
 * it in the console), and a muted run never builds one at all.
 */

import type { EventName } from '../game/events.js';
import { ATTACK_MS, MASTER_GAIN, MUTE_KEY, notesFor, type Note } from './cues.js';

/**
 * A fixed noise table. `Math.random` would do, but a deterministic buffer means two runs of
 * the game sound identical, which is the same property everything else here has.
 */
function noiseBuffer(context: AudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate / 4); // a quarter second is longer than any burst
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);

  let seed = 0x2545f491;
  for (let i = 0; i < length; i++) {
    // xorshift32, scaled to [-1, 1)
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    data[i] = (seed >>> 0) / 0x80000000 - 1;
  }
  return buffer;
}

export class Audio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private mutedFlag: boolean;

  constructor(private readonly storage: Storage | null = safeStorage()) {
    this.mutedFlag = this.storage?.getItem(MUTE_KEY) === '1';
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  /** `M` (04-ui §5). Returns the new state, and remembers it across runs. */
  toggleMute(): boolean {
    this.mutedFlag = !this.mutedFlag;
    this.storage?.setItem(MUTE_KEY, this.mutedFlag ? '1' : '0');
    if (this.master) this.master.gain.value = this.mutedFlag ? 0 : MASTER_GAIN;
    return this.mutedFlag;
  }

  /** Called on the first key press: browsers refuse to start audio before a gesture. */
  resume(): void {
    if (this.mutedFlag || this.context) return;

    const Context = window.AudioContext;
    if (!Context) return; // no WebAudio here; the game is meant to be playable silent

    this.context = new Context();
    this.master = this.context.createGain();
    this.master.gain.value = MASTER_GAIN;
    this.master.connect(this.context.destination);
    this.noise = noiseBuffer(this.context);
  }

  /** Sound one cue now. Events with no cue, and a muted or unstarted run, are silent. */
  play(event: EventName): void {
    const notes = notesFor(event);
    if (!notes || this.mutedFlag || !this.context || !this.master) return;

    const now = this.context.currentTime;
    for (const note of notes) this.schedule(note, now + note.start / 1000);
  }

  playAll(events: readonly { name: EventName }[]): void {
    for (const event of events) this.play(event.name);
  }

  private schedule(note: Note, at: number): void {
    const context = this.context!;
    const seconds = note.ms / 1000;
    const attack = Math.min(ATTACK_MS / 1000, seconds / 2);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(1, at + attack);
    gain.gain.linearRampToValueAtTime(0, at + seconds);
    gain.connect(this.master!);

    const source =
      note.voice === 'noise' ? this.noiseSource(context) : this.oscillator(context, note, at);
    source.connect(gain);
    source.start(at);
    source.stop(at + seconds);
    source.onended = (): void => {
      source.disconnect();
      gain.disconnect();
    };
  }

  private oscillator(context: AudioContext, note: Note, at: number): OscillatorNode {
    const osc = context.createOscillator();
    osc.type = note.voice as OscillatorType;
    osc.frequency.setValueAtTime(note.from, at);
    if (note.to !== note.from) {
      osc.frequency.linearRampToValueAtTime(note.to, at + note.ms / 1000);
    }
    return osc;
  }

  private noiseSource(context: AudioContext): AudioBufferSourceNode {
    const source = context.createBufferSource();
    source.buffer = this.noise;
    return source;
  }
}

/** Private-mode browsers throw on `localStorage`; a run without it is simply not remembered. */
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
