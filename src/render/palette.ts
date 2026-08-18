/**
 * The Pack A palette, by name — ASSET_GUIDE §2.4, plus the `#ffffff` that damage flashes use
 * (04-ui: "All colours are Pack A palette colours plus #ffffff").
 *
 * Every colour the renderer draws comes from here, so a hex literal is never written twice
 * and a palette question always has one answer to check.
 */

export const PALETTE = {
  /** Outline, shadow and everything outside the map (AG §2.3). */
  void: '#25131a',
  floor: '#3d253b',
  floorDetail: '#362030',
  brick: '#6e4a48',
  brickHighlight: '#78514f',
  brickShadow: '#543740',
  brickShadowDeep: '#4c2f49',
  steel: '#adc1cf',
  steelDark: '#90919e',
  wood: '#895a45',
  woodBright: '#bf704d',
  blue: '#62abd4',
  red: '#bc4c51',
  goldDark: '#c09344',
  gold: '#ffd569',
  white: '#ffffff',
} as const;

export type PaletteName = keyof typeof PALETTE;
