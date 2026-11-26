import {
  ArcRegion,
  classifyRegionAgainstCircle,
  edgeEnd,
  edgePointAt,
  edgeStart,
  interiorPointOfRegion,
  pointInRegion,
  regionSignedArea,
  rotateRegion,
} from '../geom/arcRegion.ts';
import {
  Circle,
  Point,
  circlesEqual,
  deg2rad,
  dist,
  pointsEqual,
  rotatePoint,
} from '../geom/math.ts';
import { mergeRegions, sliceCircles, splitRegionByCircle } from '../geom/slicer.ts';
import { detectMirrorAxes } from './engine.ts';
import {
  AtomicPieceInfo,
  CircleDef,
  Piece,
  PuzzleSpec,
  PuzzleState,
} from './types.ts';

function buildAtomicInfo(
  region: ArcRegion,
  circles: CircleDef[],
  symCenter: Point,
): AtomicPieceInfo {
  const interiorPoint = interiorPointOfRegion(region);
  const memberCircles = circles
    .filter((c) => classifyRegionAgainstCircle(region, c) === 'inside')
    .map((c) => c.id);
  return {
    region,
    interiorPoint,
    area: regionSignedArea(region.edges),
    memberCircles,
    radialDist: dist(interiorPoint, symCenter),
  };
}

