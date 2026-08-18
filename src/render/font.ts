/**
 * The 3×5 bitmap font — spec/04-ui.md §4, transcribed glyph for glyph.
 *
 * Capitals, digits and five punctuation marks; 1 px between glyphs; integer scales only. The
 * glyph table is data, so the e2e can ask which pixels tell `F1` from `F2` rather than
 * hard-coding a screenshot of them.
 */

export const GLYPH_W = 3;
export const GLYPH_H = 5;
/** 04-ui §4: "1 px letter spacing; space character = 3 px advance". */
export const LETTER_SPACING = 1;
export const SPACE_ADVANCE = 3;

/** Rows top to bottom, `#` = a lit pixel. */
const GLYPHS: Readonly<Record<string, readonly [string, string, string, string, string]>> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['###', '#..', '#.#', '#.#', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['###', '#.#', '###', '#..', '#..'],
  Q: ['###', '#.#', '#.#', '###', '..#'],
  R: ['###', '#.#', '##.', '#.#', '#.#'],
  S: ['###', '#..', '###', '..#', '###'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '#.#', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '.': ['...', '...', '...', '...', '.#.'],
  ':': ['...', '.#.', '...', '.#.', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '-': ['...', '...', '###', '...', '...'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
};

export const GLYPH_CHARS: readonly string[] = Object.keys(GLYPHS);

/** The 5 rows of a glyph. Unknown characters are a hard error, not a silent blank. */
export function glyphRows(ch: string): readonly string[] {
  const rows = GLYPHS[ch];
  if (!rows) throw new Error(`font: no glyph for "${ch}" (04-ui §4 is capitals and digits)`);
  return rows;
}

export const hasGlyph = (ch: string): boolean => ch in GLYPHS;

/** How far the pen moves past a character, spacing included. */
export function advance(ch: string): number {
  return ch === ' ' ? SPACE_ADVANCE : GLYPH_W + LETTER_SPACING;
}

/** Width of a line in logical pixels: the pen's travel, less the trailing letter spacing. */
export function textWidth(text: string, scale = 1): number {
  if (text.length === 0) return 0;
  let width = 0;
  for (const ch of text) width += advance(ch);
  if (!text.endsWith(' ')) width -= LETTER_SPACING;
  return width * scale;
}

/** Left edge that centres `text` in a `width`-wide area (04-ui §3 centres everything). */
export function centredX(text: string, width: number, scale = 1): number {
  return Math.floor((width - textWidth(text, scale)) / 2);
}

/** Draw a line of text with its top-left at (x, y). Pixels are `scale × scale` blocks. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  colour: string,
  scale = 1,
): void {
  ctx.fillStyle = colour;
  let pen = x;
  for (const ch of text) {
    if (ch !== ' ') {
      const rows = glyphRows(ch);
      for (let row = 0; row < GLYPH_H; row++) {
        const line = rows[row]!;
        for (let col = 0; col < GLYPH_W; col++) {
          if (line[col] !== '#') continue;
          ctx.fillRect(pen + col * scale, y + row * scale, scale, scale);
        }
      }
    }
    pen += advance(ch) * scale;
  }
}
