import {
  ArcEdge,
  ArcRegion,
  edgeEnd,
  edgePointAt,
  edgeSignedCurvature,
  edgeStart,
  edgeStartTangentAngle,
  interiorPointOfRegion,
  pointInRegion,
  regionSignedArea,
  reverseEdge,
  simplifyRegion,
} from './arcRegion.ts';
import {
  ANG_EPS,
  Circle,
  EPS,
  Point,
  TWO_PI,
  angleOffsetOnArc,
  circlesEqual,
  intersectCircles,
  normAngle,
  pointOnCircle,
  pointsEqual,
} from './math.ts';

interface HalfEdge {
  id: number;
  arc: ArcEdge;
  from: number;
  to: number;
  twinId: number;
  traversable: boolean;
  tangent: number;
  curvature: number;
}

interface DirectedArcSpec {
  arc: ArcEdge;
  traversable: boolean;
}

/**
 * Deduplicate sorted angles in [0, 2*PI) within eps.
 */
function uniqueSortedAngles(angles: number[], eps = 1e-6): number[] {
  if (angles.length === 0) return [];
  const sorted = angles.map(normAngle).sort((a, b) => a - b);
  const out: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - out[out.length - 1] > eps) {
      out.push(sorted[i]);
    }
  }
  if (out.length > 1 && TWO_PI - (out[out.length - 1] - out[0]) <= eps) {
    out.pop();
  }
  return out;
}

/**
 * Compare two outgoing half-edges at the same vertex in CCW order:
 * primary key = outgoing tangent angle [0, 2*PI)
 * tie-breaker = signed curvature (+1/r bends more CCW than -1/r)
 */
function compareOutgoingCCW(a: HalfEdge, b: HalfEdge): number {
  // Linear order around [0, 2*PI) normalized near the 2*PI wrap using the same tolerance as tie-breaking
  const wrapTol = 1e-5;
  const ta = a.tangent >= TWO_PI - wrapTol ? 0 : a.tangent;
  const tb = b.tangent >= TWO_PI - wrapTol ? 0 : b.tangent;
  if (Math.abs(ta - tb) > wrapTol) {
    return ta - tb;
  }
  return a.curvature - b.curvature;
}

/**
 * Given a set of directed arcs (each optionally traversable, plus its reverse
 * either traversable or sentinel), build a planar DCEL and trace all bounded
 * minimal CCW faces (signed area > minArea).
 */
