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
        const insideCircles = (rule.inside ?? []).map((ref) =>
          resolveColorCircleRef(ref, axisMap, env),
        );
        const outsideCircles = (rule.outside ?? []).map((ref) =>
          resolveColorCircleRef(ref, axisMap, env),
        );
        const minAng = rule.angleDeg ? evalNumExpr(rule.angleDeg[0], env) : undefined;
        const maxAng = rule.angleDeg ? evalNumExpr(rule.angleDeg[1], env) : undefined;
        const minX = rule.minX !== undefined ? evalNumExpr(rule.minX, env) : undefined;
        const maxX = rule.maxX !== undefined ? evalNumExpr(rule.maxX, env) : undefined;
        const minY = rule.minY !== undefined ? evalNumExpr(rule.minY, env) : undefined;
        const maxY = rule.maxY !== undefined ? evalNumExpr(rule.maxY, env) : undefined;

        for (let i = 0; i < regions.length; i++) {
          const pt = pts[i];
          if (insideCircles.some((c) => Math.hypot(pt.x - c.cx, pt.y - c.cy) >= c.r - 1e-4)) {
            continue;
          }
          if (outsideCircles.some((c) => Math.hypot(pt.x - c.cx, pt.y - c.cy) <= c.r + 1e-4)) {
            continue;
          }
          if (minX !== undefined && pt.x < minX) continue;
          if (maxX !== undefined && pt.x > maxX) continue;
          if (minY !== undefined && pt.y < minY) continue;
          if (maxY !== undefined && pt.y > maxY) continue;
          if (minAng !== undefined && maxAng !== undefined) {
            const deg = (Math.atan2(pt.y - symCenter.y, pt.x - symCenter.x) * 180) / Math.PI;
            if (minAng <= maxAng) {
              if (deg < minAng || deg > maxAng) continue;
            } else {
              // Wrap across ±180°
              if (deg < minAng && deg > maxAng) continue;
            }
          }
          colors[i] = rule.color;
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

    for (const cutter of cutList) {
      regions = splitAllByCircle(regions, cutter, minArea);
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
        const restrictAxis = op.onlyInside ? axisMap.get(op.onlyInside) : undefined;

        for (let k = 0; k < reps; k++) {
          const rotRad = deg2rad(-k * stepDeg);
          const allowed = restrictAxis
            ? (() => {
                const rc = rotatePoint({ x: restrictAxis.cx, y: restrictAxis.cy }, symCenter, rotRad);
                return { cx: rc.x, cy: rc.y, r: restrictAxis.r };
              })()
            : null;
          for (const bc of baseCircles) {
            const rc = rotatePoint({ x: bc.cx, y: bc.cy }, symCenter, rotRad);
            const cutC: Circle = { cx: rc.x, cy: rc.y, r: bc.r };
            if (!allowed) {
              regions = splitAllByCircle(regions, cutC, minArea);
            } else {
              const next: ArcRegion[] = [];
              for (const reg of regions) {
                if (classifyRegionAgainstCircle(reg, allowed, 1e-4) !== 'inside') {
                  next.push(reg);
                } else {
                  next.push(...splitAllByCircle([reg], cutC, minArea));
                }
              }
              regions = next;
            }
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
          op.symmetric && spec.symmetryStepDeg > 0 ? Math.round(360 / spec.symmetryStepDeg) : 1;
        for (const group of op.groups) {
          const basePts: Point[] = group.map(([x, y]) => ({
            x: evalNumExpr(x, env),
            y: evalNumExpr(y, env),
          }));
          for (let k = 0; k < symCount; k++) {
            const rotRad = deg2rad(-k * spec.symmetryStepDeg);
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
