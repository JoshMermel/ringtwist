import {
  ArcRegion,
  classifyRegionAgainstCircle,
  edgePointAt,
  reflectRegion,
  regionSilhouetteKey,
  rotateRegion,
  simplifyRegion,
} from '../geom/arcRegion.ts';
import {
  Circle,
  Point,
  deg2rad,
  dist,
  normAngle,
  pointsEqual,
  rotatePoint,
  snapFloat,
} from '../geom/math.ts';
import { CircleDef, MirrorAxis, Piece, PuzzleSpec, PuzzleState, StickerWedge } from './types.ts';

function reflectPoint(p: Point, axis: MirrorAxis, center: Point): Point {
  return axis === 'x'
    ? { x: p.x, y: 2 * center.y - p.y }
    : { x: 2 * center.x - p.x, y: p.y };
}

function reflectStickers(
  stickers: StickerWedge[] | undefined,
  axis: MirrorAxis,
  center: Point,
): StickerWedge[] | undefined {
  if (!stickers) return undefined;
  const baseAngle = axis === 'x' ? 0 : Math.PI;
  return stickers.map((s) => {
    const nc = reflectPoint({ x: s.arc.cx, y: s.arc.cy }, axis, center);
    return {
      apex: reflectPoint(s.apex, axis, center),
      arc: {
        cx: nc.x,
        cy: nc.y,
        r: s.arc.r,
        startAngle: normAngle(baseAngle - (s.arc.startAngle + s.arc.sweep)),
        sweep: s.arc.sweep,
      },
      color: s.color,
    };
  });
}

function rotateStickers(
  stickers: StickerWedge[] | undefined,
  cx: number,
  cy: number,
  deltaAngle: number,
): StickerWedge[] | undefined {
  if (!stickers) return undefined;
  const center = { x: cx, y: cy };
  return stickers.map((s) => {
    const nc = rotatePoint({ x: s.arc.cx, y: s.arc.cy }, center, deltaAngle);
    return {
      apex: rotatePoint(s.apex, center, deltaAngle),
      arc: {
        cx: nc.x,
        cy: nc.y,
        r: s.arc.r,
        startAngle: normAngle(s.arc.startAngle + deltaAngle),
        sweep: s.arc.sweep,
      },
      color: s.color,
    };
  });
}

export interface CircleStatus {
  circleId: string;
  blocked: boolean;
  blockingPieceIds: number[];
  insidePieceIds: number[];
}

export type MoveResult =
  | {
      ok: true;
      nextState: PuzzleState;
      /** Angle turned CW in degrees (negative = CCW). */
      angleDeg: number;
      /** IDs of pieces that rotated (all pieces for whole-puzzle rotation). */
      movedPieceIds: number[];
      /** Center of rotation for animation. */
      pivot: { x: number; y: number };
      /** If set, this move is a 180° mirror flip across 'x' (top↔bottom) or 'y' (left↔right). */
      flipAxis?: MirrorAxis;
    }
  | {
      ok: false;
      circleId: string;
      blockingPieceIds: number[];
      reason: string;
    };

export function getCircleDef(spec: PuzzleSpec, circleId: string): CircleDef | undefined {
  return spec.circles.find((c) => c.id === circleId);
}

export interface MoveLayerSpec {
  /** 1-based layer index (1 = innermost disk / spherical cap, 2 = outer annulus slice `2A`). */
  layer?: number;
  /** Wide turn (`a`) rotating layers 1..layer (or all layers if `layer` omitted) together. */
  wide?: boolean;
}

interface ResolvedLayerBounds {
  innerR: number;
  outerR: number;
  turnRegion: 'inside' | 'outside';
}

export function resolveLayerBounds(
  circle: CircleDef,
  layerOpt?: MoveLayerSpec,
): ResolvedLayerBounds {
  const radii = circle.layerRadii;
  if (!radii || radii.length <= 1) {
    return {
      innerR: 0,
      outerR: circle.r,
      turnRegion: circle.turnRegion ?? 'inside',
    };
  }
  if (layerOpt?.wide) {
    const idx =
      layerOpt.layer !== undefined
        ? Math.min(radii.length, Math.max(1, layerOpt.layer)) - 1
        : radii.length - 1;
    return { innerR: 0, outerR: radii[idx], turnRegion: 'inside' };
  }
  const idx = Math.min(radii.length, Math.max(1, layerOpt?.layer ?? 1)) - 1;
  return {
    innerR: idx === 0 ? 0 : radii[idx - 1],
    outerR: radii[idx],
    turnRegion: 'inside',
  };
}

interface CompiledLayerBounds {
  turnRegion: 'inside' | 'outside';
  outerCircle: Circle;
  innerCircle: Circle | null;
}

function compileLayerBounds(circle: CircleDef, bounds: ResolvedLayerBounds): CompiledLayerBounds {
  const outerCircle: Circle =
    bounds.outerR === circle.r ? circle : { cx: circle.cx, cy: circle.cy, r: bounds.outerR };
  const innerCircle: Circle | null =
    bounds.innerR > 0 ? { cx: circle.cx, cy: circle.cy, r: bounds.innerR } : null;
  return { turnRegion: bounds.turnRegion, outerCircle, innerCircle };
}

