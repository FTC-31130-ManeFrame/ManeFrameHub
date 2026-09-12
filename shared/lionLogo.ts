// The ManeFrame lion, drawn once and shared by the in-app badge
// (components/TeamLogo.tsx) and the favicon / PWA icon endpoints
// (server/routes/settings.ts). Coordinates are on a 100x100 canvas, painted in
// order. Keeping one source here is what stops the tab icon from silently
// drifting away from the badge the next time the logo is tweaked.
//
// Curves are deliberately avoided: every shape is a circle, a polygon, or a
// round-capped polyline, so the PNG endpoint can rasterize the same data the
// SVG emits.

export type LionInk = 'white' | 'theme';

export type LionShape =
  /** Filled circle. */
  | { kind: 'circle'; cx: number; cy: number; r: number; ink: LionInk }
  /** Filled polygon. `grow` outsets it with round joins (an SVG stroke). */
  | { kind: 'polygon'; points: [number, number][]; ink: LionInk; grow?: number }
  /** Round-capped, round-joined stroked polyline of width `w`. */
  | { kind: 'line'; points: [number, number][]; w: number; ink: LionInk };

const MANE_LOBES: LionShape[] = [
  [50.0, 15.5], [63.8, 19.5], [73.2, 30.4], [75.2, 44.6], [69.3, 57.7], [57.2, 65.5],
  [42.8, 65.5], [30.7, 57.7], [24.8, 44.6], [26.8, 30.4], [36.2, 19.5],
].map(([cx, cy]) => ({ kind: 'circle', cx, cy, r: 9.2, ink: 'white' }));

export const LION_SHAPES: LionShape[] = [
  // Mane — overlapping lobes read as shaggy fur; radiating spikes read as a sun.
  { kind: 'circle', cx: 50, cy: 41, r: 26, ink: 'white' },
  ...MANE_LOBES,
  // Inner ears — a white ear on a white mane is invisible, so the badge color
  // carries the shape.
  { kind: 'polygon', points: [[31, 25.5], [34.5, 15], [40, 22]], ink: 'theme', grow: 1.5 },
  { kind: 'polygon', points: [[69, 25.5], [65.5, 15], [60, 22]], ink: 'theme', grow: 1.5 },
  // Face
  { kind: 'circle', cx: 50, cy: 42, r: 19, ink: 'theme' },
  { kind: 'circle', cx: 43, cy: 37.5, r: 3.3, ink: 'white' },
  { kind: 'circle', cx: 57, cy: 37.5, r: 3.3, ink: 'white' },
  // Muzzle — the twin-lobe cat snout is what separates lion from sun.
  { kind: 'circle', cx: 44.8, cy: 53, r: 7, ink: 'white' },
  { kind: 'circle', cx: 55.2, cy: 53, r: 7, ink: 'white' },
  // Nose and mouth must be the badge color: white-on-white loses the snout.
  { kind: 'polygon', points: [[46.2, 47.8], [53.8, 47.8], [50, 52]], ink: 'theme' },
  { kind: 'line', points: [[50, 52], [50, 54.8]], w: 1.9, ink: 'theme' },
  { kind: 'line', points: [[46.9, 56.5], [50, 54.8], [53.1, 56.5]], w: 1.9, ink: 'theme' },
];

/** The lion's drawn extent, used to fit it to a canvas. */
export const LION_BOUNDS = { cx: 50, cy: 41, radius: 34.7 };

/**
 * Scale that fits the lion into a 100x100 icon with `pad` units of margin,
 * centered. The in-app badge does not use this — it reserves room below the
 * lion for the team number.
 */
export function lionIconScale(pad = 8): number {
  return (50 - pad) / LION_BOUNDS.radius;
}

const esc = (s: string) => s.replace(/[<>&"']/g, '');

/**
 * The lion as SVG markup, centered and scaled to fill a 100x100 viewBox.
 * `themeColor` must already be a safe CSS color (a validated hex).
 */
export function lionIconSvg(themeColor: string, pad = 8): string {
  const color = esc(themeColor);
  const paint = (ink: LionInk) => (ink === 'white' ? '#ffffff' : color);
  const s = lionIconScale(pad);

  const body = LION_SHAPES.map((shape) => {
    if (shape.kind === 'circle') {
      return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${paint(shape.ink)}"/>`;
    }
    const d = shape.points.map(([x, y]) => `${x},${y}`).join(' L ');
    if (shape.kind === 'polygon') {
      const stroke = shape.grow
        ? ` stroke="${paint(shape.ink)}" stroke-width="${shape.grow * 2}" stroke-linejoin="round"`
        : '';
      return `<path d="M ${d} Z" fill="${paint(shape.ink)}"${stroke}/>`;
    }
    return `<path d="M ${d}" fill="none" stroke="${paint(shape.ink)}" stroke-width="${shape.w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('\n    ');

  return `<g transform="translate(50 50) scale(${s.toFixed(4)}) translate(-${LION_BOUNDS.cx} -${LION_BOUNDS.cy})">
    ${body}
  </g>`;
}
