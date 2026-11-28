import { Circle, Point, deg2rad, rotatePoint } from '../geom/math.ts';
import { CircleDef, PuzzleSpec, PuzzleState, evenStops } from './types.ts';

export type NumExpr = number | string;

export type StopsInput =
  | number // evenStops(n), e.g. 6 -> [0, 60, 120, 180, 240, 300]
  | NumExpr[] // explicit CW stop angles in degrees, e.g. [0, 36, 108, ...]
  | { steps: NumExpr[] }; // cumulative CW step increments summing to 360

export interface ExplicitAxisInput {
  id: string;
  cx: NumExpr;
  cy: NumExpr;
  r: NumExpr;
  stops: StopsInput;
  color: string;
  /** Optional inner-to-outer concentric layer radii (e.g. [0.8, 1.0]). */
  layers?: NumExpr[];
  /** 'inside' (default) or 'outside' (exterior turn, e.g. ThinkFun Moonspinner). */
  region?: 'inside' | 'outside';
  /** Optional explicit label badge position [x, y] in math coordinates. */
  labelPos?: [NumExpr, NumExpr];
  /** Emergent "discovered grip" axis: hidden while blocked, lights up when arcs align. */
  discovered?: boolean;
}

export interface RingAxisInput {
  ring: {
    /** Single-character circle IDs in CW order (e.g. "ABCDEFGH" or ["A","B","C"]). */
    ids: string | string[];
    /** Distance of each circle center from center (defaults to [0, 0]). */
    centerRadius: NumExpr;
    /** Optional ring center [cx, cy] (defaults to [0, 0]). */
    center?: [NumExpr, NumExpr];
    /** Radius of each circle in the ring. */
    r: NumExpr;
    /** Starting angle in degrees for the first circle (default 90 = top, progressing CW). */
    startAngleDeg?: NumExpr;
    /** Optional concentric layer radii shared by every circle in the ring. */
    layers?: NumExpr[];
    stops: StopsInput;
    /** Colors cycling across the ring. */
    colors: string[];
    /** Emergent "discovered grip" axes: hidden while blocked, light up when arcs align. */
    discovered?: boolean;
  };
}

export type AxisInput = ExplicitAxisInput | RingAxisInput;

export interface CircleExpr {
  cx: NumExpr;
  cy: NumExpr;
  r: NumExpr;
}

export interface RingCirclesExpr {
  ring: {
    count: number;
    centerRadius: NumExpr;
    center?: [NumExpr, NumExpr];
    r: NumExpr;
    startAngleDeg?: NumExpr;
    /** Direction of progression: 'cw' (default) or 'ccw'. */
    direction?: 'cw' | 'ccw';
  };
}

export type CircleSource = string | CircleExpr | RingCirclesExpr;

export interface SilhouettePart {
  /** Circles to slice for this silhouette piece (axis IDs, explicit circles, or ring generators). */
  circles: CircleSource[];
  /** Optional filter keeping only regions inside/outside given circle refs. */
  inside?: CircleSource[];
  outside?: CircleSource[];
}

export interface SilhouetteSpec {
  parts: SilhouettePart[];
}

/**
 * A single move step inside a closure pass.
 * - String: RingTwist move token (e.g. "A", "B'", "B2", "a", "2A"), followed by cutting by all axes.
 * - Object: explicit move + optional restricted cutBy list and optional region mask (only/skip).
 */
export type ClosureMoveStep =
  | string
  | {
      move: string;
      /** Circle refs to slice with after this move (e.g. "A", "A:1" for layer 1, "B"). Omit to slice by all axes. */
      cutBy?: string[];
      /** Only slice pieces matching this filter after the move (unmatched pieces stay intact). */
      only?: RegionFilter;
      /** Skip slicing pieces matching this filter after the move (index-free equivalent of HideParts). */
      skip?: RegionFilter;
    };

export interface ClosureBlock {
  moves: ClosureMoveStep[];
  /** Number of times to repeat `moves` per outer pass (default 1). */
  repeat?: number;
}

