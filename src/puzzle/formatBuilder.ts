import {
  ArcRegion,
  classifyRegionAgainstCircle,
  edgePointAt,
  interiorPointOfRegion,
  pointInRegion,
  regionSignedArea,
  rotateRegion,
} from '../geom/arcRegion.ts';
import { Circle, Point, deg2rad, dist, rotatePoint } from '../geom/math.ts';
import { mergeRegions, sliceCircles, splitRegionByCircle } from '../geom/slicer.ts';
import {
  ClosureMoveStep,
  ColoringRule,
  RegionFilter,
  RingTwistPuzzleDoc,
  evalNumExpr,
  registerPuzzleSourceDoc,
  resolveAxes,
  resolveAxisOrLayerRef,
  resolveCircleSources,
  resolveColorCircleRef,
  resolveParams,
} from './format.ts';
import { CircleDef, Piece, PuzzleSpec, StickerWedge } from './types.ts';

function splitAllByCircle(regions: ArcRegion[], circle: Circle, minArea = 1e-5): ArcRegion[] {
  const next: ArcRegion[] = [];
  for (const reg of regions) {
    if (classifyRegionAgainstCircle(reg, circle, 1e-4) === 'straddling') {
      const sp = splitRegionByCircle(reg, circle);
      if (sp && sp.length > 1) {
        for (const r of sp) {
          if (regionSignedArea(r.edges) > minArea) next.push(r);
        }
        continue;
      }
    }
    next.push(reg);
  }
  return next;
}

/**
 * Parse a simple move token inside a `closure` op:
 *   - "A", "A'", "A2", "A2'" -> inner cap (layer 1) or single-layer circle
 *   - "2A", "2A'"            -> outer annulus slice (layer 2)
 *   - "a", "a'", "a2"        -> wide full circle (all layers together)
 */
