import { interiorPointOfRegion, regionSilhouetteKey } from '../geom/arcRegion.ts';
import { Point, dist } from '../geom/math.ts';
import { MacroLibraryEntry, evaluateProgram } from '../lang/evaluator.ts';
import { pieceStickerKey } from './engine.ts';
import { PuzzleState } from './types.ts';

export interface CycleArrow {
  pieceId: number;
  from: Point;
  to: Point;
  cycleIndex: number;
  color: string;
}

export interface CycleSpin {
  pieceId: number;
  point: Point;
  color: string;
}

export interface CyclePreviewResult {
  ok: boolean;
  label: string;
  arrows: CycleArrow[];
  spins: CycleSpin[];
  cycleLengths: number[];
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

/**
 * Evaluate a macro or algorithm from `state` and extract piece-movement arrows
 * grouped by permutation cycle (plus in-place sticker rotations) for live hover previews.
 */
export function computeMacroCyclePreview(
  state: PuzzleState,
  algSource: string,
  macros: MacroLibraryEntry[],
  label = '',
): CyclePreviewResult {
  const ev = evaluateProgram(state, algSource, macros);
  if (ev.parseErrors.length > 0 || ev.runtimeError) {
    return {
      ok: false,
      label,
      arrows: [],
      spins: [],
      cycleLengths: [],
      summary: ev.parseErrors[0]?.message ?? ev.runtimeError?.message ?? 'Invalid algorithm',
    };
  }
  if (ev.blocked) {
    return {
      ok: true,
      label,
      arrows: [],
      spins: [],
      cycleLengths: [],
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
    fromKey: string;
    toKey: string;
  }[] = [];
  const spins: CycleSpin[] = [];

  for (const pBefore of state.pieces) {
    const pAfter = afterById.get(pBefore.id);
    if (!pAfter) continue;
    const from = interiorPointOfRegion(pBefore.region);
    const to = interiorPointOfRegion(pAfter.region);
    if (dist(from, to) > 1e-3) {
      moved.push({
        pieceId: pBefore.id,
        from,
        to,
        fromKey: regionSilhouetteKey(pBefore.region),
        toKey: regionSilhouetteKey(pAfter.region),
      });
    } else if (
      pBefore.stickers &&
      pBefore.stickers.length > 0 &&
      pieceStickerKey(pBefore) !== pieceStickerKey(pAfter)
    ) {
      spins.push({
        pieceId: pBefore.id,
        point: from,
        color: '#facc15',
      });
    }
  }

  if (moved.length === 0 && spins.length === 0) {
    return {
      ok: true,
      label,
      arrows: [],
      spins: [],
      cycleLengths: [],
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
    // Geometric fallback for slight numerical differences
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
      cycleLengths.push(cyc.length);
    }
  }

  // Assign any remaining open-chain / shape-changing moves to a shared group
  let openGroupId = -1;
  for (let i = 0; i < moved.length; i++) {
    if (cycleOf[i] === -1) {
      if (openGroupId === -1) openGroupId = nextCycleId++;
      cycleOf[i] = openGroupId;
    }
  }

  const arrows: CycleArrow[] = moved.map((m, i) => {
    const cid = cycleOf[i];
    return {
      pieceId: m.pieceId,
      from: m.from,
      to: m.to,
      cycleIndex: cid,
      color: CYCLE_COLORS[cid % CYCLE_COLORS.length],
    };
  });

  // Format crisp human summary (e.g. "3-cycle (3 pcs)", "2× 3-cycle + 2-cycle (8 pcs)")
  const parts: string[] = [];
  if (cycleLengths.length > 0 && openGroupId === -1) {
    const freq = new Map<number, number>();
    for (const len of cycleLengths) freq.set(len, (freq.get(len) ?? 0) + 1);
    const sortedLens = Array.from(freq.keys()).sort((a, b) => b - a);
    for (const len of sortedLens) {
      const cnt = freq.get(len)!;
      parts.push(cnt > 1 ? `${cnt}× ${len}-cycle` : `${len}-cycle`);
    }
  } else if (moved.length > 0) {
    parts.push(`${moved.length} pcs shifted`);
  }
  if (spins.length > 0) {
    parts.push(`${spins.length} rotated`);
  }

  return {
    ok: true,
    label,
    arrows,
    spins,
    cycleLengths,
    summary: parts.join(' + '),
  };
}