export interface RotatedCircleRef {
  /** Axis ID to rotate around `around` (defaults to [0, 0] or another axis ID). */
  axis: string;
  around: string | [NumExpr, NumExpr];
  /** CCW rotation angle in degrees. */
  angleDeg: NumExpr;
  /** Optional radius override. */
  r?: NumExpr;
}

export type ColorCircleRef = string | CircleExpr | RotatedCircleRef;

/**
 * Index-free geometric predicate matching pieces by circle containment, axis count, area, or coordinates.
 * Shared across masked cuts (`cutCircles`/`closure`), predicate `bandage`, and `region` coloring.
 */
export interface RegionFilter {
  inside?: ColorCircleRef[];
  outside?: ColorCircleRef[];
  /** Match pieces inside exactly N (or [min, max]) axes from `ofAxes` (defaults to all playable axes). */
  memberCount?: number | [number, number];
  ofAxes?: string | string[];
  minArea?: NumExpr;
  maxArea?: NumExpr;
  /** Optional polar angle range [minDeg, maxDeg] in (-180, 180] relative to symmetryCenter. */
  angleDeg?: [NumExpr, NumExpr];
  minX?: NumExpr;
  maxX?: NumExpr;
  minY?: NumExpr;
  maxY?: NumExpr;
}

export type CutOp =
  | {
      op: 'sliceByAxes';
      /** Subset of circle/layer refs (e.g. ["A", "A:1", "B"]). Defaults to all axes + inner layers. */
      axes?: string[];
    }
  | {
      op: 'closure';
      /** Shorthand flat list of moves (wrapped into a single block). */
      moves?: ClosureMoveStep[];
      /** Structured sequence of move blocks repeated together until convergence (or maxIters). */
      blocks?: ClosureBlock[];
      /** Maximum outer convergence iterations (default 10). */
      maxIters?: number;
      /** Minimum piece area threshold to discard numerical slivers (default 1e-5). */
      minArea?: number;
    }
  | {
      op: 'cutCircles';
      circles: CircleSource[];
      /** Optional axis ID restricting which pieces get sliced (legacy shorthand for `only: { inside: [id] }`). */
      onlyInside?: string;
      /** Only slice pieces matching this filter (rotated alongside `repeatSymmetry`). */
      only?: RegionFilter;
      /** Skip slicing pieces matching this filter (rotated alongside `repeatSymmetry`). */
      skip?: RegionFilter;
      /** Optional N-fold rotational replication around symmetryCenter (CW by 360/N). */
      repeatSymmetry?: number;
      minArea?: number;
    }
  | {
      op: 'orbitSlice';
      /** CW rotation angles in degrees at which each target circle's contents get sliced by other circles. */
      anglesDeg: NumExpr[];
      axes?: string[];
      maxMemberCircles?: number;
      nonChaining?: boolean;
      passes?: number;
    }
  | {
      op: 'bandage';
      /** Groups of [x, y] points whose containing pieces are fused into a single piece. */
      groups?: [NumExpr, NumExpr][][];
      /** Index-free geometric predicates: each filter fuses all matching pieces into one merged piece. */
      where?: RegionFilter[];
      /** Replicate each group/predicate across puzzle rotational symmetry (true) or explicit N-fold count. */
      symmetric?: boolean | number;
    };

export type ColoringRule =
  | { type: 'default' }
  | { type: 'fill'; color: string }
  | {
      type: 'venn';
      /** Map from sorted circle-membership string (e.g. "A", "AB", "ABC") to hex color. */
      colors: Record<string, string>;
    }
  | {
      type: 'cyclicArm';
      /** Ordered ring of axis IDs (e.g. "ABCDEFGH" or ["A","B","C","D","E"]). */
      axes: string | string[];
      /** 'cw' (default): inside[k] && !inside[(k+1)%n]; 'ccw': inside[k] && !inside[(k-1+n)%n]. */
      direction?: 'cw' | 'ccw';
      colors: string[];
    }
  | (RegionFilter & {
      type: 'region';
      /** Single fill color (used when `repeatSymmetry` is omitted). */
      color?: string;
      /** Stamp this region filter CW around symmetryCenter with a color per symmetry step. */
      repeatSymmetry?: {
        count?: number;
        stepDeg?: NumExpr;
        colors: string[];
      };
    })
  | {
      type: 'points';
      probes: { x: NumExpr; y: NumExpr; color: string }[];
    };

