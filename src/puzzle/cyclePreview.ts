import {
  ArcRegion,
  edgePointAt,
  edgeStart,
  interiorPointOfRegion,
  pointInRegion,
  regionSignedArea,
  regionSilhouetteKey,
} from '../geom/arcRegion.ts';
import { Point, dist } from '../geom/math.ts';
import { MacroLibraryEntry, evaluateProgram } from '../lang/evaluator.ts';
import { pieceStickerKey } from './engine.ts';
import { Piece, PuzzleState } from './types.ts';

export interface CycleArrow {
  pieceId: number;
  from: Point;
  to: Point;
  area: number;
  shapeType: string;
  cycleIndex: number;
  color: string;
  /** True only in focus-picking mode for piece types not currently in the macro's focus set. */
  dimmed?: boolean;
}

export interface CycleSpin {
  pieceId: number;
  point: Point;
  area: number;
  shapeType: string;
  /** Signed CW rotation angle in degrees within (-180, 180] (positive = CW, negative = CCW). */
  angleDeg: number;
  color: string;
  /** True only in focus-picking mode when this piece type is not in the macro's focus set. */
  dimmed?: boolean;
}

export interface MovedPieceTypeSummary {
  shapeType: string;
  count: number;
  sampleRegion: ArcRegion;
  sampleArea: number;
  hasArrows: boolean;
  hasSpins: boolean;
}

export interface CyclePreviewOptions {
  /** Optional congruent piece shape-type IDs selecting which piece types to highlight. */
  focusTypes?: string[];
  /**
   * When true (interactive focus-picking mode), non-focused piece types are kept with
   * `dimmed: true` so the user can see and click them to toggle focus; when false (normal hover),
   * non-focused piece types are fully hidden.
   */
  includeDimmed?: boolean;
}

export interface CyclePreviewResult {
  ok: boolean;
  label: string;
  arrows: CycleArrow[];
  spins: CycleSpin[];
  /** Distinct congruent piece shapes affected (moved or rotated in place) by this macro, largest first. */
  pieceTypes: MovedPieceTypeSummary[];
  cycleLengths: number[];
  totalMoved: number;
  hiddenCount: number;
  summary: string;
  blocked?: {
    circleId: string;
    blockingPieceIds: number[];
    moveLabel: string;
  };
}

const CYCLE_COLORS = [
  '#38bdf8', // sky cyan
  '#fbbf24', // amber
  '#f472b6', // pink
  '#4ade80', // emerald
  '#c084fc', // violet
  '#fb923c', // orange
];