function extractCCWFaces(
  specs: DirectedArcSpec[],
  vertexEps = 1e-5,
  minArea = 1e-5,
): ArcRegion[] {
  const vertices: Point[] = [];
  const getVertexId = (p: Point): number => {
    for (let i = 0; i < vertices.length; i++) {
      if (pointsEqual(vertices[i], p, vertexEps)) return i;
    }
    vertices.push({ x: p.x, y: p.y });
    return vertices.length - 1;
  };

  // Deduplicate identical directed arcs; precompute (s, e, mid) once per arc so comparisons avoid repeated trig.
  interface CachedArcSpec extends DirectedArcSpec {
    s: Point;
    e: Point;
    mid: Point;
  }
  const makeCached = (arc: ArcEdge, traversable: boolean): CachedArcSpec => ({
    arc,
    traversable,
    s: edgeStart(arc),
    e: edgeEnd(arc),
    mid: edgePointAt(arc, 0.5),
  });
  const sameArc = (a: CachedArcSpec, b: CachedArcSpec): boolean =>
    Math.sign(a.arc.sweep) === Math.sign(b.arc.sweep) &&
    Math.abs(a.mid.x - b.mid.x) <= vertexEps &&
    Math.abs(a.mid.y - b.mid.y) <= vertexEps &&
    circlesEqual(a.arc, b.arc, vertexEps) &&
    pointsEqual(a.s, b.s, vertexEps) &&
    pointsEqual(a.e, b.e, vertexEps) &&
    pointsEqual(a.mid, b.mid, vertexEps);

  const deduped: CachedArcSpec[] = [];
  for (const spec of specs) {
    if (Math.abs(spec.arc.sweep) < 1e-6) continue;
    const cand = makeCached(spec.arc, spec.traversable);
    let found = false;
    for (const ex of deduped) {
      if (sameArc(ex, cand)) {
        ex.traversable = ex.traversable || spec.traversable;
        found = true;
        break;
      }
    }
    if (!found) {
      deduped.push(cand);
    }
  }

  // Ensure every directed arc has a reverse twin (sentinel if not already present)
  const allSpecs: CachedArcSpec[] = [...deduped];
  const findSpecIndex = (cand: CachedArcSpec): number => {
    for (let i = 0; i < allSpecs.length; i++) {
      if (sameArc(allSpecs[i], cand)) return i;
    }
    return -1;
  };

  const twinMap = new Map<number, number>();
  const initialLen = allSpecs.length;
  for (let i = 0; i < initialLen; i++) {
    if (twinMap.has(i)) continue;
    const orig = allSpecs[i];
    const revArc = reverseEdge(orig.arc);
    const revCand: CachedArcSpec = {
      arc: revArc,
      traversable: false,
      s: orig.e,
      e: orig.s,
      mid: orig.mid,
    };
    let j = findSpecIndex(revCand);
    if (j === -1) {
      j = allSpecs.length;
      allSpecs.push(revCand);
    }
    twinMap.set(i, j);
    twinMap.set(j, i);
  }

  const halfEdges: HalfEdge[] = allSpecs.map((spec, id) => {
    const from = getVertexId(spec.s);
    const to = getVertexId(spec.e);
    return {
      id,
      arc: spec.arc,
      from,
      to,
      twinId: twinMap.get(id)!,
      traversable: spec.traversable,
      tangent: edgeStartTangentAngle(spec.arc),
      curvature: edgeSignedCurvature(spec.arc),
    };
  });

  // Group outgoing half-edges per vertex and sort CCW
  const outgoing: HalfEdge[][] = vertices.map(() => []);
  for (const he of halfEdges) {
    outgoing[he.from].push(he);
  }
  for (const list of outgoing) {
    list.sort(compareOutgoingCCW);
  }

  const visited = new Uint8Array(halfEdges.length);
  const faces: ArcRegion[] = [];

  for (const startEdge of halfEdges) {
    if (!startEdge.traversable || visited[startEdge.id]) continue;

    const loop: ArcEdge[] = [];
    let curr = startEdge;
    let valid = true;
    let guard = 0;

    while (guard++ < halfEdges.length + 2) {
      if (visited[curr.id]) {
        valid = curr.id === startEdge.id;
        break;
      }
      if (!curr.traversable) {
        valid = false;
        break;
      }
      visited[curr.id] = 1;
      loop.push(curr.arc);

      const list = outgoing[curr.to];
      const twinIdx = list.findIndex((h) => h.id === curr.twinId);
      if (twinIdx === -1 || list.length < 2) {
        valid = false;
        break;
      }
      // Step 1 CW from twin to hug the left (CCW) interior face
      const next = list[(twinIdx - 1 + list.length) % list.length];
      curr = next;
      if (curr.id === startEdge.id) break;
    }

    if (valid && loop.length >= 2) {
      const area = regionSignedArea(loop);
      if (area > minArea) {
        faces.push(simplifyRegion({ edges: loop }));
      }
    }
  }

  return faces;
}

/**
 * Partition the union of a set of circles into minimal elementary ArcRegions.
 */
export function sliceCircles(circles: Circle[], minArea = 1e-5): ArcRegion[] {
  // Deduplicate identical circles
  const uniqueCircles: Circle[] = [];
  for (const c of circles) {
    if (!uniqueCircles.some((u) => circlesEqual(u, c, 1e-5))) {
      uniqueCircles.push(c);
    }
  }

  const specs: DirectedArcSpec[] = [];

  for (let i = 0; i < uniqueCircles.length; i++) {
    const ci = uniqueCircles[i];
    const angles: number[] = [];

    for (let j = 0; j < uniqueCircles.length; j++) {
      if (i === j) continue;
      const pts = intersectCircles(ci, uniqueCircles[j], EPS);
      for (const p of pts) {
        angles.push(Math.atan2(p.y - ci.cy, p.x - ci.cx));
      }
    }

    let sorted = uniqueSortedAngles(angles, 1e-5);
    // Ensure at least 2 vertices per circle so no self-loops exist
    if (sorted.length === 0) {
      sorted = [0, Math.PI];
    } else if (sorted.length === 1) {
      sorted = uniqueSortedAngles([sorted[0], sorted[0] + Math.PI], 1e-5);
    }

    for (let k = 0; k < sorted.length; k++) {
      const a0 = sorted[k];
      const a1 = sorted[(k + 1) % sorted.length];
      let sweep = a1 - a0;
      if (sweep <= 0) sweep += TWO_PI;
      if (sweep < 1e-5) continue;

      const fwd: ArcEdge = { cx: ci.cx, cy: ci.cy, r: ci.r, startAngle: a0, sweep };
      const rev = reverseEdge(fwd);
      specs.push({ arc: fwd, traversable: true });
      specs.push({ arc: rev, traversable: true });
    }
  }

  const allFaces = extractCCWFaces(specs, 1e-5, minArea);

  // Keep only faces whose interior lies inside at least one circle
  return allFaces.filter((face) => {
    const pt = interiorPointOfRegion(face);
    return uniqueCircles.some((c) => Math.hypot(pt.x - c.cx, pt.y - c.cy) < c.r - 1e-5);
  });
}