/** Check if two ArcRegions share a boundary edge (opposite twin arc). */
function regionsShareBoundary(a: ArcRegion, b: ArcRegion, eps = 1e-4): boolean {
  for (const ea of a.edges) {
    const as = edgeStart(ea);
    const ae = edgeEnd(ea);
    const am = edgePointAt(ea, 0.5);
    for (const eb of b.edges) {
      if (!circlesEqual(ea, eb, eps)) continue;
      if (Math.sign(ea.sweep) !== -Math.sign(eb.sweep)) continue;
      if (
        pointsEqual(as, edgeEnd(eb), eps) &&
        pointsEqual(ae, edgeStart(eb), eps) &&
        pointsEqual(am, edgePointAt(eb, 0.5), eps)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Default color assignment:
 * - Pieces inside ALL circles (e.g. central pentagon) => crisp cream/light neutral
 * - Pieces inside exactly 1 circle => that circle's home color
 * - Pieces inside 2+ circles => color of the circle whose center is nearest to
 *   the piece's interior point (clean, crisp Voronoi-style petal coloring!)
 */
export function defaultAssignColor(
  info: AtomicPieceInfo,
  circles: CircleDef[],
): string {
  if (info.memberCircles.length === circles.length && circles.length >= 3) {
    return '#f1f5f9';
  }
  if (info.memberCircles.length === 1) {
    const c = circles.find((x) => x.id === info.memberCircles[0]);
    if (c) return c.color;
  }
  // Pick nearest member circle center (with tie-breaking by circle order)
  const candidates =
    info.memberCircles.length > 0
      ? circles.filter((c) => info.memberCircles.includes(c.id))
      : circles;
  let best = candidates[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const d = dist(info.interiorPoint, { x: c.cx, y: c.cy });
    if (d < bestD - 1e-5) {
      bestD = d;
      best = c;
    }
  }
  return best.color;
}

/**
 * Construct the initial (solved) PuzzleState from a declarative PuzzleSpec.
 */
export function buildPuzzle(spec: PuzzleSpec): PuzzleState {
  const symCenter: Point = spec.symmetryCenter ?? { x: 0, y: 0 };
  const circles = spec.circles;
  const circleMap = new Map(circles.map((c) => [c.id, c]));

  if (spec.customBuilder) {
    const pieces = spec.customBuilder(spec);
    const circleStopIndex: Record<string, number> = {};
    for (const c of circles) {
      circleStopIndex[c.id] = 0;
    }
    return {
      spec,
      pieces,
      circleStopIndex,
      puzzleRotationDeg: 0,
      mirrorAxes: detectMirrorAxes(spec, pieces),
    };
  }

  // 1. Base planar subdivision of all puzzle circles
  let regions: ArcRegion[] = sliceCircles(circles);

  // 2. Orbit-slicing passes: simulate rotating circles to cut outer/overlap regions
  if (spec.orbitSlices) {
    for (const step of spec.orbitSlices) {
      const passes = step.passes ?? 1;
      const targetIds = step.circleIds ?? circles.map((c) => c.id);
      const maxMem = step.maxMemberCircles ?? circles.length;

      for (let pass = 0; pass < passes; pass++) {
        if (step.nonChaining) {
          // Collect all virtual cuts (other circle rotated around home circle by +deg,
          // which is the inverse of rotating pieces CW by -deg) before slicing.
          const virtualCuts: { home: CircleDef; cutter: Circle }[] = [];
          for (const cid of targetIds) {
            const home = circleMap.get(cid);
            if (!home) continue;
            for (const deg of step.anglesDeg) {
              const rad = deg2rad(deg);
              const cos = Math.cos(rad);
              const sin = Math.sin(rad);
              for (const other of circles) {
                if (other.id === home.id) continue;
                const dx = other.cx - home.cx;
                const dy = other.cy - home.cy;
                virtualCuts.push({
                  home,
                  cutter: {
                    cx: home.cx + dx * cos - dy * sin,
                    cy: home.cy + dx * sin + dy * cos,
                    r: other.r,
                  },
                });
              }
            }
          }

          // Tag each base region with its initial membership count so maxMem applies cleanly
          let tagged = regions.map((reg) => ({
            reg,
            memCount: circles.filter((c) => classifyRegionAgainstCircle(reg, c) === 'inside')
              .length,
          }));

          for (const vc of virtualCuts) {
            const nextTagged: typeof tagged = [];
            for (const item of tagged) {
              if (
                item.memCount <= maxMem &&
                classifyRegionAgainstCircle(item.reg, vc.home) === 'inside'
              ) {
                const parts = splitRegionByCircle(item.reg, vc.cutter);
                for (const p of parts) {
                  nextTagged.push({ reg: p, memCount: item.memCount });
                }
              } else {
                nextTagged.push(item);
              }
            }
            tagged = nextTagged;
          }
          regions = tagged.map((t) => t.reg);
        } else {
          for (const cid of targetIds) {
            const targetCircle = circleMap.get(cid);
            if (!targetCircle) continue;

            for (const deg of step.anglesDeg) {
              const rad = deg2rad(-deg); // CW rotation
              const nextRegions: ArcRegion[] = [];

              for (const reg of regions) {
                const memCount = circles.filter(
                  (c) => classifyRegionAgainstCircle(reg, c) === 'inside',
                ).length;
                if (
                  memCount > maxMem ||
                  classifyRegionAgainstCircle(reg, targetCircle) !== 'inside'
                ) {
                  nextRegions.push(reg);
                  continue;
                }
                let parts: ArcRegion[] = [
                  rotateRegion(reg, targetCircle.cx, targetCircle.cy, rad),
                ];
                for (const other of circles) {
                  if (other.id === targetCircle.id) continue;
                  const splitParts: ArcRegion[] = [];
                  for (const p of parts) {
                    splitParts.push(...splitRegionByCircle(p, other));
                  }
                  parts = splitParts;
                }
                for (const p of parts) {
                  nextRegions.push(
                    rotateRegion(p, targetCircle.cx, targetCircle.cy, -rad),
                  );
                }
              }
              regions = nextRegions;
            }
          }
        }
      }
    }
  }

  // 3. Explicit virtual cutting circles (e.g. targeted unbandaging cuts)
  if (spec.extraCuts) {
    const symCount =
      spec.symmetryStepDeg > 0 ? Math.round(360 / spec.symmetryStepDeg) : 1;

    for (const cut of spec.extraCuts) {
      const reps = cut.symmetric ? symCount : 1;
      for (let k = 0; k < reps; k++) {
        const rotRad = deg2rad(-k * spec.symmetryStepDeg);
        const rotCenter = rotatePoint(
          { x: cut.circle.cx, y: cut.circle.cy },
          symCenter,
          rotRad,
        );
        const cutCircle: Circle = {
          cx: rotCenter.x,
          cy: rotCenter.y,
          r: cut.circle.r,
        };

        // If restricted to a specific circle ID, rotate that restriction too
        let allowedCircle: Circle | null = null;
        if (cut.onlyInsideCircleId) {
          const baseC = circleMap.get(cut.onlyInsideCircleId);
          if (baseC) {
            const rc = rotatePoint({ x: baseC.cx, y: baseC.cy }, symCenter, rotRad);
            allowedCircle = { cx: rc.x, cy: rc.y, r: baseC.r };
          }
        }

        const nextRegions: ArcRegion[] = [];
        for (const reg of regions) {
          if (
            allowedCircle &&
            classifyRegionAgainstCircle(reg, allowedCircle) !== 'inside'
          ) {
            nextRegions.push(reg);
            continue;
          }
          nextRegions.push(...splitRegionByCircle(reg, cutCircle));
        }
        regions = nextRegions;
      }
    }
  }

  // 4. Declarative bandaging by explicit point groups
  if (spec.bandages && spec.bandages.length > 0) {
    const symCount =
      spec.symmetryStepDeg > 0 ? Math.round(360 / spec.symmetryStepDeg) : 1;

    for (const b of spec.bandages) {
      const reps = b.symmetric ? symCount : 1;
      for (let k = 0; k < reps; k++) {
        const rotRad = deg2rad(-k * spec.symmetryStepDeg);
        const pts = b.points.map((p) => rotatePoint(p, symCenter, rotRad));
        const matchedIdx = new Set<number>();
        for (const pt of pts) {
          const idx = regions.findIndex((r) => pointInRegion(pt, r));
          if (idx !== -1) matchedIdx.add(idx);
        }
        if (matchedIdx.size >= 2) {
          const toMerge: ArcRegion[] = [];
          const keep: ArcRegion[] = [];
          regions.forEach((r, idx) => {
            if (matchedIdx.has(idx)) toMerge.push(r);
            else keep.push(r);
          });
          regions = [...keep, ...mergeRegions(toMerge)];
        }
      }
    }
  }

  // 5. Predicate-based bandaging (merge adjacent connected components matching predicate)
  if (spec.bandagePredicates && spec.bandagePredicates.length > 0) {
    for (const bp of spec.bandagePredicates) {
      const infos = regions.map((r) => buildAtomicInfo(r, circles, symCenter));
      const matching = infos
        .map((info, idx) => ({ info, idx }))
        .filter(({ info }) => bp.predicate(info));

      // Connected components among matching regions that share a boundary edge
      const visited = new Set<number>();
      const keep: ArcRegion[] = [];
      const matchingIdxSet = new Set(matching.map((m) => m.idx));

      regions.forEach((r, idx) => {
        if (!matchingIdxSet.has(idx)) keep.push(r);
      });

      for (const { idx } of matching) {
        if (visited.has(idx)) continue;
        const comp: number[] = [];
        const queue = [idx];
        visited.add(idx);
        while (queue.length > 0) {
          const cur = queue.shift()!;
          comp.push(cur);
          for (const { idx: other } of matching) {
            if (visited.has(other)) continue;
            if (regionsShareBoundary(regions[cur], regions[other])) {
              visited.add(other);
              queue.push(other);
            }
          }
        }
        const merged = mergeRegions(comp.map((i) => regions[i]));
        keep.push(...merged);
      }

      regions = keep;
    }
  }

  // 6. Build final Piece objects with colors
  const colorCtx = { circles, symmetryCenter: symCenter };
  const pieces: Piece[] = regions.map((region, id) => {
    const info = buildAtomicInfo(region, circles, symCenter);
    const color = spec.assignColor
      ? spec.assignColor(info, colorCtx)
      : defaultAssignColor(info, circles);
    return {
      id,
      region,
      color,
      homeColor: color,
      area: info.area,
    };
  });

  const circleStopIndex: Record<string, number> = {};
  for (const c of circles) {
    circleStopIndex[c.id] = 0;
  }

  return {
    spec,
    pieces,
    circleStopIndex,
    puzzleRotationDeg: 0,
    mirrorAxes: detectMirrorAxes(spec, pieces),
  };
}