function fnv1aHex(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

function minCyclicSerialization(tokens: string[]): string {
  const n = tokens.length;
  if (n === 0) return '';
  let best: string | null = null;
  for (let start = 0; start < n; start++) {
    let s = '';
    for (let k = 0; k < n; k++) {
      if (k > 0) s += ';';
      s += tokens[(start + k) % n];
    }
    if (best === null || s < best) best = s;
  }
  return best ?? '';
}

/**
 * Compute a compact, rotation- and mirror-reflection-invariant shape-type ID for an ArcRegion.
 * Two geometrically congruent pieces (regardless of position, orientation, chirality, or color)
 * always produce the exact same ID.
 */
export function pieceShapeType(region: ArcRegion): string {
  const n = region.edges.length;
  const area = Math.abs(regionSignedArea(region.edges));
  const areaQ = Math.round(area * 1000);
  // Quantize each arc's radius and signed sweep (both preserved under rotation and reflectRegion)
  const fwd = region.edges.map((e) => {
    const rQ = Math.round(e.r * 100);
    const sQ = Math.round(e.sweep * 100);
    return `${rQ},${sQ}`;
  });
  const rev = [...fwd].reverse();
  const minFwd = minCyclicSerialization(fwd);
  const minRev = minCyclicSerialization(rev);
  const canonical = minFwd < minRev ? minFwd : minRev;
  return `n${n}_a${areaQ}_${fnv1aHex(canonical)}`;
}

/**
 * Rotation-invariant visual center for a piece: uses the average of arc endpoints
 * and midpoints when strictly inside the region (so rotating a symmetric piece
 * in place never jitters its anchor), falling back to `interiorPointOfRegion`
 * for thin concave crescents.
 */
function pieceVisualCenter(region: ArcRegion): Point {
  if (region.edges.length > 0) {
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (const e of region.edges) {
      const p0 = edgeStart(e);
      const pm = edgePointAt(e, 0.5);
      sx += p0.x + pm.x;
      sy += p0.y + pm.y;
      count += 2;
    }
    const candidate = { x: sx / count, y: sy / count };
    if (pointInRegion(candidate, region)) {
      return candidate;
    }
  }
  return interiorPointOfRegion(region);
}

/**
 * Compute exact signed CW rotation angle in degrees within (-180, 180]
 * for a multi-stickered piece that rotated in place.
 */
function computeStickerSpinCwDeg(pBefore: Piece, pAfter: Piece, center: Point): number {
  const s0 = pBefore.stickers?.[0];
  const s1 = pAfter.stickers?.[0];
  if (!s0 || !s1) return 0;
  const m0 = edgePointAt(s0.arc, 0.5);
  const m1 = edgePointAt(s1.arc, 0.5);
  const a0 = Math.atan2(m0.y - center.y, m0.x - center.x);
  const a1 = Math.atan2(m1.y - center.y, m1.x - center.x);
  // Math coords are +y up (CCW positive), so CW degrees = -(a1 - a0)
  let cwDeg = (-(a1 - a0) * 180) / Math.PI;
  cwDeg = (((cwDeg % 360) + 540) % 360) - 180;
  const rounded = Math.round(cwDeg);
  if (rounded === -180) return 180;
  return rounded;
}

export function formatSpinAngle(angleDeg: number): string {
  const abs = Math.abs(Math.round(angleDeg));
  if (abs === 180) return '↻ 180°';
  return angleDeg >= 0 ? `↻ ${abs}°` : `↺ ${abs}°`;
}

/** Toggle a single `shapeType` in a macro's `focusTypes` list. */
export function toggleFocusType(
  currentTypes: string[] | undefined,
  shapeType: string,
): string[] {
  const list = currentTypes ? [...currentTypes] : [];
  if (list.includes(shapeType)) {
    return list.filter((t) => t !== shapeType);
  }
  return [...list, shapeType];
}

/**
 * Resolve a math-coordinate click `pt` on the puzzle to a piece shape type affected by `fullPreview`
 * and toggle that shape type in `currentTypes`. Returns `null` if `pt` did not hit any affected type.
 */
export function toggleFocusTypeAtPoint(
  currentTypes: string[] | undefined,
  state: PuzzleState,
  fullPreview: CyclePreviewResult,
  pt: Point,
): string[] | null {
  const affectedTypes = new Set(fullPreview.pieceTypes.map((t) => t.shapeType));
  if (affectedTypes.size === 0) return null;

  // 1. Exact piece containment: clicking any piece whose congruent shape type is affected toggles that type
  for (const p of state.pieces) {
    if (!pointInRegion(pt, p.region)) continue;
    const st = pieceShapeType(p.region);
    if (affectedTypes.has(st)) {
      return toggleFocusType(currentTypes, st);
    }
  }

  // 2. Fallback: nearest arrow start/end or spin point within 0.14 math units
  let bestDist = 0.14;
  let bestType: string | null = null;
  for (const a of fullPreview.arrows) {
    const d = Math.min(dist(pt, a.from), dist(pt, a.to));
    if (d < bestDist) {
      bestDist = d;
      bestType = a.shapeType;
    }
  }
  for (const s of fullPreview.spins) {
    const d = dist(pt, s.point);
    if (d < bestDist) {
      bestDist = d;
      bestType = s.shapeType;
    }
  }
  return bestType ? toggleFocusType(currentTypes, bestType) : null;
}

/**
 * Evaluate a macro or algorithm from `state` and extract piece-movement arrows
 * grouped by permutation cycle (plus exact in-place sticker rotations) for live hover previews.
 */
export function computeMacroCyclePreview(
  state: PuzzleState,
  algSource: string,
  macros: MacroLibraryEntry[],
  label = '',
  options: CyclePreviewOptions = {},
): CyclePreviewResult {
  const ev = evaluateProgram(state, algSource, macros);
  if (ev.parseErrors.length > 0 || ev.runtimeError) {
    return {
      ok: false,
      label,
      arrows: [],
      spins: [],
      pieceTypes: [],
      cycleLengths: [],
      totalMoved: 0,
      hiddenCount: 0,
      summary: ev.parseErrors[0]?.message ?? ev.runtimeError?.message ?? 'Invalid algorithm',
    };
  }
  if (ev.blocked) {
    return {
      ok: true,
      label,
      arrows: [],
      spins: [],
      pieceTypes: [],
      cycleLengths: [],
      totalMoved: 0,
      hiddenCount: 0,
      summary: `Blocked at ${ev.blocked.moveLabel}`,
      blocked: {
        circleId: ev.blocked.circleId,
        blockingPieceIds: ev.blocked.blockingPieceIds,
        moveLabel: ev.blocked.moveLabel,
      },
    };
  }

  const afterById = new Map(ev.finalState.pieces.map((p) => [p.id, p]));
  const moved: {
    pieceId: number;
    from: Point;
    to: Point;
    area: number;
    shapeType: string;
    region: ArcRegion;
    fromKey: string;
    toKey: string;
  }[] = [];
  const allSpins: CycleSpin[] = [];
  const typeMap = new Map<string, MovedPieceTypeSummary>();

  const recordType = (
    shapeType: string,
    region: ArcRegion,
    area: number,
    kind: 'arrow' | 'spin',
  ) => {
    const existing = typeMap.get(shapeType);
    if (existing) {
      existing.count++;
      if (kind === 'arrow') existing.hasArrows = true;
      else existing.hasSpins = true;
    } else {
      typeMap.set(shapeType, {
        shapeType,
        count: 1,
        sampleRegion: region,
        sampleArea: area,
        hasArrows: kind === 'arrow',
        hasSpins: kind === 'spin',
      });
    }
  };

  for (const pBefore of state.pieces) {
    const pAfter = afterById.get(pBefore.id);
    if (!pAfter) continue;
    const fromKey = regionSilhouetteKey(pBefore.region);
    const toKey = regionSilhouetteKey(pAfter.region);
    const from = pieceVisualCenter(pBefore.region);

    if (fromKey === toKey) {
      // Piece remained in the exact same geometric slot: only flag an in-place
      // rotation if it has distinguishable orientation stickers that actually changed.
      if (
        pBefore.stickers &&
        pBefore.stickers.length > 0 &&
        pieceStickerKey(pBefore) !== pieceStickerKey(pAfter)
      ) {
        const angleDeg = computeStickerSpinCwDeg(pBefore, pAfter, from);
        if (angleDeg !== 0) {
          const shapeType = pieceShapeType(pBefore.region);
          allSpins.push({
            pieceId: pBefore.id,
            point: from,
            area: pBefore.area,
            shapeType,
            angleDeg,
            color: '#facc15',
          });
          recordType(shapeType, pBefore.region, pBefore.area, 'spin');
        }
      }
      continue;
    }

    const to = pieceVisualCenter(pAfter.region);
    if (dist(from, to) > 1e-3) {
      const shapeType = pieceShapeType(pBefore.region);
      moved.push({
        pieceId: pBefore.id,
        from,
        to,
        area: pBefore.area,
        shapeType,
        region: pBefore.region,
        fromKey,
        toKey,
      });
      recordType(shapeType, pBefore.region, pBefore.area, 'arrow');
    } else if (
      pBefore.stickers &&
      pBefore.stickers.length > 0 &&
      pieceStickerKey(pBefore) !== pieceStickerKey(pAfter)
    ) {
      const angleDeg = computeStickerSpinCwDeg(pBefore, pAfter, from);
      if (angleDeg !== 0) {
        const shapeType = pieceShapeType(pBefore.region);
        allSpins.push({
          pieceId: pBefore.id,
          point: from,
          area: pBefore.area,
          shapeType,
          angleDeg,
          color: '#facc15',
        });
        recordType(shapeType, pBefore.region, pBefore.area, 'spin');
      }
    }
  }

  const pieceTypes = Array.from(typeMap.values()).sort((a, b) => b.sampleArea - a.sampleArea);

  if (moved.length === 0 && allSpins.length === 0) {
    return {
      ok: true,
      label,
      arrows: [],
      spins: [],
      pieceTypes: [],
      cycleLengths: [],
      totalMoved: 0,
      hiddenCount: 0,
      summary: 'No visible effect (identity)',
    };
  }

  // Group moved pieces into closed permutation cycles when destinations match starting slots
  const fromKeyToIdx = new Map<string, number>();
  for (let i = 0; i < moved.length; i++) {
    if (!fromKeyToIdx.has(moved[i].fromKey)) {
      fromKeyToIdx.set(moved[i].fromKey, i);
    }
  }

  const nextIdx = new Array<number>(moved.length).fill(-1);
  for (let i = 0; i < moved.length; i++) {
    const exact = fromKeyToIdx.get(moved[i].toKey);
    if (exact !== undefined && exact !== i) {
      nextIdx[i] = exact;
      continue;
    }
    let bestJ = -1;
    let bestD = 0.05;
    for (let j = 0; j < moved.length; j++) {
      if (j === i) continue;
      const d = dist(moved[i].to, moved[j].from);
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    nextIdx[i] = bestJ;
  }

  const cycleOf = new Array<number>(moved.length).fill(-1);
  const closedCycleIds = new Set<number>();
  const cycleLenById = new Map<number, number>();
  const cycleLengths: number[] = [];
  let nextCycleId = 0;

  // First trace closed cycles
  for (let i = 0; i < moved.length; i++) {
    if (cycleOf[i] !== -1) continue;
    const path: number[] = [];
    const seenAt = new Map<number, number>();
    let cur = i;
    while (cur !== -1 && cycleOf[cur] === -1 && !seenAt.has(cur)) {
      seenAt.set(cur, path.length);
      path.push(cur);
      cur = nextIdx[cur];
    }
    if (cur !== -1 && seenAt.has(cur)) {
      const startPos = seenAt.get(cur)!;
      const cyc = path.slice(startPos);
      const cid = nextCycleId++;
      for (const idx of cyc) cycleOf[idx] = cid;
      closedCycleIds.add(cid);
      cycleLenById.set(cid, cyc.length);
      cycleLengths.push(cyc.length);
    }
  }

  // Group remaining open chains into weakly-connected components
  let hasOpenChain = false;
  const revAdj: number[][] = Array.from({ length: moved.length }, () => []);
  for (let i = 0; i < moved.length; i++) {
    if (nextIdx[i] !== -1) revAdj[nextIdx[i]].push(i);
  }
  for (let i = 0; i < moved.length; i++) {
    if (cycleOf[i] !== -1) continue;
    hasOpenChain = true;
    const cid = nextCycleId++;
    const stack = [i];
    let size = 0;
    while (stack.length > 0) {
      const u = stack.pop()!;
      if (cycleOf[u] !== -1) continue;
      cycleOf[u] = cid;
      size++;
      const nxt = nextIdx[u];
      if (nxt !== -1 && cycleOf[nxt] === -1) stack.push(nxt);
      for (const prev of revAdj[u]) {
        if (cycleOf[prev] === -1) stack.push(prev);
      }
    }
    cycleLenById.set(cid, size);
  }

  const allArrows: CycleArrow[] = moved.map((m, i) => {
    const cid = cycleOf[i];
    return {
      pieceId: m.pieceId,
      from: m.from,
      to: m.to,
      area: m.area,
      shapeType: m.shapeType,
      cycleIndex: cid,
      color: CYCLE_COLORS[cid % CYCLE_COLORS.length],
    };
  });

  // Apply per-macro piece-type focus filter when focusTypes are configured
  const focusTypes = options.focusTypes;
  const hasFocus = Boolean(focusTypes && focusTypes.length > 0);
  let arrows: CycleArrow[] = allArrows;
  let spins: CycleSpin[] = allSpins;
  let hiddenCount = 0;
  let activeClosedLens = cycleLengths;
  let activeHasOpen = hasOpenChain;
  let activeMovedCount = moved.length;

  if (hasFocus && focusTypes) {
    const focusSet = new Set(focusTypes);

    if (options.includeDimmed) {
      arrows = allArrows.map((a) =>
        focusSet.has(a.shapeType) ? a : { ...a, dimmed: true },
      );
      spins = allSpins.map((s) =>
        focusSet.has(s.shapeType) ? s : { ...s, dimmed: true },
      );
    } else {
      arrows = allArrows.filter((a) => focusSet.has(a.shapeType));
      spins = allSpins.filter((s) => focusSet.has(s.shapeType));
    }

    const visibleArrows = allArrows.filter((a) => focusSet.has(a.shapeType));
    const visibleSpins = allSpins.filter((s) => focusSet.has(s.shapeType));
    hiddenCount =
      (allArrows.length - visibleArrows.length) + (allSpins.length - visibleSpins.length);
    activeMovedCount = visibleArrows.length;

    // Count closed cycles whose members are all in the focused piece-type set
    const visibleCountByCycle = new Map<number, number>();
    for (const a of visibleArrows) {
      visibleCountByCycle.set(a.cycleIndex, (visibleCountByCycle.get(a.cycleIndex) ?? 0) + 1);
    }
    activeClosedLens = [];
    activeHasOpen = false;
    for (const [cid, count] of visibleCountByCycle.entries()) {
      const fullLen = cycleLenById.get(cid) ?? 0;
      if (closedCycleIds.has(cid) && count === fullLen) {
        activeClosedLens.push(fullLen);
      } else {
        activeHasOpen = true;
      }
    }
  }

  // Format crisp human summary
  const parts: string[] = [];
  if (activeClosedLens.length > 0 && !activeHasOpen) {
    const freq = new Map<number, number>();
    for (const len of activeClosedLens) freq.set(len, (freq.get(len) ?? 0) + 1);
    const sortedLens = Array.from(freq.keys()).sort((a, b) => b - a);
    for (const len of sortedLens) {
      const cnt = freq.get(len)!;
      parts.push(cnt > 1 ? `${cnt}× ${len}-cycle` : `${len}-cycle`);
    }
  } else if (activeMovedCount > 0) {
    parts.push(`${activeMovedCount} pcs shifted`);
  }

  const activeSpins = spins.filter((s) => !s.dimmed);
  if (activeSpins.length > 0) {
    parts.push(activeSpins.map((s) => formatSpinAngle(s.angleDeg)).join(', '));
  }

  if (parts.length === 0 && hiddenCount > 0) {
    parts.push('0 focused pcs');
  }

  let summary = parts.join(' + ');
  if (hiddenCount > 0 && !options.includeDimmed) {
    summary += ` (+${hiddenCount} hidden)`;
  }

  return {
    ok: true,
    label,
    arrows,
    spins,
    pieceTypes,
    cycleLengths: activeClosedLens,
    totalMoved: moved.length,
    hiddenCount,
    summary,
  };
}