export interface CenterWedgesStickerRule {
  type: 'centerWedges';
  /** Interior point [x, y] selecting the piece to receive wedge stickers. */
  point?: [NumExpr, NumExpr];
  colors: string[];
  /** Starting edge angle in degrees for color 0 (default 90 = top, progressing CW). */
  startAngleDeg?: NumExpr;
}

export type StickerRule = CenterWedgesStickerRule;

export interface PieceTypeInput {
  /** Short identifier used in `@focus` directives (e.g. "big_pent", "kite", "tri"). */
  id: string;
  /** Optional display label (e.g. "Big Pentagon"). */
  label?: string;
  /** Interior point [x, y] in solved coordinates selecting one piece of this congruent shape class. */
  probe: [NumExpr, NumExpr];
}

export interface RingTwistPuzzleDoc {
  format: 'ringtwist/v1';
  id: string;
  name: string;
  category?: 'Geranium Family' | 'Designer & Exotic' | 'Classic Circles' | 'Custom';
  description?: string;
  params?: Record<string, NumExpr>;
  symmetryStepDeg?: NumExpr;
  symmetryCenter?: [NumExpr, NumExpr];
  viewBounds?: [NumExpr, NumExpr, NumExpr, NumExpr];
  axes: AxisInput[];
  silhouette?: SilhouetteSpec;
  cuts?: CutOp[];
  coloring?: ColoringRule[];
  stickers?: StickerRule[];
  pieceTypes?: PieceTypeInput[];
  sampleAlgorithms?: { name: string; alg: string; note?: string }[];
}

// ---------------------------------------------------------------------------
// CSP-Safe Mathematical Expression Evaluator
// ---------------------------------------------------------------------------

const BUILTIN_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  phi: (1 + Math.sqrt(5)) / 2,
  sqrt2: Math.SQRT2,
  sqrt3: Math.sqrt(3),
  tau: Math.PI * 2,
};

const BUILTIN_FUNCS: Record<string, (...args: number[]) => number> = {
  sqrt: (x) => Math.sqrt(x),
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  asin: (x) => Math.asin(x),
  acos: (x) => Math.acos(x),
  atan: (x) => Math.atan(x),
  atan2: (y, x) => Math.atan2(y, x),
  abs: (x) => Math.abs(x),
  deg: (x) => (x * 180) / Math.PI,
  rad: (x) => (x * Math.PI) / 180,
  min: (...xs) => Math.min(...xs),
  max: (...xs) => Math.max(...xs),
};