function classifyRegionForBounds(
  region: Piece['region'],
  circle: CircleDef,
  compiled: CompiledLayerBounds,
): 'inside' | 'outside' | 'straddling' {
  if (compiled.turnRegion === 'outside') {
    const cls = classifyRegionAgainstCircle(region, circle);
    if (cls === 'straddling') return 'straddling';
    return cls === 'outside' ? 'inside' : 'outside';
  }
  const cOut = classifyRegionAgainstCircle(region, compiled.outerCircle);
  if (!compiled.innerCircle) return cOut;
  if (cOut === 'outside' || cOut === 'straddling') return cOut;

  const cIn = classifyRegionAgainstCircle(region, compiled.innerCircle);
  if (cIn === 'straddling') return 'straddling';
  return cIn === 'outside' ? 'inside' : 'outside';
}

const allCircleStatusesCache = new WeakMap<PuzzleState, Record<string, CircleStatus>>();

/**
 * Determine whether a circle (or specific concentric layer/slice) is currently free to turn
 * or blocked by straddling pieces.
 */
export function getCircleStatus(
  state: PuzzleState,
  circleId: string,
  layerOpt?: MoveLayerSpec,
): CircleStatus {
  const circle = getCircleDef(state.spec, circleId);
  if (!circle) {
    return { circleId, blocked: true, blockingPieceIds: [], insidePieceIds: [] };
  }

  const compiled = compileLayerBounds(circle, resolveLayerBounds(circle, layerOpt));
  const blockingPieceIds: number[] = [];
  const insidePieceIds: number[] = [];

  for (const p of state.pieces) {
    const cls = classifyRegionForBounds(p.region, circle, compiled);
    if (cls === 'inside') {
      insidePieceIds.push(p.id);
    } else if (cls === 'straddling') {
      blockingPieceIds.push(p.id);
    }
  }

  return {
    circleId,
    blocked: blockingPieceIds.length > 0,
    blockingPieceIds,
    insidePieceIds,
  };
}

/** Get status of every circle in the puzzle (memoized per immutable PuzzleState). */
export function getAllCircleStatuses(state: PuzzleState): Record<string, CircleStatus> {
  const cached = allCircleStatusesCache.get(state);
  if (cached) return cached;
  const out: Record<string, CircleStatus> = {};
  for (const c of state.spec.circles) {
    out[c.id] = getCircleStatus(state, c.id);
  }
  allCircleStatusesCache.set(state, out);
  return out;
}

/** Check whether a circle's stops are evenly spaced around 360 degrees. */
function isEvenStops(stopsDeg: number[]): boolean {
  if (stopsDeg.length === 0) return false;
  const step = 360 / stopsDeg.length;
  for (let i = 0; i < stopsDeg.length; i++) {
    if (Math.abs(stopsDeg[i] - i * step) > 1e-4) return false;
  }
  return true;
}

/** Compute CW delta angle (degrees) for advancing `steps` stops on a circle. */
export function computeStopDeltaDeg(
  circle: CircleDef,
  currentStopIdx: number,
  steps: number,
): { deltaDeg: number; nextStopIdx: number } {
  const n = circle.stopsDeg.length;
  if (n === 0) return { deltaDeg: 0, nextStopIdx: 0 };

  if (isEvenStops(circle.stopsDeg)) {
    const stepDeg = 360 / n;
    const nextStopIdx = (((currentStopIdx + steps) % n) + n) % n;
    return { deltaDeg: steps * stepDeg, nextStopIdx };
  }

  // General uneven stops: reduce full 360° revolutions in O(1), then step at most (n - 1) times
  let idx = ((currentStopIdx % n) + n) % n;
  const dir = steps >= 0 ? 1 : -1;
  const absSteps = Math.abs(steps);
  const fullRevs = Math.floor(absSteps / n);
  const remSteps = absSteps % n;
  let totalDeg = dir * fullRevs * 360;

  for (let s = 0; s < remSteps; s++) {
    const nextIdx = (idx + dir + n) % n;
    let diff = circle.stopsDeg[nextIdx] - circle.stopsDeg[idx];
    if (dir > 0) {
      if (diff <= 0) diff += 360;
    } else {
      if (diff >= 0) diff -= 360;
    }
    totalDeg += diff;
    idx = nextIdx;
  }

  return { deltaDeg: totalDeg, nextStopIdx: idx };
}

/**
 * Fast short-circuiting check for whether `circle` (or layer) has any straddling piece.
 */
function isCircleBlocked(
  state: PuzzleState,
  circle: CircleDef,
  layerOpt?: MoveLayerSpec,
): boolean {
  const compiled = compileLayerBounds(circle, resolveLayerBounds(circle, layerOpt));
  for (const p of state.pieces) {
    if (classifyRegionForBounds(p.region, circle, compiled) === 'straddling') {
      return true;
    }
  }
  return false;
}

/**
 * Rotate all pieces inside `circleId` (or the selected concentric layer/slice) clockwise by `cwDeg` degrees.
 * Optionally accepts precomputed `knownInsideIds` (when caller already verified the circle is free).
 */
