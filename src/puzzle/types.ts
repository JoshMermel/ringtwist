import { ArcEdge, ArcRegion } from '../geom/arcRegion.ts';
import { Circle, Point } from '../geom/math.ts';

/**
 * A colored wedge sticker on a multi-colored piece (such as the 5-color
 * oriented central pentagon on Geranium / Geranium Plus).
 * Moves rigidly with its parent piece.
 */
export interface StickerWedge {
  apex: Point;
  arc: ArcEdge;
  color: string;
}

export interface CircleDef extends Circle {
  /** Spatial name in default orientation (e.g. 'A', 'B', 'C', 'D', 'E'). */
  id: string;
  /**
   * Ordered CW stop angles in degrees within [0, 360).
   * Index 0 should be 0. Moving +k steps advances by stopsDeg[k % len] - stopsDeg[0]
   * when evenly spaced, or cycles through discrete stops.
   */
  stopsDeg: number[];
  /** Primary display color associated with this circle. */
  color: string;
  /**
   * Optional inner-to-outer concentric layer radii for multi-layer circles (e.g. GigaHex, Crazy Lekki).
   * Layer 1 (`A`) is the innermost disk (`0..layerRadii[0]`, the "outer" cap on an infinite sphere);
   * wide (`a`) turns layers `1..N` together; slice `2A` turns only the outer annulus (`layerRadii[0]..layerRadii[1]`).
   */
  layerRadii?: number[];
  /**
   * Optional turn region mode (defaults to `'inside'`).
   * `'outside'` rotates everything strictly outside the circle (e.g. ThinkFun Moonspinner).
   */
  turnRegion?: 'inside' | 'outside';
  /** Optional explicit label badge position in math coordinates. */
  labelPos?: Point;
  /**
   * When true, this axis is an emergent "discovered grip" that starts blocked
   * in the solved state and stays hidden (excluded from initial silhouette cuts,
   * rims, labels, and chips) until turns align arcs so it becomes unblocked.
   */
  discovered?: boolean;
}

export interface PieceTypeDef {
  /** Short identifier used in `@focus` directives & saved macro metadata (e.g. "big_pent", "kite", "tri"). */
  id: string;
  /** Optional human-readable display label (e.g. "Big Pentagon"). */
  label?: string;
  /** Interior point in solved puzzle coordinates identifying one piece of this congruent shape class. */
  probe: Point;
}

export interface PuzzleSpec {
  id: string;
  name: string;
  category: 'Geranium Family' | 'Designer & Exotic' | 'Classic Circles';
  description: string;
  circles: CircleDef[];
  /** Whole-puzzle rotational symmetry step in degrees CW (e.g. 72 for 5-fold). */
  symmetryStepDeg: number;
  symmetryCenter?: Point;
  /** Optional named congruent piece-type classes (for `@focus` directives and focus-picker chips). */
  pieceTypes?: PieceTypeDef[];
  /** Piece builder for declarative `ringtwist/v1` and Geranium-family puzzle constructions. */
  customBuilder?: (spec: PuzzleSpec) => Piece[];
  /** Optional sample algorithms shown in the UI for quick exploration. */
  sampleAlgorithms?: { name: string; alg: string; note?: string }[];
  /** Optional explicit math-coordinate bounding box (when pieces extend outside playable circles, e.g. Moonspinner). */
  viewBounds?: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface Piece {
  id: number;
  region: ArcRegion;
  color: string;
  /** Home color / group key for solved detection. */
  homeColor: string;
  /** Area cached for sorting/display. */
  area: number;
  /** Optional multi-colored sticker wedges that rotate rigidly with the piece (e.g. central pentagon orientation). */
  stickers?: StickerWedge[];
}

export type MirrorAxis = 'x' | 'y';

export interface PuzzleState {
  spec: PuzzleSpec;
  pieces: Piece[];
  /**
   * Per-circle current stop index (0..stopsDeg.length-1) in the current spatial frame.
   * Tracks uneven stop lists cleanly; for even stops, stops are spaced uniformly.
   */
  circleStopIndex: Record<string, number>;
  /** Cumulative whole-puzzle CW rotation in degrees (for visual orientation tracking). */
  puzzleRotationDeg: number;
  /** True when an odd number of mirror flips (x / y) have been applied. */
  puzzleFlipped?: boolean;
  /** Mirror axes ('x' = top/bottom flip, 'y' = left/right flip) verified on this puzzle. */
  mirrorAxes?: MirrorAxis[];
}

/** Helper to generate evenly spaced stop angles in degrees: e.g. evenStops(10) => [0, 36, ..., 324]. */
export function evenStops(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (360 * i) / n);
}