export function evalNumExpr(expr: NumExpr, env: Record<string, number> = {}): number {
  if (typeof expr === 'number') {
    if (!Number.isFinite(expr)) {
      throw new Error(`Invalid non-finite number: ${expr}`);
    }
    return expr;
  }
  const src = expr.trim();
  if (!src) throw new Error('Empty numeric expression');
  let pos = 0;

  const skipWs = () => {
    while (pos < src.length && /\s/.test(src[pos])) pos++;
  };

  const parseExpr = (): number => {
    let val = parseTerm();
    while (true) {
      skipWs();
      if (src[pos] === '+') {
        pos++;
        val += parseTerm();
      } else if (src[pos] === '-') {
        pos++;
        val -= parseTerm();
      } else {
        break;
      }
    }
    return val;
  };

  const parseTerm = (): number => {
    let val = parsePower();
    while (true) {
      skipWs();
      if (src[pos] === '*') {
        pos++;
        val *= parsePower();
      } else if (src[pos] === '/') {
        pos++;
        val /= parsePower();
      } else {
        break;
      }
    }
    return val;
  };

  const parsePower = (): number => {
    const base = parseUnary();
    skipWs();
    if (src[pos] === '^') {
      pos++;
      return Math.pow(base, parsePower());
    }
    return base;
  };

  const parseUnary = (): number => {
    skipWs();
    if (src[pos] === '+') {
      pos++;
      return parseUnary();
    }
    if (src[pos] === '-') {
      pos++;
      return -parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    skipWs();
    if (src[pos] === '(') {
      pos++;
      const v = parseExpr();
      skipWs();
      if (src[pos] !== ')') throw new Error(`Missing ")" in expression "${src}"`);
      pos++;
      return v;
    }

    const numMatch = src.slice(pos).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (numMatch) {
      pos += numMatch[0].length;
      return parseFloat(numMatch[0]);
    }

    const idMatch = src.slice(pos).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (idMatch) {
      const name = idMatch[0];
      pos += name.length;
      skipWs();
      if (src[pos] === '(') {
        pos++;
        const args: number[] = [];
        skipWs();
        if (src[pos] !== ')') {
          args.push(parseExpr());
          while (true) {
            skipWs();
            if (src[pos] === ',') {
              pos++;
              args.push(parseExpr());
            } else {
              break;
            }
          }
        }
        skipWs();
        if (src[pos] !== ')') throw new Error(`Missing ")" after ${name}(...) in "${src}"`);
        pos++;
        const fn = BUILTIN_FUNCS[name.toLowerCase()];
        if (!fn) throw new Error(`Unknown math function "${name}" in "${src}"`);
        return fn(...args);
      }
      if (name in env) return env[name];
      const lower = name.toLowerCase();
      if (lower in BUILTIN_CONSTANTS) return BUILTIN_CONSTANTS[lower];
      throw new Error(`Unknown parameter "${name}" in "${src}"`);
    }

    throw new Error(`Unexpected token at "${src.slice(pos)}" in expression "${src}"`);
  };

  const result = parseExpr();
  skipWs();
  if (pos < src.length) {
    throw new Error(`Unexpected trailing "${src.slice(pos)}" in expression "${src}"`);
  }
  if (!Number.isFinite(result)) {
    throw new Error(`Expression "${src}" evaluated to non-finite value`);
  }
  return result;
}

export function resolveParams(params?: Record<string, NumExpr>): Record<string, number> {
  const env: Record<string, number> = {};
  if (!params) return env;
  for (const [key, expr] of Object.entries(params)) {
    env[key] = evalNumExpr(expr, env);
  }
  return env;
}

export function resolveStops(input: StopsInput, env: Record<string, number>): number[] {
  if (typeof input === 'number') {
    if (!Number.isInteger(input) || input < 1 || input > 72) {
      throw new Error(`Stop count must be an integer between 1 and 72 (got ${input})`);
    }
    return evenStops(input);
  }
  if (Array.isArray(input)) {
    if (input.length === 0) throw new Error('stops array cannot be empty');
    return input.map((v) => (((evalNumExpr(v, env) % 360) + 360) % 360));
  }
  if (input && typeof input === 'object' && Array.isArray(input.steps)) {
    if (input.steps.length === 0) throw new Error('stops.steps cannot be empty');
    const out: number[] = [0];
    let acc = 0;
    for (let i = 0; i < input.steps.length - 1; i++) {
      acc += evalNumExpr(input.steps[i], env);
      out.push(((acc % 360) + 360) % 360);
    }
    return out;
  }
  throw new Error('Invalid stops specification');
}

export function resolveAxes(axes: AxisInput[], env: Record<string, number>): CircleDef[] {
  const out: CircleDef[] = [];
  const seen = new Set<string>();

  const pushCircle = (c: CircleDef) => {
    if (!/^[A-W]$/.test(c.id)) {
      throw new Error(
        `Invalid axis id "${c.id}" (must be a single uppercase letter A–W; X, Y, Z are reserved for flips/rotations)`,
      );
    }
    if (seen.has(c.id)) {
      throw new Error(`Duplicate axis id "${c.id}"`);
    }
    seen.add(c.id);
    if (c.r <= 0) throw new Error(`Axis "${c.id}" radius must be positive`);
    out.push(c);
  };

  for (const entry of axes) {
    if ('ring' in entry) {
      const rg = entry.ring;
      const ids = typeof rg.ids === 'string' ? rg.ids.split('') : rg.ids;
      if (ids.length === 0) throw new Error('ring.ids cannot be empty');
      const centerR = evalNumExpr(rg.centerRadius, env);
      const r = evalNumExpr(rg.r, env);
      const startDeg = rg.startAngleDeg !== undefined ? evalNumExpr(rg.startAngleDeg, env) : 90;
      const cx0 = rg.center ? evalNumExpr(rg.center[0], env) : 0;
      const cy0 = rg.center ? evalNumExpr(rg.center[1], env) : 0;
      const stopsDeg = resolveStops(rg.stops, env);
      const layerRadii = rg.layers?.map((v) => evalNumExpr(v, env));
      if (layerRadii && layerRadii.length > 0) {
        layerRadii.sort((a, b) => a - b);
      }

      for (let i = 0; i < ids.length; i++) {
        const ang = deg2rad(startDeg - (360 * i) / ids.length);
        pushCircle({
          id: ids[i],
          cx: cx0 + centerR * Math.cos(ang),
          cy: cy0 + centerR * Math.sin(ang),
          r,
          stopsDeg,
          color: rg.colors[i % rg.colors.length] ?? '#38bdf8',
          ...(layerRadii && layerRadii.length > 1 ? { layerRadii } : {}),
          ...(rg.discovered ? { discovered: true } : {}),
        });
      }
    } else {
      const r = evalNumExpr(entry.r, env);
      const layerRadii = entry.layers?.map((v) => evalNumExpr(v, env));
      if (layerRadii && layerRadii.length > 0) {
        layerRadii.sort((a, b) => a - b);
      }
      pushCircle({
        id: entry.id,
        cx: evalNumExpr(entry.cx, env),
        cy: evalNumExpr(entry.cy, env),
        r,
        stopsDeg: resolveStops(entry.stops, env),
        color: entry.color,
        ...(layerRadii && layerRadii.length > 1 ? { layerRadii } : {}),
        ...(entry.region === 'outside' ? { turnRegion: 'outside' } : {}),
        ...(entry.discovered ? { discovered: true } : {}),
        ...(entry.labelPos
          ? {
              labelPos: {
                x: evalNumExpr(entry.labelPos[0], env),
                y: evalNumExpr(entry.labelPos[1], env),
              },
            }
          : {}),
      });
    }
  }

  return out;
}

export function resolveCircleSources(
  sources: CircleSource[],
  axisMap: Map<string, CircleDef>,
  env: Record<string, number>,
): Circle[] {
  const out: Circle[] = [];
  for (const src of sources) {
    if (typeof src === 'string') {
      out.push(resolveAxisOrLayerRef(src, axisMap));
    } else if ('ring' in src) {
      const rg = src.ring;
      const centerR = evalNumExpr(rg.centerRadius, env);
      const r = evalNumExpr(rg.r, env);
      const startDeg = rg.startAngleDeg !== undefined ? evalNumExpr(rg.startAngleDeg, env) : 90;
      const cx0 = rg.center ? evalNumExpr(rg.center[0], env) : 0;
      const cy0 = rg.center ? evalNumExpr(rg.center[1], env) : 0;
      const sign = rg.direction === 'ccw' ? 1 : -1;
      for (let i = 0; i < rg.count; i++) {
        const ang = deg2rad(startDeg + (sign * 360 * i) / rg.count);
        out.push({
          cx: cx0 + centerR * Math.cos(ang),
          cy: cy0 + centerR * Math.sin(ang),
          r,
        });
      }
    } else {
      out.push({
        cx: evalNumExpr(src.cx, env),
        cy: evalNumExpr(src.cy, env),
        r: evalNumExpr(src.r, env),
      });
    }
  }
  return out;
}

export function resolveAxisOrLayerRef(ref: string, axisMap: Map<string, CircleDef>): Circle {
  const m = ref.match(/^([A-W])(?::(\d+))?$/);
  if (!m) throw new Error(`Invalid axis/layer reference "${ref}"`);
  const c = axisMap.get(m[1]);
  if (!c) throw new Error(`Unknown axis "${m[1]}" in reference "${ref}"`);
  if (m[2]) {
    const idx = parseInt(m[2], 10) - 1;
    const radii = c.layerRadii && c.layerRadii.length > 1 ? c.layerRadii : [c.r];
    if (idx < 0 || idx >= radii.length) {
      throw new Error(`Layer index ${m[2]} out of range for axis "${c.id}"`);
    }
    return { cx: c.cx, cy: c.cy, r: radii[idx] };
  }
  return { cx: c.cx, cy: c.cy, r: c.r };
}

export function resolveColorCircleRef(
  ref: ColorCircleRef,
  axisMap: Map<string, CircleDef>,
  env: Record<string, number>,
): Circle {
  if (typeof ref === 'string') return resolveAxisOrLayerRef(ref, axisMap);
  if ('axis' in ref) {
    const base = resolveAxisOrLayerRef(ref.axis, axisMap);
    const pivot: Point =
      typeof ref.around === 'string'
        ? (() => {
            const p = resolveAxisOrLayerRef(ref.around, axisMap);
            return { x: p.cx, y: p.cy };
          })()
        : { x: evalNumExpr(ref.around[0], env), y: evalNumExpr(ref.around[1], env) };
    const rot = rotatePoint({ x: base.cx, y: base.cy }, pivot, deg2rad(evalNumExpr(ref.angleDeg, env)));
    return {
      cx: rot.x,
      cy: rot.y,
      r: ref.r !== undefined ? evalNumExpr(ref.r, env) : base.r,
    };
  }
  return {
    cx: evalNumExpr(ref.cx, env),
    cy: evalNumExpr(ref.cy, env),
    r: evalNumExpr(ref.r, env),
  };
}

// ---------------------------------------------------------------------------
// Document Validation
// ---------------------------------------------------------------------------

export function validateRingTwistDoc(
  raw: unknown,
): { ok: true; doc: RingTwistPuzzleDoc } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Puzzle JSON must be an object'] };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== 'ringtwist/v1') {
    errors.push(`Expected "format": "ringtwist/v1" (got ${JSON.stringify(obj.format)})`);
  }
  if (typeof obj.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,48}$/.test(obj.id)) {
    errors.push('"id" must be a lowercase slug (letters, digits, "-", "_")');
  }
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    errors.push('"name" must be a non-empty string');
  }
  if (!Array.isArray(obj.axes) || obj.axes.length === 0) {
    errors.push('"axes" must be a non-empty array of circle or ring definitions');
  }
  if (errors.length > 0) return { ok: false, errors };

  try {
    const doc = obj as unknown as RingTwistPuzzleDoc;
    const env = resolveParams(doc.params);
    const circles = resolveAxes(doc.axes, env);
    if (circles.length === 0) {
      errors.push('Puzzle must define at least 1 playable axis');
    }
    if (doc.symmetryStepDeg !== undefined) {
      const s = evalNumExpr(doc.symmetryStepDeg, env);
      if (s < 0 || s > 360) errors.push('"symmetryStepDeg" must be between 0 and 360');
    }
    if (doc.viewBounds !== undefined) {
      if (!Array.isArray(doc.viewBounds) || doc.viewBounds.length !== 4) {
        errors.push('"viewBounds" must be a 4-tuple [minX, maxX, minY, maxY]');
      } else {
        doc.viewBounds.forEach((v) => evalNumExpr(v, env));
      }
    }
    if (doc.pieceTypes !== undefined) {
      if (!Array.isArray(doc.pieceTypes)) {
        errors.push('"pieceTypes" must be an array of { id, label?, probe: [x, y] }');
      } else {
        for (const pt of doc.pieceTypes) {
          if (!pt || typeof pt !== 'object' || typeof pt.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(pt.id)) {
            errors.push('Each pieceType requires an identifier "id" (letters, digits, "_", "-")');
            break;
          }
          if (!Array.isArray(pt.probe) || pt.probe.length !== 2) {
            errors.push(`pieceType "${pt.id}" requires a 2-tuple "probe": [x, y]`);
            break;
          }
          evalNumExpr(pt.probe[0], env);
          evalNumExpr(pt.probe[1], env);
        }
      }
    }
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, doc };
  } catch (err) {
    return {
      ok: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}

// ---------------------------------------------------------------------------
// Source Doc Attachment & Export
// ---------------------------------------------------------------------------

const sourceDocMap = new WeakMap<PuzzleSpec, RingTwistPuzzleDoc>();

export function registerPuzzleSourceDoc(spec: PuzzleSpec, doc: RingTwistPuzzleDoc): void {
  sourceDocMap.set(spec, doc);
}

export function getPuzzleSourceDoc(spec: PuzzleSpec): RingTwistPuzzleDoc | undefined {
  return sourceDocMap.get(spec);
}

function roundNice(n: number): number {
  const r = Number(n.toFixed(6));
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Export any PuzzleState into a clean, self-contained RingTwist v1 JSON document.
 * If the puzzle was natively defined in ringtwist/v1, returns its exact clean source doc!
 * Otherwise synthesizes an index-free ringtwist/v1 document with exact axes + coloring probes.
 */
export function exportPuzzleToRingTwistDoc(
  state: PuzzleState,
  interiorPointFn: (region: PuzzleState['pieces'][number]['region']) => Point,
): RingTwistPuzzleDoc {
  const native = sourceDocMap.get(state.spec);
  if (native) {
    return JSON.parse(JSON.stringify(native)) as RingTwistPuzzleDoc;
  }

  const spec = state.spec;
  const axes: ExplicitAxisInput[] = spec.circles.map((c) => {
    const n = c.stopsDeg.length;
    const step = n > 0 ? 360 / n : 0;
    const isEven =
      n > 0 && c.stopsDeg.every((a, i) => Math.abs(a - i * step) < 1e-3);
    return {
      id: c.id,
      cx: roundNice(c.cx),
      cy: roundNice(c.cy),
      r: roundNice(c.r),
      ...(c.layerRadii && c.layerRadii.length > 1
        ? { layers: c.layerRadii.map(roundNice) }
        : {}),
      stops: isEven ? n : c.stopsDeg.map(roundNice),
      ...(c.turnRegion === 'outside' ? { region: 'outside' } : {}),
      color: c.color,
      ...(c.labelPos
        ? { labelPos: [roundNice(c.labelPos.x), roundNice(c.labelPos.y)] as [number, number] }
        : {}),
    };
  });

  // Synthesize move-closure cuts & index-free point probes for coloring
  const probes = state.pieces.map((p) => {
    const pt = interiorPointFn(p.region);
    return { x: roundNice(pt.x), y: roundNice(pt.y), color: p.color };
  });

  const closureMoves = spec.circles.map((c) =>
    c.layerRadii && c.layerRadii.length > 1 ? c.id.toLowerCase() : c.id,
  );

  return {
    format: 'ringtwist/v1',
    id: spec.id,
    name: spec.name,
    category: spec.category,
    description: spec.description,
    ...(spec.symmetryStepDeg > 0 ? { symmetryStepDeg: spec.symmetryStepDeg } : {}),
    ...(spec.symmetryCenter
      ? {
          symmetryCenter: [
            roundNice(spec.symmetryCenter.x),
            roundNice(spec.symmetryCenter.y),
          ],
        }
      : {}),
    ...(spec.viewBounds
      ? {
          viewBounds: [
            roundNice(spec.viewBounds.minX),
            roundNice(spec.viewBounds.maxX),
            roundNice(spec.viewBounds.minY),
            roundNice(spec.viewBounds.maxY),
          ],
        }
      : {}),
    axes,
    cuts: [{ op: 'closure', moves: closureMoves, maxIters: 8 }],
    coloring: [{ type: 'default' }, { type: 'points', probes }],
    ...(spec.pieceTypes && spec.pieceTypes.length > 0
      ? {
          pieceTypes: spec.pieceTypes.map((pt) => ({
            id: pt.id,
            ...(pt.label ? { label: pt.label } : {}),
            probe: [roundNice(pt.probe.x), roundNice(pt.probe.y)] as [number, number],
          })),
        }
      : {}),
    ...(spec.sampleAlgorithms ? { sampleAlgorithms: spec.sampleAlgorithms } : {}),
  };
}