export function turnCircleByAngle(
  state: PuzzleState,
  circleId: string,
  cwDeg: number,
  nextStopIdx?: number,
  knownInsideIds?: number[],
  layerOpt?: MoveLayerSpec,
): MoveResult {
  const circle = getCircleDef(state.spec, circleId);
  if (!circle) {
    return {
      ok: false,
      circleId,
      blockingPieceIds: [],
      reason: `Unknown circle "${circleId}"`,
    };
  }

  const pieces = state.pieces;
  const n = pieces.length;
  let insidePieceIds: number[];
  const insideIndices: number[] = [];

  if (knownInsideIds) {
    insidePieceIds = knownInsideIds;
    const insideSet = new Set(knownInsideIds);
    for (let i = 0; i < n; i++) {
      if (insideSet.has(pieces[i].id)) insideIndices.push(i);
    }
  } else {
    const compiled = compileLayerBounds(circle, resolveLayerBounds(circle, layerOpt));
    const blockingPieceIds: number[] = [];
    insidePieceIds = [];
    for (let i = 0; i < n; i++) {
      const p = pieces[i];
      const cls = classifyRegionForBounds(p.region, circle, compiled);
      if (cls === 'inside') {
        insideIndices.push(i);
        insidePieceIds.push(p.id);
      } else if (cls === 'straddling') {
        blockingPieceIds.push(p.id);
      }
    }
    if (blockingPieceIds.length > 0) {
      return {
        ok: false,
        circleId,
        blockingPieceIds,
        reason: `Circle ${circleId} is blocked by ${blockingPieceIds.length} piece${
          blockingPieceIds.length === 1 ? '' : 's'
        }`,
      };
    }
  }

  // Reduce modulo 360° before trig so huge step counts (e.g. A700000000) incur zero float drift
  const geomCwDeg = cwDeg % 360;
  const rad = deg2rad(-geomCwDeg); // CW in +y-up math coords is negative angle

  let nextPieces: Piece[];
  if (Math.abs(geomCwDeg) < 1e-9 || insideIndices.length === 0) {
    nextPieces = pieces;
  } else {
    nextPieces = pieces.slice();
    const cx = circle.cx;
    const cy = circle.cy;
    for (let k = 0; k < insideIndices.length; k++) {
      const i = insideIndices[k];
      const p = pieces[i];
      nextPieces[i] = {
        ...p,
        region: rotateRegion(p.region, cx, cy, rad),
        stickers: rotateStickers(p.stickers, cx, cy, rad),
      };
    }
  }

  const nextStops = { ...state.circleStopIndex };
  if (nextStopIdx !== undefined) {
    nextStops[circleId] = nextStopIdx;
  }

  return {
    ok: true,
    nextState: {
      ...state,
      pieces: nextPieces,
      circleStopIndex: nextStops,
    },
    angleDeg: Math.abs(cwDeg) > 720 ? geomCwDeg : cwDeg,
    movedPieceIds: insidePieceIds,
    pivot: { x: circle.cx, y: circle.cy },
  };
}

/**
 * Turn circle `circleId` (or concentric layer/slice) by `steps` discrete stops (+ = CW, - = CCW).
 */
export function turnCircleBySteps(
  state: PuzzleState,
  circleId: string,
  steps: number,
  layerOpt?: MoveLayerSpec,
  knownInsideIds?: number[],
): MoveResult {
  const circle = getCircleDef(state.spec, circleId);
  if (!circle) {
    return {
      ok: false,
      circleId,
      blockingPieceIds: [],
      reason: `Unknown circle "${circleId}"`,
    };
  }
  const curIdx = state.circleStopIndex[circleId] ?? 0;
  const { deltaDeg, nextStopIdx } = computeStopDeltaDeg(circle, curIdx, steps);
  return turnCircleByAngle(state, circleId, deltaDeg, nextStopIdx, knownInsideIds, layerOpt);
}

/**
 * Find circles that geometrically overlap with `circle`.
 */
function overlappingCircleIds(spec: PuzzleSpec, circle: CircleDef): string[] {
  return spec.circles
    .filter((o) => {
      if (o.id === circle.id) return false;
      const d = dist({ x: o.cx, y: o.cy }, { x: circle.cx, y: circle.cy });
      if (circle.turnRegion === 'outside' && o.turnRegion === 'outside') {
        return true;
      }
      if (circle.turnRegion === 'outside') {
        // Exterior turn moves everything outside `circle`, so `o` is affected unless strictly inside `circle`
        return d + o.r > circle.r + 1e-4;
      }
      if (o.turnRegion === 'outside') {
        // Interior turn on `circle` only crosses `o`'s rim if `circle` actually intersects `o`'s boundary
        return d + circle.r > o.r + 1e-4 && d < o.r + circle.r - 1e-4;
      }
      return d < o.r + circle.r - 1e-4;
    })
    .map((o) => o.id);
}

/**
 * "Next unblocked alignment" move (`A>` for CW, `A<` for CCW):
 * Turns circle `circleId` in `direction` (+1 CW, -1 CCW) to the `count`-th stop
 * where at least one overlapping neighboring circle becomes unblocked.
 */
