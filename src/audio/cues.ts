/**
 * The sound of the game — spec/04-ui.md §5's cue table, transcribed as data.
 *
 * No audio assets exist for this project; every cue is synthesized from a waveform, a
 * frequency (or a sweep between two), and a duration. This module turns a cue name into the
 * exact notes to play and knows nothing about WebAudio, so the table can be checked against
 * the spec in a unit test rather than by ear.
 *
 * The 18 cues cover 19 triggers: `crate` sounds both for a crate the sword finished and for
 * one a pit swallowed.
 */

import type { EventName } from '../game/events.js';

export type Voice = 'square' | 'sawtooth' | 'triangle' | 'noise';

export interface Note {
  voice: Voice;
  /** Start and end frequency in Hz; equal for a steady tone, ignored for noise. */
  from: number;
  to: number;
  /** Milliseconds after the cue begins. */
  start: number;
  ms: number;
}

/**
 * Cues are named after the events that raise them. Two events are visual only: `torch_reset`
 * (a puff, 02 §4.3) and `unshackle` (chains falling off a door the `door` or `seal` cue has
 * already spoken for, 01 §8.3).
 */
export type CueName = Exclude<EventName, 'torch_reset' | 'unshackle'>;

const tone = (voice: Voice, hz: number, ms: number, start = 0): Note => ({
  voice,
  from: hz,
  to: hz,
  start,
  ms,
});

const sweep = (voice: Voice, from: number, to: number, ms: number, start = 0): Note => ({
  voice,
  from,
  to,
  start,
  ms,
});

/** 04-ui §5: "arp" = an equal-length note sequence filling the stated total. */
const arp = (voice: Voice, notes: number[], total: number): Note[] => {
  const each = total / notes.length;
  return notes.map((hz, index) => tone(voice, hz, each, index * each));
};

/** 04-ui §5's table, row for row. */
const CUES: Readonly<Record<CueName, readonly Note[]>> = {
  sword: [sweep('square', 180, 90, 70)],
  hit: [tone('square', 110, 60), tone('noise', 0, 40)],
  hurt: [sweep('sawtooth', 140, 70, 150)],
  coin: [tone('square', 880, 40), tone('square', 1320, 60, 40)],
  key: arp('triangle', [660, 880, 1100], 150),
  flask: [sweep('triangle', 520, 780, 120)],
  door: [tone('square', 220, 100), tone('square', 110, 100, 100)],
  locked: [tone('square', 98, 80)],
  chest: arp('triangle', [523, 659, 784], 200),
  crate: [tone('noise', 0, 80)],
  push: [tone('triangle', 90, 100)],
  torch: [tone('triangle', 700, 60)],
  seal: [tone('square', 98, 200)],
  wave: [tone('triangle', 440, 80)],
  enemy_die: [sweep('square', 260, 65, 180)],
  death: [sweep('sawtooth', 220, 55, 500)],
  descend: [sweep('triangle', 330, 165, 300)],
  victory: arp('square', [523, 659, 784, 1046], 500),
};

export const CUE_NAMES = Object.keys(CUES) as CueName[];

/** The notes a cue plays, or `null` for an event that makes no sound. */
export function notesFor(event: EventName): readonly Note[] | null {
  return event === 'torch_reset' || event === 'unshackle' ? null : CUES[event];
}

/** How long a cue lasts, end to end. */
export function cueLength(cue: CueName): number {
  return Math.max(...CUES[cue].map((note) => note.start + note.ms));
}

/** 04-ui §5: one master gain, and a 5 ms attack before the release fills the rest. */
export const MASTER_GAIN = 0.2;
export const ATTACK_MS = 5;
/** Where the mute flag is kept — a preference, not sim state (04-ui §5). */
export const MUTE_KEY = 'undervault.muted';
