import {
  classifyRegionAgainstCircle,
  edgePointAt,
  regionSilhouetteKey,
  rotateRegion,
} from '../geom/arcRegion.ts';
import {
  deg2rad,
  dist,
  normAngle,
  pointsEqual,
  rotatePoint,
  snapFloat,
} from '../geom/math.ts';
import { CircleDef, Piece, PuzzleSpec, PuzzleState, StickerWedge } from './types.ts';

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

/**
 * Determine whether a circle is currently free to turn or blocked by straddling pieces.
 */
export function getCircleStatus(state: PuzzleState, circleId: string): CircleStatus {
  const circle = getCircleDef(state.spec, circleId);
  if (!circle) {
    return { circleId, blocked: true, blockingPieceIds: [], insidePieceIds: [] };
  }

  const blockingPieceIds: number[] = [];
  const insidePieceIds: number[] = [];

  for (const p of state.pieces) {
    const cls = classifyRegionAgainstCircle(p.region, circle);
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

/** Get status of every circle in the puzzle. */
export function getAllCircleStatuses(state: PuzzleState): Record<string, CircleStatus> {
  const out: Record<string, CircleStatus> = {};
  for (const c of state.spec.circles) {
    out[c.id] = getCircleStatus(state, c.id);
  }
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

  // General uneven stops: accumulate step-by-step around the sorted stops array
  let idx = ((currentStopIdx % n) + n) % n;
  let totalDeg = 0;
  const dir = steps >= 0 ? 1 : -1;
  const absSteps = Math.abs(steps);

  for (let s = 0; s < absSteps; s++) {
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
 * Fast short-circuiting check for whether `circle` has any straddling piece.
 */
function isCircleBlocked(state: PuzzleState, circle: CircleDef): boolean {
  for (const p of state.pieces) {
    if (classifyRegionAgainstCircle(p.region, circle) === 'straddling') {
      return true;
    }
  }
  return false;
}

/**
 * Rotate all pieces inside `circleId` clockwise by `cwDeg` degrees.
 * Optionally accepts precomputed `knownInsideIds` (when caller already verified the circle is free).
 */
export function turnCircleByAngle(
  state: PuzzleState,
  circleId: string,
  cwDeg: number,
  nextStopIdx?: number,
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

  let insidePieceIds = knownInsideIds;
  if (!insidePieceIds) {
    const status = getCircleStatus(state, circleId);
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
    insidePieceIds = status.insidePieceIds;
  }

  const insideSet = new Set(insidePieceIds);
  const rad = deg2rad(-cwDeg); // CW in +y-up math coords is negative angle

  const nextPieces: Piece[] = state.pieces.map((p) => {
    if (!insideSet.has(p.id)) return p;
    return {
      ...p,
      region: rotateRegion(p.region, circle.cx, circle.cy, rad),
      stickers: rotateStickers(p.stickers, circle.cx, circle.cy, rad),
    };
  });

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
    angleDeg: cwDeg,
    movedPieceIds: insidePieceIds,
    pivot: { x: circle.cx, y: circle.cy },
  };
}

/**
 * Turn circle `circleId` by `steps` discrete stops (+ = CW, - = CCW).
 */
export function turnCircleBySteps(
  state: PuzzleState,
  circleId: string,
  steps: number,
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
  return turnCircleByAngle(state, circleId, deltaDeg, nextStopIdx);
}

/**
 * Find circles that geometrically overlap with `circle`.
 */
function overlappingCircleIds(spec: PuzzleSpec, circle: CircleDef): string[] {
  return spec.circles
    .filter(
      (o) =>
        o.id !== circle.id &&
        dist({ x: o.cx, y: o.cy }, { x: circle.cx, y: circle.cy }) < o.r + circle.r - 1e-4,
    )
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

  const status = getCircleStatus(state, circleId);
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

  const neighbors = overlappingCircleIds(state.spec, circle);
  const nStops = circle.stopsDeg.length;
  let found = 0;

  for (let step = 1; step <= nStops * Math.max(1, count); step++) {
    const candidate = turnCircleBySteps(state, circleId, direction * step);
    if (!candidate.ok) return candidate;

    // A stop counts as an unblocked alignment if at least one overlapping neighbor is free
    // (or if there are no neighbors at all, every stop counts)
    const neighborFree =
      neighbors.length === 0 ||
      neighbors.some((nid) => !getCircleStatus(candidate.nextState, nid).blocked);

    if (neighborFree) {
      found++;
      if (found === count) {
        return candidate;
      }
    }
  }

  // If no stop unlocked any neighbor, advance by `count` stops so the move still works predictably
  return turnCircleBySteps(state, circleId, direction * count);
}

/**
 * Whole-puzzle rotation (`r` = +1 symmetry step CW, `r'` = -1 step CCW).
 * Physically rotates all pieces CW by `steps * symmetryStepDeg` around the
 * symmetry center so spatial circle labels (A, B, C, ...) stay fixed on screen.
 */
export function rotateWholePuzzle(state: PuzzleState, steps: number): MoveResult {
  if (!state.spec.symmetryStepDeg || state.spec.symmetryStepDeg <= 0) {
    return {
      ok: false,
      circleId: 'r',
      blockingPieceIds: [],
      reason: `${state.spec.name} has no rotational symmetry (r is unavailable)`,
    };
  }
  const symCenter = state.spec.symmetryCenter ?? { x: 0, y: 0 };
  const cwDeg = steps * state.spec.symmetryStepDeg;
  const rad = deg2rad(-cwDeg);

  const nextPieces: Piece[] = state.pieces.map((p) => ({
    ...p,
    region: rotateRegion(p.region, symCenter.x, symCenter.y, rad),
    stickers: rotateStickers(p.stickers, symCenter.x, symCenter.y, rad),
  }));

  // Map each circle's stop index to the spatial slot it rotated into
  const nextStops: Record<string, number> = { ...state.circleStopIndex };
  for (const c of state.spec.circles) {
    const rotPos = rotatePoint({ x: c.cx, y: c.cy }, symCenter, rad);
    const dest = state.spec.circles.find((o) =>
      pointsEqual({ x: o.cx, y: o.cy }, rotPos, 1e-3),
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
      puzzleRotationDeg: (((state.puzzleRotationDeg + cwDeg) % 360) + 360) % 360,
    },
    angleDeg: cwDeg,
    movedPieceIds: state.pieces.map((p) => p.id),
    pivot: symCenter,
  };
}

/**
 * Canonical hash of the full puzzle state (piece silhouettes + colors),
 * invariant to piece array ordering and interchangeable same-color pieces.
 */
export function hashPuzzleState(state: PuzzleState): string {
  const entries = state.pieces.map((p) => {
    let base = `${regionSilhouetteKey(p.region)}|${p.color}`;
    if (p.stickers && p.stickers.length > 0) {
      const sKeys = p.stickers
        .map((s) => {
          const m = edgePointAt(s.arc, 0.5);
          return `${snapFloat(m.x, 1e-3).toFixed(3)},${snapFloat(m.y, 1e-3).toFixed(3)}:${s.color}`;
        })
        .sort()
        .join(',');
      base += `|S[${sKeys}]`;
    }
    return base;
  });
  entries.sort();
  return entries.join('\n');
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

  let ref = solvedState;
  for (let k = 0; k < symCount; k++) {
    hashes.add(hashPuzzleState(ref));
    if (k + 1 < symCount) {
      const rot = rotateWholePuzzle(ref, 1);
      if (rot.ok) ref = rot.nextState;
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
 * Deterministic-seedable legal scramble generator.
 * Prefers moves that leave at least 2 circles free so scrambles stay rich and deep.
 */
export function generateScramble(
  initialState: PuzzleState,
  moveCount = 24,
  seed?: number | string,
): string {
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

  // Precompute circle adjacency once so scramble checks only re-test overlapping neighbors
  const circleMap = new Map(initialState.spec.circles.map((c) => [c.id, c]));
  const overlapMap = new Map<string, CircleDef[]>();
  const nonOverlapMap = new Map<string, string[]>();
  for (const c of initialState.spec.circles) {
    const ovIds = new Set(overlappingCircleIds(initialState.spec, c));
    overlapMap.set(
      c.id,
      [...ovIds].map((id) => circleMap.get(id)!),
    );
    nonOverlapMap.set(
      c.id,
      initialState.spec.circles
        .filter((o) => o.id !== c.id && !ovIds.has(o.id))
        .map((o) => o.id),
    );
  }

  let cur = initialState;
  let lastCircle = '';
  let lastSteps = 0;
  const tokens: string[] = [];

  for (let i = 0; i < moveCount; i++) {
    const statuses = getAllCircleStatuses(cur);
    const freeCircles = cur.spec.circles.filter(
      (c) => !statuses[c.id].blocked && c.id !== lastCircle,
    );
    const candidates =
      freeCircles.length > 0
        ? freeCircles
        : cur.spec.circles.filter((c) => !statuses[c.id].blocked);

    if (candidates.length === 0) break;

    // Collect legal (circle, steps) turns that keep at least one other circle unblocked
    const goodMoves: { cid: string; steps: number; next: PuzzleState }[] = [];
    const fallbackMoves: { cid: string; steps: number; next: PuzzleState }[] = [];

    for (const c of candidates) {
      const n = c.stopsDeg.length;
      const maxHalf = Math.floor(n / 2);
      const curIdx = cur.circleStopIndex[c.id] ?? 0;
      const insideIds = statuses[c.id].insidePieceIds;
      const nonOverlappingOtherFree = nonOverlapMap
        .get(c.id)!
        .some((oid) => !statuses[oid].blocked);
      const neighbors = overlapMap.get(c.id)!;

      for (let step = 1; step <= maxHalf; step++) {
        for (const dir of [1, -1]) {
          if (step === maxHalf && n % 2 === 0 && dir === -1) continue;
          const signedSteps = dir * step;
          if (c.id === lastCircle && signedSteps === -lastSteps) continue;

          const { deltaDeg, nextStopIdx } = computeStopDeltaDeg(c, curIdx, signedSteps);
          const res = turnCircleByAngle(cur, c.id, deltaDeg, nextStopIdx, insideIds);
          if (!res.ok) continue;

          const otherFree =
            nonOverlappingOtherFree ||
            neighbors.some((nb) => !isCircleBlocked(res.nextState, nb));

          if (otherFree) {
            goodMoves.push({ cid: c.id, steps: signedSteps, next: res.nextState });
          } else {
            fallbackMoves.push({ cid: c.id, steps: signedSteps, next: res.nextState });
          }
        }
      }
    }

    const pool = goodMoves.length > 0 ? goodMoves : fallbackMoves;
    if (pool.length === 0) break;

    const pick = pool[Math.floor(rand() * pool.length)];
    cur = pick.next;
    lastCircle = pick.cid;
    lastSteps = pick.steps;
    tokens.push(formatMoveToken(pick.cid, pick.steps));
  }

  return tokens.join(' ');
}

/** Format a circle move `(cid, steps)` into standard notation (e.g. `A`, `A2`, `A'`, `A3'`). */
export function formatMoveToken(circleId: string, steps: number): string {
  const abs = Math.abs(steps);
  const prime = steps < 0 ? "'" : '';
  return `${circleId}${abs === 1 ? '' : abs}${prime}`;
}