export function turnCircleNextUnblocked(
  state: PuzzleState,
  circleId: string,
  direction: 1 | -1,
  count = 1,
  layerOpt?: MoveLayerSpec,
): MoveResult {
  const circle = getCircleDef(state.spec, circleId);
  if (!circle) {
    return {
      ok: false,
      circleId,
      blockingPieceIds: [],
      reason: `Unknown circle "${circleId}"`,
    };
  }

  const status = getCircleStatus(state, circleId, layerOpt);
  if (status.blocked) {
    return {
      ok: false,
      circleId,
      blockingPieceIds: status.blockingPieceIds,
      reason: `Circle ${circleId} is blocked by ${status.blockingPieceIds.length} piece${
        status.blockingPieceIds.length === 1 ? '' : 's'
      }`,
    };
  }

  const neighborIds = overlappingCircleIds(state.spec, circle);
  const neighborDefs = neighborIds
    .map((nid) => getCircleDef(state.spec, nid))
    .filter((c): c is CircleDef => c !== undefined);
  const curIdx = state.circleStopIndex[circleId] ?? 0;
  const nStops = circle.stopsDeg.length;
  const targetCount = Math.max(1, count);

  // Scan at most one full revolution (nStops); any larger `count` wraps periodically in O(1)
  const unblockedSteps: number[] = [];
  for (let step = 1; step <= nStops; step++) {
    const { deltaDeg, nextStopIdx } = computeStopDeltaDeg(circle, curIdx, direction * step);
    const candidate = turnCircleByAngle(
      state,
      circleId,
      deltaDeg,
      nextStopIdx,
      status.insidePieceIds,
      layerOpt,
    );
    if (!candidate.ok) return candidate;

    // A stop counts as an unblocked alignment if at least one overlapping neighbor is free
    // (or if there are no neighbors at all, every stop counts)
    const neighborFree =
      neighborDefs.length === 0 ||
      neighborDefs.some((nb) => !isCircleBlocked(candidate.nextState, nb));

    if (neighborFree) {
      unblockedSteps.push(step);
      if (unblockedSteps.length === targetCount) {
        return candidate;
      }
    }
  }

  if (unblockedSteps.length > 0) {
    const fullRevs = Math.floor((targetCount - 1) / unblockedSteps.length);
    const remStep = unblockedSteps[(targetCount - 1) % unblockedSteps.length];
    const totalSteps = fullRevs * nStops + remStep;
    const { deltaDeg, nextStopIdx } = computeStopDeltaDeg(circle, curIdx, direction * totalSteps);
    return turnCircleByAngle(
      state,
      circleId,
      deltaDeg,
      nextStopIdx,
      status.insidePieceIds,
      layerOpt,
    );
  }

  // If no stop unlocked any neighbor, advance by `count` stops so the move still works predictably
  const fallback = computeStopDeltaDeg(circle, curIdx, direction * targetCount);
  return turnCircleByAngle(
    state,
    circleId,
    fallback.deltaDeg,
    fallback.nextStopIdx,
    status.insidePieceIds,
    layerOpt,
  );
}

/**
 * Whole-puzzle rotation (`z` = +1 symmetry step CW, `z'` = -1 step CCW).
 * Physically rotates all pieces CW by `steps * symmetryStepDeg` around the
 * symmetry center so spatial circle labels (A, B, C, ...) stay fixed on screen.
 */
export function rotateWholePuzzle(state: PuzzleState, steps: number): MoveResult {
  if (!state.spec.symmetryStepDeg || state.spec.symmetryStepDeg <= 0) {
    return {
      ok: false,
      circleId: 'z',
      blockingPieceIds: [],
      reason: `${state.spec.name} has no rotational symmetry (z is unavailable)`,
    };
  }
  const symCenter = state.spec.symmetryCenter ?? { x: 0, y: 0 };
  const cwDeg = steps * state.spec.symmetryStepDeg;
  const geomCwDeg = cwDeg % 360;
  const rad = deg2rad(-geomCwDeg);

  const nextPieces: Piece[] =
    Math.abs(geomCwDeg) < 1e-9
      ? state.pieces
      : state.pieces.map((p) => ({
          ...p,
          region: rotateRegion(p.region, symCenter.x, symCenter.y, rad),
          stickers: rotateStickers(p.stickers, symCenter.x, symCenter.y, rad),
        }));

  // Map each circle's stop index to the matching spatial slot it rotated into (handling concentric axes)
  const nextStops: Record<string, number> = { ...state.circleStopIndex };
  for (const c of state.spec.circles) {
    const rotPos = rotatePoint({ x: c.cx, y: c.cy }, symCenter, rad);
    const dest = state.spec.circles.find(
      (o) =>
        pointsEqual({ x: o.cx, y: o.cy }, rotPos, 1e-3) &&
        Math.abs(o.r - c.r) <= 1e-3 &&
        (o.turnRegion ?? 'inside') === (c.turnRegion ?? 'inside') &&
        Boolean(o.discovered) === Boolean(c.discovered),
    );
    if (dest) {
      nextStops[dest.id] = state.circleStopIndex[c.id] ?? 0;
    }
  }

  return {
    ok: true,
    nextState: {
      ...state,
      pieces: nextPieces,
      circleStopIndex: nextStops,
      puzzleRotationDeg: (((state.puzzleRotationDeg + geomCwDeg) % 360) + 360) % 360,
    },
    angleDeg: Math.abs(cwDeg) > 720 ? geomCwDeg : cwDeg,
    movedPieceIds: state.pieces.map((p) => p.id),
    pivot: symCenter,
  };
}

function mirrorAngleDeg(deg: number): number {
  return (((360 - deg) % 360) + 360) % 360;
}

function findStopIndex(stopsDeg: number[], targetDeg: number): number {
  const norm = ((targetDeg % 360) + 360) % 360;
  for (let i = 0; i < stopsDeg.length; i++) {
    const s = ((stopsDeg[i] % 360) + 360) % 360;
    const diff = Math.abs(s - norm);
    if (diff < 1e-3 || Math.abs(diff - 360) < 1e-3) return i;
  }
  return -1;
}

function circlesMatchMirrored(
  a: CircleDef,
  b: CircleDef,
): boolean {
  if (Math.abs(a.r - b.r) > 1e-3) return false;
  if ((a.turnRegion ?? 'inside') !== (b.turnRegion ?? 'inside')) return false;
  if (Boolean(a.discovered) !== Boolean(b.discovered)) return false;
  const la = a.layerRadii ?? [];
  const lb = b.layerRadii ?? [];
  if (la.length !== lb.length) return false;
  for (let i = 0; i < la.length; i++) {
    if (Math.abs(la[i] - lb[i]) > 1e-3) return false;
  }
  if (a.stopsDeg.length !== b.stopsDeg.length) return false;
  for (const s of a.stopsDeg) {
    if (findStopIndex(b.stopsDeg, mirrorAngleDeg(s)) === -1) return false;
  }
  return true;
}