/**
 * Split a single ArcRegion by a cutting circle.
 * Returns [region] unchanged if the circle does not strictly bisect the region,
 * or an array of 2+ sub-regions if it does.
 */
export function splitRegionByCircle(
  region: ArcRegion,
  cutCircle: Circle,
  minArea = 1e-5,
): ArcRegion[] {
  // Collect intersection points between region boundary edges and cutCircle
  const cutAngles: number[] = [];
  const splitBoundaryArcs: ArcEdge[] = [];

  for (const e of region.edges) {
    if (circlesEqual(e, cutCircle, 1e-5)) {
      cutAngles.push(e.startAngle, e.startAngle + e.sweep);
      splitBoundaryArcs.push(e);
      continue;
    }

    const pts = intersectCircles(e, cutCircle, EPS);
    const splitTs: number[] = [0, 1];

    for (const p of pts) {
      const angE = Math.atan2(p.y - e.cy, p.x - e.cx);
      const u = angleOffsetOnArc(angE, e.startAngle, e.sweep, 1e-5);
      if (u !== null) {
        if (u > 1e-5 && u < 1 - 1e-5) {
          splitTs.push(u);
        }
        cutAngles.push(Math.atan2(p.y - cutCircle.cy, p.x - cutCircle.cx));
      }
    }

    // Deduplicate and sort split parameters along edge e
    splitTs.sort((a, b) => a - b);
    const uniqT: number[] = [splitTs[0]];
    for (let i = 1; i < splitTs.length; i++) {
      if (splitTs[i] - uniqT[uniqT.length - 1] > 1e-5) {
        uniqT.push(splitTs[i]);
      }
    }
    if (uniqT[uniqT.length - 1] < 1 - 1e-5) {
      uniqT.push(1);
    } else {
      uniqT[uniqT.length - 1] = 1;
    }

    for (let i = 0; i < uniqT.length - 1; i++) {
      const t0 = uniqT[i];
      const t1 = uniqT[i + 1];
      const subSweep = e.sweep * (t1 - t0);
      if (Math.abs(subSweep) > 1e-6) {
        splitBoundaryArcs.push({
          cx: e.cx,
          cy: e.cy,
          r: e.r,
          startAngle: normAngle(e.startAngle + e.sweep * t0),
          sweep: subSweep,
        });
      }
    }
  }

  let sortedCut = uniqueSortedAngles(cutAngles, 1e-5);
  if (sortedCut.length === 0) {
    // Check if cutCircle lies completely inside region (hole — not expected for
    // circle puzzles, so return unchanged)
    return [region];
  }
  if (sortedCut.length === 1) {
    sortedCut = uniqueSortedAngles([sortedCut[0], sortedCut[0] + Math.PI], 1e-5);
  }

  // Keep only sub-arcs of cutCircle whose midpoint lies strictly inside region
  const interiorChords: ArcEdge[] = [];
  for (let k = 0; k < sortedCut.length; k++) {
    const a0 = sortedCut[k];
    const a1 = sortedCut[(k + 1) % sortedCut.length];
    let sweep = a1 - a0;
    if (sweep <= 0) sweep += TWO_PI;
    if (sweep < 1e-5) continue;

    const mid = pointOnCircle(cutCircle, a0 + sweep * 0.5);
    // Skip if midpoint lies right on a boundary arc of region
    let onBoundary = false;
    for (const e of region.edges) {
      if (Math.abs(Math.hypot(mid.x - e.cx, mid.y - e.cy) - e.r) < 1e-4) {
        const ang = Math.atan2(mid.y - e.cy, mid.x - e.cx);
        if (angleOffsetOnArc(ang, e.startAngle, e.sweep, 1e-4) !== null) {
          onBoundary = true;
          break;
        }
      }
    }
    if (!onBoundary && pointInRegion(mid, region)) {
      interiorChords.push({
        cx: cutCircle.cx,
        cy: cutCircle.cy,
        r: cutCircle.r,
        startAngle: a0,
        sweep,
      });
    }
  }

  if (interiorChords.length === 0) {
    return [region];
  }

  const specs: DirectedArcSpec[] = [];
  for (const arc of splitBoundaryArcs) {
    specs.push({ arc, traversable: true });
  }
  for (const chord of interiorChords) {
    specs.push({ arc: chord, traversable: true });
    specs.push({ arc: reverseEdge(chord), traversable: true });
  }

  const faces = extractCCWFaces(specs, 1e-5, minArea);
  return faces.length >= 2 ? faces : [region];
}