function parseClosureMoveToken(
  token: string,
  axisMap: Map<string, CircleDef>,
): {
  circle: CircleDef;
  innerR: number;
  outerR: number;
  turnRegion: 'inside' | 'outside';
  cwDeg: number;
} {
  const m = token.trim().match(/^(\d*)([A-Wa-w])(\d*)('?)$/);
  if (!m) throw new Error(`Invalid closure move token "${token}"`);
  const prefixLayer = m[1] ? parseInt(m[1], 10) : undefined;
  const rawLetter = m[2];
  const isWide = rawLetter >= 'a' && rawLetter <= 'w';
  const id = rawLetter.toUpperCase();
  const circle = axisMap.get(id);
  if (!circle) throw new Error(`Unknown axis "${id}" in closure move "${token}"`);

  const count = m[3] ? parseInt(m[3], 10) : 1;
  const steps = m[4] === "'" ? -count : count;
  const n = circle.stopsDeg.length;
  // Compute signed CW angle from stop 0
  let cwDeg: number;
  if (n === 0) {
    cwDeg = 0;
  } else {
    const idx = ((steps % n) + n) % n;
    const raw = circle.stopsDeg[idx] - circle.stopsDeg[0];
    cwDeg = steps >= 0 ? (raw === 0 && steps > 0 ? 360 : raw) : raw === 0 ? 0 : raw - 360;
  }

  const radii = circle.layerRadii && circle.layerRadii.length > 1 ? circle.layerRadii : null;
  if (!radii) {
    return {
      circle,
      innerR: 0,
      outerR: circle.r,
      turnRegion: circle.turnRegion ?? 'inside',
      cwDeg,
    };
  }
  if (isWide) {
    const idx =
      prefixLayer !== undefined ? Math.min(radii.length, Math.max(1, prefixLayer)) - 1 : radii.length - 1;
    return { circle, innerR: 0, outerR: radii[idx], turnRegion: 'inside', cwDeg };
  }
  const idx = Math.min(radii.length, Math.max(1, prefixLayer ?? 1)) - 1;
  return {
    circle,
    innerR: idx === 0 ? 0 : radii[idx - 1],
    outerR: radii[idx],
    turnRegion: 'inside',
    cwDeg,
  };
}

function getAllCuttingCircles(circles: CircleDef[]): Circle[] {
  const out: Circle[] = [];
  // Outer rims before inner concentric rims so outer overlaps split cleanly first
  for (const c of circles) {
    out.push({ cx: c.cx, cy: c.cy, r: c.r });
  }
  for (const c of circles) {
    if (c.layerRadii && c.layerRadii.length > 1) {
      for (let i = c.layerRadii.length - 2; i >= 0; i--) {
        out.push({ cx: c.cx, cy: c.cy, r: c.layerRadii[i] });
      }
    }
  }
  return out;
}

function defaultColorForPoint(pt: Point, circles: CircleDef[]): string {
  const members = circles.filter((c) => Math.hypot(pt.x - c.cx, pt.y - c.cy) < c.r - 1e-4);
  if (members.length === circles.length && circles.length >= 3) {
    return '#f1f5f9';
  }
  if (members.length === 1) return members[0].color;
  const candidates = members.length > 0 ? members : circles;
  let best = candidates[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const d = dist(pt, { x: c.cx, y: c.cy });
    if (d < bestD - 1e-5) {
      bestD = d;
      best = c;
    }
  }
  return best.color;
}

interface ResolvedRegionFilter {
  insideCircles: Circle[];
  outsideCircles: Circle[];
  memberAxes: Circle[] | null;
  memberMin: number;
  memberMax: number;
  minArea?: number;
  maxArea?: number;
  minAng?: number;
  maxAng?: number;
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
}

function compileRegionFilter(
  filter: RegionFilter,
  axisMap: Map<string, CircleDef>,
  allCircles: CircleDef[],
  env: Record<string, number>,
  symCenter: Point,
  rotRad = 0,
): ResolvedRegionFilter {
  const rotCircle = (c: Circle): Circle => {
    if (Math.abs(rotRad) < 1e-12) return c;
    const rc = rotatePoint({ x: c.cx, y: c.cy }, symCenter, rotRad);
    return { cx: rc.x, cy: rc.y, r: c.r };
  };

  const insideCircles = (filter.inside ?? []).map((ref) =>
    rotCircle(resolveColorCircleRef(ref, axisMap, env)),
  );
  const outsideCircles = (filter.outside ?? []).map((ref) =>
    rotCircle(resolveColorCircleRef(ref, axisMap, env)),
  );

  let memberAxes: Circle[] | null = null;
  let memberMin = 0;
  let memberMax = Infinity;
  if (filter.memberCount !== undefined) {
    if (Array.isArray(filter.memberCount)) {
      memberMin = filter.memberCount[0];
      memberMax = filter.memberCount[1];
    } else {
      memberMin = filter.memberCount;
      memberMax = filter.memberCount;
    }
    if (filter.ofAxes !== undefined) {
      const ids = typeof filter.ofAxes === 'string' ? filter.ofAxes.split('') : filter.ofAxes;
      memberAxes = ids.map((id) => {
        const c = axisMap.get(id);
        if (!c) throw new Error(`Unknown axis "${id}" in ofAxes`);
        return rotCircle(c);
      });
    } else {
      memberAxes = allCircles.map((c) => rotCircle(c));
    }
  }

  return {
    insideCircles,
    outsideCircles,
    memberAxes,
    memberMin,
    memberMax,
    minArea: filter.minArea !== undefined ? evalNumExpr(filter.minArea, env) : undefined,
    maxArea: filter.maxArea !== undefined ? evalNumExpr(filter.maxArea, env) : undefined,
    minAng: filter.angleDeg ? evalNumExpr(filter.angleDeg[0], env) : undefined,
    maxAng: filter.angleDeg ? evalNumExpr(filter.angleDeg[1], env) : undefined,
    minX: filter.minX !== undefined ? evalNumExpr(filter.minX, env) : undefined,
    maxX: filter.maxX !== undefined ? evalNumExpr(filter.maxX, env) : undefined,
    minY: filter.minY !== undefined ? evalNumExpr(filter.minY, env) : undefined,
    maxY: filter.maxY !== undefined ? evalNumExpr(filter.maxY, env) : undefined,
  };
}

function matchesResolvedFilter(
  pt: Point,
  area: number,
  rf: ResolvedRegionFilter,
  symCenter: Point,
  rotRad = 0,
): boolean {
  if (rf.minArea !== undefined && area < rf.minArea - 1e-6) return false;
  if (rf.maxArea !== undefined && area > rf.maxArea + 1e-6) return false;
  if (rf.insideCircles.some((c) => Math.hypot(pt.x - c.cx, pt.y - c.cy) >= c.r - 1e-4)) {
    return false;
  }
  if (rf.outsideCircles.some((c) => Math.hypot(pt.x - c.cx, pt.y - c.cy) <= c.r + 1e-4)) {
    return false;
  }
  if (rf.memberAxes !== null) {
    let cnt = 0;
    for (const c of rf.memberAxes) {
      if (Math.hypot(pt.x - c.cx, pt.y - c.cy) < c.r - 1e-4) cnt++;
    }
    if (cnt < rf.memberMin || cnt > rf.memberMax) return false;
  }
  // For coordinate / polar bounds, un-rotate pt into the filter's base frame
  const basePt = Math.abs(rotRad) < 1e-12 ? pt : rotatePoint(pt, symCenter, -rotRad);
  if (rf.minX !== undefined && basePt.x < rf.minX) return false;
  if (rf.maxX !== undefined && basePt.x > rf.maxX) return false;
  if (rf.minY !== undefined && basePt.y < rf.minY) return false;
  if (rf.maxY !== undefined && basePt.y > rf.maxY) return false;
  if (rf.minAng !== undefined && rf.maxAng !== undefined) {
    const deg = (Math.atan2(basePt.y - symCenter.y, basePt.x - symCenter.x) * 180) / Math.PI;
    if (rf.minAng <= rf.maxAng) {
      if (deg < rf.minAng || deg > rf.maxAng) return false;
    } else {
      // Wrap across ±180°
      if (deg < rf.minAng && deg > rf.maxAng) return false;
    }
  }
  return true;
}

function splitFilteredByCircle(
  regions: ArcRegion[],
  circle: Circle,
  minArea: number,
  onlyFilter: ResolvedRegionFilter | null,
  skipFilter: ResolvedRegionFilter | null,
  symCenter: Point,
  rotRad = 0,
): ArcRegion[] {
  if (!onlyFilter && !skipFilter) {
    return splitAllByCircle(regions, circle, minArea);
  }
  const next: ArcRegion[] = [];
  for (const reg of regions) {
    const pt = interiorPointOfRegion(reg);
    const area = regionSignedArea(reg.edges);
    const allowed =
      (!onlyFilter || matchesResolvedFilter(pt, area, onlyFilter, symCenter, rotRad)) &&
      (!skipFilter || !matchesResolvedFilter(pt, area, skipFilter, symCenter, rotRad));
    if (allowed && classifyRegionAgainstCircle(reg, circle, 1e-4) === 'straddling') {
      const sp = splitRegionByCircle(reg, circle);
      for (const s of sp) {
        if (regionSignedArea(s.edges) > minArea) next.push(s);
      }
    } else {
      next.push(reg);
    }
  }
  return next;
}

function applyColoringRules(
  regions: ArcRegion[],
  rules: ColoringRule[] | undefined,
  circles: CircleDef[],
  axisMap: Map<string, CircleDef>,
  symCenter: Point,
  env: Record<string, number>,
): string[] {
  const effectiveRules: ColoringRule[] =
    rules && rules.length > 0 ? rules : [{ type: 'default' }];
  const pts = regions.map((r) => interiorPointOfRegion(r));
  const areas = regions.map((r) => regionSignedArea(r.edges));
  const colors = regions.map((_, i) => defaultColorForPoint(pts[i], circles));

  for (const rule of effectiveRules) {
    switch (rule.type) {
      case 'default':
        for (let i = 0; i < regions.length; i++) {
          colors[i] = defaultColorForPoint(pts[i], circles);
        }
        break;

      case 'fill':
        for (let i = 0; i < regions.length; i++) {
          colors[i] = rule.color;
        }
        break;

      case 'venn':
        for (let i = 0; i < regions.length; i++) {
          const pt = pts[i];
          const key = circles
            .filter((c) => Math.hypot(pt.x - c.cx, pt.y - c.cy) < c.r - 1e-4)
            .map((c) => c.id)
            .sort()
            .join('');
          if (key in rule.colors) {
            colors[i] = rule.colors[key];
          }
        }
        break;

      case 'cyclicArm': {
        const ids = typeof rule.axes === 'string' ? rule.axes.split('') : rule.axes;
        const ring = ids.map((id) => {
          const c = axisMap.get(id);
          if (!c) throw new Error(`Unknown axis "${id}" in cyclicArm coloring`);
          return c;
        });
        const n = ring.length;
        const dir = rule.direction ?? 'cw';
        for (let i = 0; i < regions.length; i++) {
          const pt = pts[i];
          const inside = ring.map((c) => Math.hypot(pt.x - c.cx, pt.y - c.cy) < c.r - 1e-4);
          for (let k = 0; k < n; k++) {
            const adj = dir === 'cw' ? (k + 1) % n : (k - 1 + n) % n;
            if (inside[k] && !inside[adj]) {
              colors[i] = rule.colors[k % rule.colors.length];
              break;
            }
          }
        }
        break;
      }

      case 'region': {
        if (rule.repeatSymmetry && rule.repeatSymmetry.colors.length > 0) {
          const count = rule.repeatSymmetry.count ?? rule.repeatSymmetry.colors.length;
          const stepDeg =
            rule.repeatSymmetry.stepDeg !== undefined
              ? evalNumExpr(rule.repeatSymmetry.stepDeg, env)
              : 360 / count;
          for (let k = 0; k < count; k++) {
            const rotRad = deg2rad(-k * stepDeg);
            const rf = compileRegionFilter(rule, axisMap, circles, env, symCenter, rotRad);
            const col = rule.repeatSymmetry.colors[k % rule.repeatSymmetry.colors.length];
            for (let i = 0; i < regions.length; i++) {
              if (matchesResolvedFilter(pts[i], areas[i], rf, symCenter, rotRad)) {
                colors[i] = col;
              }
            }
          }
        } else if (rule.color) {
          const rf = compileRegionFilter(rule, axisMap, circles, env, symCenter, 0);
          for (let i = 0; i < regions.length; i++) {
            if (matchesResolvedFilter(pts[i], areas[i], rf, symCenter, 0)) {
              colors[i] = rule.color;
            }
          }
        }
        break;
      }

      case 'points':
        for (const probe of rule.probes) {
          const pt: Point = { x: evalNumExpr(probe.x, env), y: evalNumExpr(probe.y, env) };
          for (let i = 0; i < regions.length; i++) {
            if (pointInRegion(pt, regions[i])) {
              colors[i] = probe.color;
              break;
            }
          }
        }
        break;
    }
  }

  return colors;
}

/**
 * Build exact analytical Piece[] directly from a RingTwist v1 document.
 */
export function buildPiecesFromRingTwistDoc(
  doc: RingTwistPuzzleDoc,
  spec: PuzzleSpec,
  env: Record<string, number>,
): Piece[] {
  const circles = spec.circles;
  const axisMap = new Map(circles.map((c) => [c.id, c]));
  const symCenter: Point = spec.symmetryCenter ?? { x: 0, y: 0 };
  const allCutters = getAllCuttingCircles(circles);

  // 1. Initial silhouette regions
  let regions: ArcRegion[];
  if (doc.silhouette && doc.silhouette.parts.length > 0) {
    regions = [];
    for (const part of doc.silhouette.parts) {
      const partCircles = resolveCircleSources(part.circles, axisMap, env);
      const insideFilters = part.inside
        ? resolveCircleSources(part.inside, axisMap, env)
        : [];
      const outsideFilters = part.outside
        ? resolveCircleSources(part.outside, axisMap, env)
        : [];
      const sliced = sliceCircles(partCircles);
      for (const r of sliced) {
        if (insideFilters.some((f) => classifyRegionAgainstCircle(r, f, 1e-4) !== 'inside')) {
          continue;
        }
        if (outsideFilters.some((f) => classifyRegionAgainstCircle(r, f, 1e-4) !== 'outside')) {
          continue;
        }
        regions.push({ edges: r.edges });
      }
    }
  } else {
    regions = sliceCircles(circles).map((r) => ({ edges: r.edges }));
    // Slice by any concentric inner layer rims
    for (const c of circles) {
      if (c.layerRadii && c.layerRadii.length > 1) {
        for (let i = c.layerRadii.length - 2; i >= 0; i--) {
          regions = splitAllByCircle(regions, { cx: c.cx, cy: c.cy, r: c.layerRadii[i] });
        }
      }
    }
  }

  // 2. Execute declarative cut & bandage operations
  const executeClosureStep = (step: ClosureMoveStep, minArea: number) => {
    const token = typeof step === 'string' ? step : step.move;
    const cutList =
      typeof step === 'string' || !step.cutBy
        ? allCutters
        : step.cutBy.map((ref) => resolveAxisOrLayerRef(ref, axisMap));
    const parsed = parseClosureMoveToken(token, axisMap);
    const rad = deg2rad(-parsed.cwDeg); // math CCW = -CW

    regions = regions.map((reg) => {
      if (parsed.turnRegion === 'outside') {
        return classifyRegionAgainstCircle(reg, parsed.circle, 1e-4) === 'outside'
          ? rotateRegion(reg, parsed.circle.cx, parsed.circle.cy, rad)
          : reg;
      }
      const outerC: Circle = { cx: parsed.circle.cx, cy: parsed.circle.cy, r: parsed.outerR };
      if (classifyRegionAgainstCircle(reg, outerC, 1e-4) !== 'inside') return reg;
      if (parsed.innerR > 0) {
        const innerC: Circle = { cx: parsed.circle.cx, cy: parsed.circle.cy, r: parsed.innerR };
        if (classifyRegionAgainstCircle(reg, innerC, 1e-4) !== 'outside') return reg;
      }
      return rotateRegion(reg, parsed.circle.cx, parsed.circle.cy, rad);
    });

    const onlyFilter =
      typeof step !== 'string' && step.only
        ? compileRegionFilter(step.only, axisMap, circles, env, symCenter, 0)
        : null;
    const skipFilter =
      typeof step !== 'string' && step.skip
        ? compileRegionFilter(step.skip, axisMap, circles, env, symCenter, 0)
        : null;

    for (const cutter of cutList) {
      regions = splitFilteredByCircle(regions, cutter, minArea, onlyFilter, skipFilter, symCenter);
    }
  };

  for (const op of doc.cuts ?? []) {
    switch (op.op) {
      case 'sliceByAxes': {
        const targets = op.axes
          ? op.axes.map((ref) => resolveAxisOrLayerRef(ref, axisMap))
          : allCutters;
        for (const c of targets) {
          regions = splitAllByCircle(regions, c);
        }
        break;
      }

      case 'closure': {
        const blocks = op.blocks ?? (op.moves ? [{ moves: op.moves, repeat: 1 }] : []);
        const maxIters = op.maxIters ?? 10;
        const minArea = op.minArea ?? 1e-5;
        let prevLen = -1;
        for (let iter = 0; iter < maxIters && regions.length !== prevLen; iter++) {
          prevLen = regions.length;
          for (const blk of blocks) {
            const reps = blk.repeat ?? 1;
            for (let r = 0; r < reps; r++) {
              for (const step of blk.moves) {
                executeClosureStep(step, minArea);
              }
            }
          }
        }
        break;
      }

      case 'cutCircles': {
        const baseCircles = resolveCircleSources(op.circles, axisMap, env);
        const reps = op.repeatSymmetry ?? 1;
        const stepDeg = reps > 1 ? 360 / reps : 0;
        const minArea = op.minArea ?? 1e-5;
        const onlySpec: RegionFilter | undefined =
          op.only ?? (op.onlyInside ? { inside: [op.onlyInside] } : undefined);

        for (let k = 0; k < reps; k++) {
          const rotRad = deg2rad(-k * stepDeg);
          const onlyFilter = onlySpec
            ? compileRegionFilter(onlySpec, axisMap, circles, env, symCenter, rotRad)
            : null;
          const skipFilter = op.skip
            ? compileRegionFilter(op.skip, axisMap, circles, env, symCenter, rotRad)
            : null;

          for (const bc of baseCircles) {
            const rc = rotatePoint({ x: bc.cx, y: bc.cy }, symCenter, rotRad);
            const cutC: Circle = { cx: rc.x, cy: rc.y, r: bc.r };
            regions = splitFilteredByCircle(
              regions,
              cutC,
              minArea,
              onlyFilter,
              skipFilter,
              symCenter,
              rotRad,
            );
          }
        }
        break;
      }

      case 'orbitSlice': {
        const passes = op.passes ?? 1;
        const targetIds = op.axes ?? circles.map((c) => c.id);
        const angles = op.anglesDeg.map((a) => evalNumExpr(a, env));
        const maxMem = op.maxMemberCircles ?? circles.length;
        for (let pass = 0; pass < passes; pass++) {
          if (op.nonChaining) {
            const virtualCuts: { home: CircleDef; cutter: Circle }[] = [];
            for (const cid of targetIds) {
              const home = axisMap.get(cid);
              if (!home) continue;
              for (const deg of angles) {
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
            let tagged = regions.map((reg) => ({
              reg,
              memCount: circles.filter((c) => classifyRegionAgainstCircle(reg, c) === 'inside').length,
            }));
            for (const vc of virtualCuts) {
              const nextTagged: typeof tagged = [];
              for (const item of tagged) {
                if (
                  item.memCount <= maxMem &&
                  classifyRegionAgainstCircle(item.reg, vc.home) === 'inside'
                ) {
                  for (const p of splitRegionByCircle(item.reg, vc.cutter)) {
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
              const targetCircle = axisMap.get(cid);
              if (!targetCircle) continue;
              for (const deg of angles) {
                const rad = deg2rad(-deg);
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
                  let parts: ArcRegion[] = [rotateRegion(reg, targetCircle.cx, targetCircle.cy, rad)];
                  for (const other of circles) {
                    if (other.id === targetCircle.id) continue;
                    const splitParts: ArcRegion[] = [];
                    for (const p of parts) splitParts.push(...splitRegionByCircle(p, other));
                    parts = splitParts;
                  }
                  for (const p of parts) {
                    nextRegions.push(rotateRegion(p, targetCircle.cx, targetCircle.cy, -rad));
                  }
                }
                regions = nextRegions;
              }
            }
          }
        }
        break;
      }

      case 'bandage': {
        const symCount =
          typeof op.symmetric === 'number'
            ? Math.max(1, Math.round(op.symmetric))
            : op.symmetric && spec.symmetryStepDeg > 0
              ? Math.round(360 / spec.symmetryStepDeg)
              : 1;
        const stepDeg = symCount > 1 ? 360 / symCount : 0;

        for (const group of op.groups ?? []) {
          const basePts: Point[] = group.map(([x, y]) => ({
            x: evalNumExpr(x, env),
            y: evalNumExpr(y, env),
          }));
          for (let k = 0; k < symCount; k++) {
            const rotRad = deg2rad(-k * stepDeg);
            const pts = basePts.map((p) => rotatePoint(p, symCenter, rotRad));
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

        for (const filter of op.where ?? []) {
          for (let k = 0; k < symCount; k++) {
            const rotRad = deg2rad(-k * stepDeg);
            const rf = compileRegionFilter(filter, axisMap, circles, env, symCenter, rotRad);
            const toMerge: ArcRegion[] = [];
            const keep: ArcRegion[] = [];
            for (const reg of regions) {
              const pt = interiorPointOfRegion(reg);
              const area = regionSignedArea(reg.edges);
              if (matchesResolvedFilter(pt, area, rf, symCenter, rotRad)) {
                toMerge.push(reg);
              } else {
                keep.push(reg);
              }
            }
            if (toMerge.length >= 2) {
              regions = [...keep, ...mergeRegions(toMerge)];
            }
          }
        }
        break;
      }
    }
  }

  // 3. Apply index-free coloring rules
  const colors = applyColoringRules(regions, doc.coloring, circles, axisMap, symCenter, env);

  let pieces: Piece[] = regions.map((region, id) => ({
    id,
    region,
    color: colors[id],
    homeColor: colors[id],
    area: regionSignedArea(region.edges),
  }));

  // 4. Optional orientation stickers (general N-edge wedge stickers on any piece containing `point`)
  for (const stRule of doc.stickers ?? []) {
    if (stRule.type === 'centerWedges' && stRule.colors.length > 0) {
      const center: Point = stRule.point
        ? { x: evalNumExpr(stRule.point[0], env), y: evalNumExpr(stRule.point[1], env) }
        : symCenter;
      const startDeg =
        stRule.startAngleDeg !== undefined ? evalNumExpr(stRule.startAngleDeg, env) : 90;
      const target = pieces.find((p) => pointInRegion(center, p.region));
      if (target && target.region.edges.length > 0) {
        const apex = interiorPointOfRegion(target.region);
        // Sort edges CW from startDeg so colors[0] maps to the startDeg direction
        const ordered = target.region.edges
          .map((arc) => {
            const m = edgePointAt(arc, 0.5);
            const deg = (Math.atan2(m.y - apex.y, m.x - apex.x) * 180) / Math.PI;
            const cwFromStart = (((startDeg - deg) % 360) + 360) % 360;
            return { arc, cwFromStart };
          })
          .sort((a, b) => a.cwFromStart - b.cwFromStart);
        const stickers: StickerWedge[] = ordered.map((item, idx) => ({
          apex,
          arc: item.arc,
          color: stRule.colors[idx % stRule.colors.length],
        }));
        target.stickers = stickers;
        target.homeColor = `wedges-${stRule.colors.length}`;
      }
    }
  }

  return pieces;
}

/**
 * Compile a declarative RingTwist v1 puzzle document into an executable PuzzleSpec.
 */
export function compileRingTwistDoc(doc: RingTwistPuzzleDoc): PuzzleSpec {
  const env = resolveParams(doc.params);
  const circles = resolveAxes(doc.axes, env);
  const symmetryStepDeg =
    doc.symmetryStepDeg !== undefined ? evalNumExpr(doc.symmetryStepDeg, env) : 0;
  const symmetryCenter: Point | undefined = doc.symmetryCenter
    ? {
        x: evalNumExpr(doc.symmetryCenter[0], env),
        y: evalNumExpr(doc.symmetryCenter[1], env),
      }
    : undefined;
  const viewBounds = doc.viewBounds
    ? {
        minX: evalNumExpr(doc.viewBounds[0], env),
        maxX: evalNumExpr(doc.viewBounds[1], env),
        minY: evalNumExpr(doc.viewBounds[2], env),
        maxY: evalNumExpr(doc.viewBounds[3], env),
      }
    : undefined;

  const spec: PuzzleSpec = {
    id: doc.id,
    name: doc.name,
    category: doc.category ?? 'Custom',
    description: doc.description ?? 'Custom RingTwist puzzle.',
    circles,
    symmetryStepDeg,
    ...(symmetryCenter ? { symmetryCenter } : {}),
    ...(viewBounds ? { viewBounds } : {}),
    ...(doc.sampleAlgorithms ? { sampleAlgorithms: doc.sampleAlgorithms } : {}),
    customBuilder: (s) => buildPiecesFromRingTwistDoc(doc, s, env),
  };

  registerPuzzleSourceDoc(spec, doc);
  return spec;
}
