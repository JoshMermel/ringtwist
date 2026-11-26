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
}

export interface OrbitSliceStep {
  /** CW rotation angles (in degrees) at which each circle's contents get sliced by other circles. */
  anglesDeg: number[];
  /** Optional subset of circle IDs to rotate; defaults to all circles. */
  circleIds?: string[];
  /** Only slice pieces belonging to at most this many puzzle circles. */
  maxMemberCircles?: number;
  /**
   * When true, project all virtual cuts simultaneously from the current state
   * (non-chaining) instead of feeding circle i's cuts into circle i+1.
   */
  nonChaining?: boolean;
  /** Number of passes (default 1). */
  passes?: number;
}

export interface VirtualCutSpec {
  /** Cutting circle in the puzzle's coordinate frame. */
  circle: Circle;
  /** If set, only slice pieces currently inside this circle ID. */
  onlyInsideCircleId?: string;
  /** If true, replicate this cut across the puzzle's rotational symmetry. */
  symmetric?: boolean;
}

export interface BandageGroupSpec {
  /**
   * Points (in solved coordinate frame) whose containing atomic pieces should
   * be fused into one single piece (bandaged).
   */
  points: Point[];
  /** If true, replicate this bandage across the puzzle's rotational symmetry. */
  symmetric?: boolean;
}

export interface BandageByMemberCountSpec {
  /**
   * Merge adjacent atomic regions that both satisfy `predicate` and belong to
   * the same connected component (useful for bandaging all sub-pieces of an
   * outer crescent or inner petal).
   */
  predicate: (info: AtomicPieceInfo) => boolean;
}

export interface AtomicPieceInfo {
  region: ArcRegion;
  interiorPoint: Point;
  area: number;
  /** IDs of all puzzle circles containing this piece. */
  memberCircles: string[];
  /** Distance of interiorPoint from puzzle symmetry center. */
  radialDist: number;
}

export interface PuzzleColoringContext {
  circles: CircleDef[];
  symmetryCenter: Point;
}

export interface PuzzleSpec {
  id: string;
  name: string;
  category: 'Geranium Family' | 'Designer & Exotic' | 'Classic Circles' | 'Custom';
  description: string;
  circles: CircleDef[];
  /** Whole-puzzle rotational symmetry step in degrees CW (e.g. 72 for 5-fold). */
  symmetryStepDeg: number;
  symmetryCenter?: Point;
  /** Optional orbit-slicing steps to carve pieces created by valid rotations. */
  orbitSlices?: OrbitSliceStep[];
  /** Optional explicit virtual cutting circles (e.g. for targeted unbandaging). */
  extraCuts?: VirtualCutSpec[];
  /**
   * Optional declarative bandaging rules (fuse specific atomic pieces together).
   * Leaving a group out of `bandages` leaves those pieces unbandaged!
   */
  bandages?: BandageGroupSpec[];
  /**
   * Optional predicate-based bandaging rules (fuse connected components matching
   * a geometric predicate).
   */
  bandagePredicates?: BandageByMemberCountSpec[];
  /** Optional custom piece builder for exact chiral/unbandaged puzzle constructions. */
  customBuilder?: (spec: PuzzleSpec) => Piece[];
  /** Optional custom color assignment function. */
  assignColor?: (info: AtomicPieceInfo, ctx: PuzzleColoringContext) => string;
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