/**
 * Merge a group of adjacent ArcRegions into one combined ArcRegion (bandaging).
 * Cancels shared opposite boundary arcs and traces the remaining outer loop.
 */
export function mergeRegions(regions: ArcRegion[], eps = 1e-5): ArcRegion[] {
  if (regions.length <= 1) return regions;

  // Split any partially overlapping co-circular edges across the regions first
  const allEdges: ArcEdge[] = [];
  const rawEdges = regions.flatMap((r) => r.edges);

  for (let i = 0; i < rawEdges.length; i++) {
    const e = rawEdges[i];
    const splitTs: number[] = [0, 1];
    for (let j = 0; j < rawEdges.length; j++) {
      if (i === j) continue;
      const o = rawEdges[j];
      if (!circlesEqual(e, o, eps)) continue;
      for (const pt of [edgeStart(o), edgeEnd(o)]) {
        const ang = Math.atan2(pt.y - e.cy, pt.x - e.cx);
        const u = angleOffsetOnArc(ang, e.startAngle, e.sweep, ANG_EPS);
        if (u !== null && u > 1e-5 && u < 1 - 1e-5) {
          splitTs.push(u);
        }
      }
    }
    splitTs.sort((a, b) => a - b);
    const uniqT: number[] = [splitTs[0]];
    for (let k = 1; k < splitTs.length; k++) {
      if (splitTs[k] - uniqT[uniqT.length - 1] > 1e-5) uniqT.push(splitTs[k]);
    }
    uniqT[uniqT.length - 1] = 1;
    for (let k = 0; k < uniqT.length - 1; k++) {
      const subSweep = e.sweep * (uniqT[k + 1] - uniqT[k]);
      if (Math.abs(subSweep) > 1e-6) {
        allEdges.push({
          cx: e.cx,
          cy: e.cy,
          r: e.r,
          startAngle: normAngle(e.startAngle + e.sweep * uniqT[k]),
          sweep: subSweep,
        });
      }
    }
  }

  // Cancel opposite twin arcs
  const cancelled = new Uint8Array(allEdges.length);
  for (let i = 0; i < allEdges.length; i++) {
    if (cancelled[i]) continue;
    const a = allEdges[i];
    const aMid = edgePointAt(a, 0.5);
    const aS = edgeStart(a);
    const aE = edgeEnd(a);
    for (let j = i + 1; j < allEdges.length; j++) {
      if (cancelled[j]) continue;
      const b = allEdges[j];
      if (
        circlesEqual(a, b, eps) &&
        Math.sign(a.sweep) === -Math.sign(b.sweep) &&
        pointsEqual(aS, edgeEnd(b), eps) &&
        pointsEqual(aE, edgeStart(b), eps) &&
        pointsEqual(aMid, edgePointAt(b, 0.5), eps)
      ) {
        cancelled[i] = 1;
        cancelled[j] = 1;
        break;
      }
    }
  }

  const remaining: DirectedArcSpec[] = [];
  for (let i = 0; i < allEdges.length; i++) {
    if (!cancelled[i]) {
      remaining.push({ arc: allEdges[i], traversable: true });
    }
  }

  return extractCCWFaces(remaining, eps);
}