function mirrorPartnerMap(
  spec: PuzzleSpec,
  axis: MirrorAxis,
): Map<string, CircleDef> | null {
  const symCenter = spec.symmetryCenter ?? { x: 0, y: 0 };
  const map = new Map<string, CircleDef>();
  for (const c of spec.circles) {
    const refPos = reflectPoint({ x: c.cx, y: c.cy }, axis, symCenter);
    const dest = spec.circles.find(
      (o) => pointsEqual({ x: o.cx, y: o.cy }, refPos, 1e-3) && circlesMatchMirrored(c, o),
    );
    if (!dest) return null;
    map.set(c.id, dest);
  }
  return map;
}

function regionsGeometricallyEqual(a: ArcRegion, b: ArcRegion, eps = 2e-3): boolean {
  if (a.edges.length !== b.edges.length) return false;
  const used = new Uint8Array(b.edges.length);
  for (const ea of a.edges) {
    const ma = edgePointAt(ea, 0.5);
    let found = false;
    for (let j = 0; j < b.edges.length; j++) {
      if (used[j]) continue;
      const eb = b.edges[j];
      if (Math.abs(ea.r - eb.r) > eps || Math.abs(ea.sweep - eb.sweep) > eps) continue;
      const mb = edgePointAt(eb, 0.5);
      if (Math.hypot(ma.x - mb.x, ma.y - mb.y) <= eps) {
        used[j] = 1;
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

/**
 * Automatically detect which mirror axes ('x' = top↔bottom, 'y' = left↔right)
 * are exact geometric & cut-silhouette symmetries of a puzzle's solved state.
 */
export function detectMirrorAxes(spec: PuzzleSpec, pieces: Piece[]): MirrorAxis[] {
  const symCenter = spec.symmetryCenter ?? { x: 0, y: 0 };
  const origSimple = pieces.map((p) => ({
    region: simplifyRegion(p.region),
    area: p.area,
  }));
  const axes: MirrorAxis[] = [];

  for (const axis of ['x', 'y'] as const) {
    if (!mirrorPartnerMap(spec, axis)) continue;
    const used = new Uint8Array(origSimple.length);
    let allMatched = true;
    for (let i = 0; i < pieces.length; i++) {
      const refReg = simplifyRegion(reflectRegion(pieces[i].region, axis, symCenter.x, symCenter.y));
      const area = pieces[i].area;
      let matched = false;
      for (let j = 0; j < origSimple.length; j++) {
        if (used[j]) continue;
        if (Math.abs(origSimple[j].area - area) > 2e-3) continue;
        if (regionsGeometricallyEqual(refReg, origSimple[j].region, 3e-3)) {
          used[j] = 1;
          matched = true;
          break;
        }
      }
      if (!matched) {
        allMatched = false;
        break;
      }
    }
    if (allMatched) {
      axes.push(axis);
    }
  }
  return axes;
}

/** Return the supported mirror axes for a PuzzleState (computed once at build time). */
export function getSupportedMirrorAxes(state: PuzzleState): MirrorAxis[] {
  if (state.mirrorAxes !== undefined) return state.mirrorAxes;
  return detectMirrorAxes(state.spec, state.pieces);
}

/**
 * Whole-puzzle mirror flip:
 *   - `'x'`: 180° flip around the horizontal x-axis (top ↔ bottom)
 *   - `'y'`: 180° flip around the vertical y-axis (left ↔ right)
 * Spatial circle labels (A, B, C, ...) stay fixed on screen, allowing one macro
 * to handle both chiralities via `[x: myAlg]` or `[y: myAlg]`.
 */
export function flipWholePuzzle(state: PuzzleState, axis: MirrorAxis): MoveResult {
  const supported = getSupportedMirrorAxes(state);
  const partners = supported.includes(axis) ? mirrorPartnerMap(state.spec, axis) : null;
  if (!partners) {
    const axisName = axis === 'x' ? 'top↔bottom (x)' : 'left↔right (y)';
    return {
      ok: false,
      circleId: axis,
      blockingPieceIds: [],
      reason: `${state.spec.name} does not have ${axisName} mirror symmetry`,
    };
  }

  const symCenter = state.spec.symmetryCenter ?? { x: 0, y: 0 };
  const nextPieces: Piece[] = state.pieces.map((p) => ({
    ...p,
    region: reflectRegion(p.region, axis, symCenter.x, symCenter.y),
    stickers: reflectStickers(p.stickers, axis, symCenter),
  }));

  const nextStops: Record<string, number> = { ...state.circleStopIndex };
  for (const c of state.spec.circles) {
    const dest = partners.get(c.id)!;
    const curIdx = state.circleStopIndex[c.id] ?? 0;
    const curDeg = c.stopsDeg[curIdx] ?? 0;
    const mappedIdx = findStopIndex(dest.stopsDeg, mirrorAngleDeg(curDeg));
    nextStops[dest.id] = mappedIdx >= 0 ? mappedIdx : 0;
  }

  return {
    ok: true,
    nextState: {
      ...state,
      pieces: nextPieces,
      circleStopIndex: nextStops,
      puzzleFlipped: !(state.puzzleFlipped ?? false),
    },
    angleDeg: 180,
    movedPieceIds: state.pieces.map((p) => p.id),
    pivot: symCenter,
    flipAxis: axis,
  };
}

/**
 * Canonical snapped signature of a piece's multi-color orientation stickers
 * (empty string if the piece has no orientation stickers).
 */
export function pieceStickerKey(p: Piece): string {
  if (!p.stickers || p.stickers.length === 0) return '';
  return p.stickers
    .map((s) => {
      const m = edgePointAt(s.arc, 0.5);
      return `${snapFloat(m.x, 1e-3).toFixed(3)},${snapFloat(m.y, 1e-3).toFixed(3)}:${s.color}`;
    })
    .sort()
    .join(',');
}

const puzzleStateHashCache = new WeakMap<PuzzleState, string>();

/**
 * Canonical hash of the full puzzle state (piece silhouettes + colors),
 * invariant to piece array ordering and interchangeable same-color pieces.
 * Memoized per immutable PuzzleState.
 */
export function hashPuzzleState(state: PuzzleState): string {
  const cached = puzzleStateHashCache.get(state);
  if (cached !== undefined) return cached;
  const entries = state.pieces.map((p) => {
    let base = `${regionSilhouetteKey(p.region)}|${p.color}`;
    const sKey = pieceStickerKey(p);
    if (sKey) {
      base += `|S[${sKey}]`;
    }
    return base;
  });
  entries.sort();
  const h = entries.join('\n');
  puzzleStateHashCache.set(state, h);
  return h;
}

/**
 * Canonical hash of ONLY the cut/silhouette geometry (ignoring piece colors).
 * Used to detect when a macro is shape-preserving and acts as a pure permutation group element!
 */
export function hashPuzzleShape(state: PuzzleState): string {
  const entries = state.pieces.map((p) => regionSilhouetteKey(p.region));
  entries.sort();
  return entries.join('\n');
}

const solvedOrbitCache = new WeakMap<PuzzleState, Set<string>>();

function getSolvedOrbitHashes(solvedState: PuzzleState): Set<string> {
  const cached = solvedOrbitCache.get(solvedState);
  if (cached) return cached;

  const hashes = new Set<string>();
  const symStep = solvedState.spec.symmetryStepDeg;
  const symCount = symStep > 0 ? Math.round(360 / symStep) : 1;
  const mirrorAxes = getSupportedMirrorAxes(solvedState);

  const addRotations = (base: PuzzleState) => {
    let ref = base;
    for (let k = 0; k < symCount; k++) {
      hashes.add(hashPuzzleState(ref));
      if (k + 1 < symCount) {
        const rot = rotateWholePuzzle(ref, 1);
        if (rot.ok) ref = rot.nextState;
      }
    }
  };

  addRotations(solvedState);
  // Include mirrored solved states across every supported mirror axis (full dihedral orbit)
  for (const axis of mirrorAxes) {
    const flipped = flipWholePuzzle(solvedState, axis);
    if (flipped.ok) {
      addRotations(flipped.nextState);
    }
  }
  if (mirrorAxes.includes('x') && mirrorAxes.includes('y')) {
    const fx = flipWholePuzzle(solvedState, 'x');
    if (fx.ok) {
      const fxy = flipWholePuzzle(fx.nextState, 'y');
      if (fxy.ok) addRotations(fxy.nextState);
    }
  }

  solvedOrbitCache.set(solvedState, hashes);
  return hashes;
}

/**
 * Check if `state` is solved relative to `solvedState`, modulo whole-puzzle symmetry rotations.
 */
export function isPuzzleSolved(state: PuzzleState, solvedState: PuzzleState): boolean {
  return getSolvedOrbitHashes(solvedState).has(hashPuzzleState(state));
}

/**
 * Hash an arbitrary string or numeric seed into a deterministic unsigned 32-bit integer
 * (FNV-1a for strings, direct uint32 for integers).
 */
export function hashSeed(seed: string | number): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return (Math.floor(seed) >>> 0) || 1;
  }
  const str = String(seed).trim();
  if (/^\d+$/.test(str)) {
    const num = Number(str);
    if (Number.isSafeInteger(num)) return (num >>> 0) || 1;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) || 1;
}

/**
 * Deterministic-seedable legal scramble generator returning both the move string
 * and its exact resulting PuzzleState (avoiding redundant re-evaluation).
 * Prefers moves that leave at least 2 circles free so scrambles stay rich and deep.
 */
export function generateScrambleWithState(
  initialState: PuzzleState,
  moveCount = 24,
  seed?: number | string,
): { sequence: string; finalState: PuzzleState } {
  // Simple mulberry32 PRNG if seed provided, else Math.random
  let s =
    seed !== undefined && String(seed).trim() !== ''
      ? hashSeed(seed)
      : (Math.random() * 0xffffffff) >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Precompute circle adjacency once for the entire scramble
  const allCircles = initialState.spec.circles;
  const circleMap = new Map(allCircles.map((c) => [c.id, c]));
  const overlapMap = new Map<string, CircleDef[]>();
  const nonOverlapMap = new Map<string, string[]>();

  for (const c of allCircles) {
    const ovIds = new Set(overlappingCircleIds(initialState.spec, c));
    overlapMap.set(
      c.id,
      [...ovIds].map((id) => circleMap.get(id)!),
    );
    nonOverlapMap.set(
      c.id,
      allCircles.filter((o) => o.id !== c.id && !ovIds.has(o.id)).map((o) => o.id),
    );
  }

  const layerSpecsFor = (c: CircleDef): MoveLayerSpec[] => {
    if (!c.layerRadii || c.layerRadii.length <= 1) return [{}];
    const specs: MoveLayerSpec[] = [{ wide: true }];
    for (let l = 1; l <= c.layerRadii.length; l++) specs.push({ layer: l });
    return specs;
  };

  let cur = initialState;
  let lastCircle = '';
  let lastSteps = 0;
  const turnCounts = new Map<string, number>();
  for (const c of allCircles) turnCounts.set(c.id, 0);
  const tokens: string[] = [];

  // Maintain per-circle default-layer piece classifications (0 = outside, 1 = inside, 2 = straddling)
  // so each scramble step only re-classifies moved pieces on overlapping neighbors!
  const pieceCount = cur.pieces.length;
  const compiledBounds = new Map<string, CompiledLayerBounds>();
  const clsByCircle = new Map<string, Uint8Array>();
  const statuses: Record<string, CircleStatus> = {};

  const buildStatusFromCls = (
    cid: string,
    pieces: Piece[],
    clsArr: Uint8Array,
  ): CircleStatus => {
    const insidePieceIds: number[] = [];
    const blockingPieceIds: number[] = [];
    for (let pi = 0; pi < pieces.length; pi++) {
      const code = clsArr[pi];
      if (code === 1) insidePieceIds.push(pieces[pi].id);
      else if (code === 2) blockingPieceIds.push(pieces[pi].id);
    }
    return {
      circleId: cid,
      blocked: blockingPieceIds.length > 0,
      blockingPieceIds,
      insidePieceIds,
    };
  };

  for (const c of allCircles) {
    const cb = compileLayerBounds(c, resolveLayerBounds(c, undefined));
    compiledBounds.set(c.id, cb);
    const clsArr = new Uint8Array(pieceCount);
    for (let pi = 0; pi < pieceCount; pi++) {
      const cls = classifyRegionForBounds(cur.pieces[pi].region, c, cb);
      clsArr[pi] = cls === 'inside' ? 1 : cls === 'straddling' ? 2 : 0;
    }
    clsByCircle.set(c.id, clsArr);
    statuses[c.id] = buildStatusFromCls(c.id, cur.pieces, clsArr);
  }

  type CandidateMove = {
    cid: string;
    layerOpt: MoveLayerSpec;
    steps: number;
    deltaDeg: number;
    nextStopIdx: number;
    insideIds: number[];
    insideIndices: number[];
  };

  for (let i = 0; i < moveCount; i++) {
    // Order circles with inverse-frequency weighting (skipping lastCircle first) so all regions
    // of large/multi-ring puzzles get mixed evenly and we only evaluate moves until a circle
    // yields an overlapping-neighbor-preserving turn (Tier 1).
    const sortByWeightedRand = (list: CircleDef[]): CircleDef[] =>
      list
        .map((c) => {
          const cnt = turnCounts.get(c.id) ?? 0;
          const weight = 1 / ((1 + cnt) * (1 + cnt));
          const key = Math.pow(Math.max(rand(), 1e-12), 1 / weight);
          return { c, key };
        })
        .sort((a, b) => b.key - a.key)
        .map((entry) => entry.c);

    const otherCircles = allCircles.filter((c) => c.id !== lastCircle);
    const lastCircleList = allCircles.filter((c) => c.id === lastCircle);
    const orderedCircles = [...sortByWeightedRand(otherCircles), ...lastCircleList];

    let chosen: CandidateMove | null = null;
    const otherFreeMoves: CandidateMove[] = [];
    const fallbackMoves: CandidateMove[] = [];

    for (const c of orderedCircles) {
      const hasMultiLayer = Boolean(c.layerRadii && c.layerRadii.length > 1);
      if (!hasMultiLayer && statuses[c.id].blocked) continue;

      const n = c.stopsDeg.length;
      const maxHalf = Math.floor(n / 2);
      const curIdx = cur.circleStopIndex[c.id] ?? 0;
      const nonOverlappingOtherFree = nonOverlapMap
        .get(c.id)!
        .some((oid) => !statuses[oid].blocked);
      const neighbors = overlapMap.get(c.id)!;

      const overlapGood: CandidateMove[] = [];

      for (const layerOpt of layerSpecsFor(c)) {
        // Default status is already layer 1 (or single layer), so `{ layer: 1 }` reuses statuses[c.id]
        const isDefaultLayer =
          (!layerOpt.layer && !layerOpt.wide) || (layerOpt.layer === 1 && !layerOpt.wide);
        const layerStatus = isDefaultLayer
          ? statuses[c.id]
          : getCircleStatus(cur, c.id, layerOpt);
        if (layerStatus.blocked) continue;
        const insideIds = layerStatus.insidePieceIds;
        const insideSet = new Set(insideIds);
        const insideRegions: ArcRegion[] = [];
        const insideIndices: number[] = [];
        if (isDefaultLayer) {
          const cCls = clsByCircle.get(c.id)!;
          for (let pi = 0; pi < pieceCount; pi++) {
            if (cCls[pi] === 1) {
              insideIndices.push(pi);
              insideRegions.push(cur.pieces[pi].region);
            }
          }
        } else {
          for (let pi = 0; pi < pieceCount; pi++) {
            const p = cur.pieces[pi];
            if (insideSet.has(p.id)) {
              insideIndices.push(pi);
              insideRegions.push(p.region);
            }
          }
        }

        // Pre-filter neighbors: a neighbor `nb` can only be unblocked after rotating `insideSet`
        // if EVERY piece currently blocking `nb` belongs to `insideSet` (stationary pieces don't move!).
        const checkableNeighbors: CircleDef[] = [];
        for (const nb of neighbors) {
          const blockedOutside = statuses[nb.id].blockingPieceIds.some(
            (pid) => !insideSet.has(pid),
          );
          if (!blockedOutside) {
            checkableNeighbors.push(nb);
          }
        }

        for (let step = 1; step <= maxHalf; step++) {
          for (const dir of [1, -1]) {
            if (step === maxHalf && n % 2 === 0 && dir === -1) continue;
            const signedSteps = dir * step;
            if (c.id === lastCircle && signedSteps === -lastSteps) continue;

            const { deltaDeg, nextStopIdx } = computeStopDeltaDeg(c, curIdx, signedSteps);
            const cand: CandidateMove = {
              cid: c.id,
              layerOpt,
              steps: signedSteps,
              deltaDeg,
              nextStopIdx,
              insideIds,
              insideIndices,
            };

            let anyNeighborPlayable = false;
            if (checkableNeighbors.length > 0) {
              // Exact rigid isometry: rotating `insideRegions` by `-geomCwDeg` around `(c.cx, c.cy)`
              // and testing against `nb` is identical to keeping `insideRegions` unrotated and
              // inverse-rotating the single circle `nb` by `+geomCwDeg` around `(c.cx, c.cy)`!
              const invRad = deg2rad(deltaDeg % 360);
              const cos = Math.cos(invRad);
              const sin = Math.sin(invRad);

              for (let ni = 0; ni < checkableNeighbors.length; ni++) {
                const nb = checkableNeighbors[ni];
                const dx = nb.cx - c.cx;
                const dy = nb.cy - c.cy;
                const testR = nb.layerRadii && nb.layerRadii.length > 1 ? nb.layerRadii[0] : nb.r;
                const invCircle: Circle = {
                  cx: c.cx + dx * cos - dy * sin,
                  cy: c.cy + dx * sin + dy * cos,
                  r: testR,
                };
                let blocked = false;
                for (let ri = 0; ri < insideRegions.length; ri++) {
                  if (classifyRegionAgainstCircle(insideRegions[ri], invCircle) === 'straddling') {
                    blocked = true;
                    break;
                  }
                }
                if (!blocked) {
                  anyNeighborPlayable = true;
                  break;
                }
              }
            }

            if (anyNeighborPlayable) {
              overlapGood.push(cand);
            } else if (nonOverlappingOtherFree) {
              otherFreeMoves.push(cand);
            } else {
              fallbackMoves.push(cand);
            }
          }
        }
      }

      if (overlapGood.length > 0) {
        chosen = overlapGood[Math.floor(rand() * overlapGood.length)];
        break;
      }
    }

    if (!chosen) {
      const pool = otherFreeMoves.length > 0 ? otherFreeMoves : fallbackMoves;
      if (pool.length === 0) break;
      chosen = pool[Math.floor(rand() * pool.length)];
    }

    const applied = turnCircleByAngle(
      cur,
      chosen.cid,
      chosen.deltaDeg,
      chosen.nextStopIdx,
      chosen.insideIds,
      chosen.layerOpt,
    );
    if (!applied.ok) break;
    cur = applied.nextState;
    lastCircle = chosen.cid;
    lastSteps = chosen.steps;
    turnCounts.set(chosen.cid, (turnCounts.get(chosen.cid) ?? 0) + 1);
    tokens.push(formatMoveToken(chosen.cid, chosen.steps, chosen.layerOpt));

    // Incrementally refresh ONLY the moved pieces on overlapping neighbors!
    // `chosen.cid`'s own default-layer status is 100% invariant under concentric rotation,
    // and stationary pieces never change classification against any neighbor.
    if (i + 1 < moveCount) {
      const movedIndices = chosen.insideIndices;
      const neighbors = overlapMap.get(chosen.cid)!;
      for (let ni = 0; ni < neighbors.length; ni++) {
        const nb = neighbors[ni];
        const nbCls = clsByCircle.get(nb.id)!;
        const nbBounds = compiledBounds.get(nb.id)!;
        for (let mi = 0; mi < movedIndices.length; mi++) {
          const pi = movedIndices[mi];
          const cls = classifyRegionForBounds(cur.pieces[pi].region, nb, nbBounds);
          nbCls[pi] = cls === 'inside' ? 1 : cls === 'straddling' ? 2 : 0;
        }
        statuses[nb.id] = buildStatusFromCls(nb.id, cur.pieces, nbCls);
      }
    }
  }

  return { sequence: tokens.join(' '), finalState: cur };
}

/**
 * Deterministic-seedable legal scramble generator.
 * Prefers moves that leave at least 2 circles free so scrambles stay rich and deep.
 */
export function generateScramble(
  initialState: PuzzleState,
  moveCount = 24,
  seed?: number | string,
): string {
  return generateScrambleWithState(initialState, moveCount, seed).sequence;
}

/** Format a circle move into standard Twizzle-style notation (e.g. `A`, `A2`, `A'`, `a`, `a2'`, `2A`, `2A3'`). */
export function formatMoveToken(
  circleId: string,
  steps: number,
  layerOpt?: MoveLayerSpec,
): string {
  const abs = Math.abs(steps);
  const prime = steps < 0 ? "'" : '';
  const stepStr = abs === 1 ? '' : String(abs);
  if (layerOpt?.wide) {
    const prefix = layerOpt.layer !== undefined ? String(layerOpt.layer) : '';
    return `${prefix}${circleId.toLowerCase()}${stepStr}${prime}`;
  }
  const prefix = layerOpt?.layer && layerOpt.layer > 1 ? String(layerOpt.layer) : '';
  return `${prefix}${circleId}${stepStr}${prime}`;
}
