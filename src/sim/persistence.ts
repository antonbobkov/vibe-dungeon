/**
 * Persistent floor state — 01-mechanics §9.
 *
 * Everything a room "remembers" is one flag id in this set. Room state itself is never
 * mutated in place: it is rebuilt from `(level data, these flags)` on every entry, so §9's
 * reset list needs no code at all — anything not flagged simply comes back — and its
 * persist list is exactly the flags below.
 *
 * Ids are stable strings so they can be hashed, sorted, into the state hash (05 §4).
 */

export class Persistence {
  private readonly flags = new Set<string>();

  has(id: string): boolean {
    return this.flags.has(id);
  }

  set(id: string): void {
    this.flags.add(id);
  }

  /** Sorted, as 05 §4 requires before hashing. */
  sorted(): string[] {
    return [...this.flags].sort();
  }
}

const cell = (col: number, row: number): string => `${col},${row}`;

/** A door that has been opened or unlocked stays that way (01 §9). */
export const doorFlag = (floorId: string, doorId: string): string => `${floorId}/${doorId}/open`;

/** A collected pickup never respawns (01 §7, §9). */
export const pickupFlag = (floorId: string, roomId: string, col: number, row: number): string =>
  `${floorId}/${roomId}/pickup/${cell(col, row)}`;

/** An opened chest or a destroyed crate (01 §9); set by M4, consulted by the room rebuild. */
export const propFlag = (floorId: string, roomId: string, col: number, row: number): string =>
  `${floorId}/${roomId}/prop/${cell(col, row)}`;

/** A pit bridged by a consumed crate stays bridged (02 §4.2). */
export const pitFlag = (floorId: string, roomId: string, col: number, row: number): string =>
  `${floorId}/${roomId}/pit/${cell(col, row)}`;

/** A lit puzzle torch (02 §4.3). */
export const torchFlag = (floorId: string, roomId: string, col: number, row: number): string =>
  `${floorId}/${roomId}/torch/${cell(col, row)}`;

/** A combat_seal room that has been cleared never respawns its enemies (01 §8.3, §9). */
export const clearedFlag = (floorId: string, roomId: string): string =>
  `${floorId}/${roomId}/cleared`;

/** A wiring entry fires at most once (03 §1.6). */
export const wireFlag = (floorId: string, index: number): string => `${floorId}/wire/${index}`;
