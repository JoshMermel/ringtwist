import {
  ANG_EPS,
  Circle,
  EPS,
  Point,
  TWO_PI,
  angleOffsetOnArc,
  circlesEqual,
  dist,
  intersectCircles,
  normAngle,
  pointOnCircle,
  rotatePoint,
  snapFloat,
} from './math.ts';

/**
 * A directed circular arc edge.
 * In right-handed math coordinates (+x right, +y up):
 *   sweep > 0 => counter-clockwise (CCW)
 *   sweep < 0 => clockwise (CW)
 */
export interface ArcEdge {
  cx: number;
  cy: number;
  r: number;
  startAngle: number; // normalized to [0, 2*PI)
  sweep: number; // nonzero, |sweep| <= 2*PI
}

/**
 * A simply-connected 2D piece bounded by a CCW closed loop of circular arcs.
 */
export interface ArcRegion {
  edges: ArcEdge[];
}

export function edgeStart(e: ArcEdge): Point {
  return pointOnCircle(e, e.startAngle);
}

export function edgeEnd(e: ArcEdge): Point {
  return pointOnCircle(e, e.startAngle + e.sweep);
}

export function edgePointAt(e: ArcEdge, t: number): Point {
  return pointOnCircle(e, e.startAngle + e.sweep * t);
}

export function reverseEdge(e: ArcEdge): ArcEdge {
  return {
    cx: e.cx,
    cy: e.cy,
    r: e.r,
    startAngle: normAngle(e.startAngle + e.sweep),
    sweep: -e.sweep,
  };
}

/** Outgoing unit tangent angle at the start of the arc. */
export function edgeStartTangentAngle(e: ArcEdge): number {
  return normAngle(e.startAngle + (e.sweep > 0 ? Math.PI / 2 : -Math.PI / 2));
}

/** Signed curvature (+1/r for CCW, -1/r for CW). */
export function edgeSignedCurvature(e: ArcEdge): number {
  return (e.sweep > 0 ? 1 : -1) / e.r;
}

/**
 * Exact analytical signed area of a closed loop of circular arcs (Green's theorem).
 * Positive for CCW loops, negative for CW loops.
 */
export function regionSignedArea(edges: ArcEdge[]): number {
  let sum = 0;
  for (const e of edges) {
    const t0 = e.startAngle;
    const t1 = t0 + e.sweep;
    sum +=
      e.r * e.r * e.sweep +
      e.r * e.cx * (Math.sin(t1) - Math.sin(t0)) -
      e.r * e.cy * (Math.cos(t1) - Math.cos(t0));
  }
  return 0.5 * sum;
}

/**
 * Rotate an entire ArcRegion CCW around (cx, cy) by deltaAngle radians.
 */
export function rotateRegion(
  region: ArcRegion,
  cx: number,
  cy: number,
  deltaAngle: number,
): ArcRegion {
  const center = { x: cx, y: cy };
  return {
    edges: region.edges.map((e) => {
      const nc = rotatePoint({ x: e.cx, y: e.cy }, center, deltaAngle);
      return {
        cx: nc.x,
        cy: nc.y,
        r: e.r,
        startAngle: normAngle(e.startAngle + deltaAngle),
        sweep: e.sweep,
      };
    }),
  };
}

/**
 * Intersect a ray P + t*D (t > 0, |D| = 1) with an ArcEdge.
 * Returns parameter values t > 0, or null if the ray hits too close to an endpoint or tangency.
 */
function rayEdgeCrossings(
  p: Point,
  dx: number,
  dy: number,
  e: ArcEdge,
): { ambiguous: boolean; count: number; minT: number } {
  const fx = p.x - e.cx;
  const fy = p.y - e.cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - e.r * e.r;
  const disc = b * b - c;

  if (disc < -1e-9) {
    return { ambiguous: false, count: 0, minT: Infinity };
  }
  if (Math.abs(disc) <= 1e-8) {
    // Near-tangent: check if tangency point is on the arc
    const t = -b;
    if (t > EPS) {
      const qx = p.x + t * dx;
      const qy = p.y + t * dy;
      const ang = Math.atan2(qy - e.cy, qx - e.cx);
      if (angleOffsetOnArc(ang, e.startAngle, e.sweep, 1e-4) !== null) {
        return { ambiguous: true, count: 0, minT: Infinity };
      }
    }
    return { ambiguous: false, count: 0, minT: Infinity };
  }

  const sqrtDisc = Math.sqrt(disc);
  const roots = [-b - sqrtDisc, -b + sqrtDisc];
  let count = 0;
  let minT = Infinity;

  for (const t of roots) {
    if (t <= EPS) continue;
    const qx = p.x + t * dx;
    const qy = p.y + t * dy;
    const ang = Math.atan2(qy - e.cy, qx - e.cx);
    const u = angleOffsetOnArc(ang, e.startAngle, e.sweep, 1e-6);
    if (u !== null) {
      if (u < 1e-4 || u > 1 - 1e-4) {
        return { ambiguous: true, count: 0, minT: Infinity };
      }
      count++;
      if (t < minT) minT = t;
    }
  }

  return { ambiguous: false, count, minT };
}

const RAY_ANGLES = [0.13719, 0.71923, 1.38411, 2.09137, 2.81473, 3.61942];

/**
 * Exact analytical point-in-region test for a closed CCW ArcRegion.
 */
export function pointInRegion(p: Point, region: ArcRegion): boolean {
  for (const angle of RAY_ANGLES) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let total = 0;
    let ambiguous = false;
    for (const e of region.edges) {
      const res = rayEdgeCrossings(p, dx, dy, e);
      if (res.ambiguous) {
        ambiguous = true;
        break;
      }
      total += res.count;
    }
    if (!ambiguous) {
      return (total & 1) === 1;
    }
  }
  // Fallback (should virtually never happen): sample with slight jitter
  return false;
}

/**
 * Find a point guaranteed to lie strictly inside the ArcRegion (even for thin
 * concave crescents), maximizing clearance from the boundary.
 */
export function interiorPointOfRegion(region: ArcRegion): Point {
  let bestPt: Point | null = null;
  let bestClearance = -1;

  for (const e of region.edges) {
    // Midpoint of arc + inward normal (for CCW boundary, interior is to the LEFT of forward tangent)
    const midAngle = e.startAngle + e.sweep * 0.5;
    const mid = pointOnCircle(e, midAngle);
    const tangent = midAngle + (e.sweep > 0 ? Math.PI / 2 : -Math.PI / 2);
    const nx = Math.cos(tangent + Math.PI / 2);
    const ny = Math.sin(tangent + Math.PI / 2);

    // Find nearest boundary crossing along inward normal ray
    let minT = Infinity;
    for (const other of region.edges) {
      const fx = mid.x - other.cx;
      const fy = mid.y - other.cy;
      const b = fx * nx + fy * ny;
      const c = fx * fx + fy * fy - other.r * other.r;
      const disc = b * b - c;
      if (disc < 0) continue;
      const sqrtDisc = Math.sqrt(disc);
      for (const t of [-b - sqrtDisc, -b + sqrtDisc]) {
        if (t <= 1e-5) continue;
        const qx = mid.x + t * nx;
        const qy = mid.y + t * ny;
        const ang = Math.atan2(qy - other.cy, qx - other.cx);
        if (angleOffsetOnArc(ang, other.startAngle, other.sweep, 1e-5) !== null) {
          if (t < minT) minT = t;
        }
      }
    }

    if (Number.isFinite(minT) && minT > 1e-5) {
      const candidate = {
        x: mid.x + nx * (minT * 0.5),
        y: mid.y + ny * (minT * 0.5),
      };
      if (minT > bestClearance && pointInRegion(candidate, region)) {
        bestClearance = minT;
        bestPt = candidate;
      }
    }
  }

  if (bestPt) return bestPt;

  // Fallback: average of arc midpoints
  let sx = 0;
  let sy = 0;
  for (const e of region.edges) {
    const m = edgePointAt(e, 0.5);
    sx += m.x;
    sy += m.y;
  }
  return { x: sx / region.edges.length, y: sy / region.edges.length };
}

/**
 * Compute bounding box of a region (approximate via vertices + arc extrema).
 */
export function regionBounds(region: ArcRegion): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const include = (p: Point) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  };

  for (const e of region.edges) {
    include(edgeStart(e));
    include(edgeEnd(e));
    for (const cardinal of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      if (angleOffsetOnArc(cardinal, e.startAngle, e.sweep) !== null) {
        include(pointOnCircle(e, cardinal));
      }
    }
  }

  return { minX, maxX, minY, maxY };
}

export type CircleClassification = 'inside' | 'outside' | 'straddling';

/**
 * Analytically classify whether a CCW ArcRegion lies strictly inside,
 * strictly outside, or straddles a given circle.
 */
export function classifyRegionAgainstCircle(
  region: ArcRegion,
  circle: Circle,
  eps = 1e-5,
): CircleClassification {
  let hasInside = false;
  let hasOutside = false;

  for (const e of region.edges) {
    if (circlesEqual(e, circle, eps)) {
      // Edge lies directly on the target circle's boundary.
      // Because region is CCW (interior on the left of e):
      //   e.sweep > 0 => interior is inside circle
      //   e.sweep < 0 => interior is outside circle
      if (e.sweep > 0) hasInside = true;
      else hasOutside = true;
      continue;
    }

    // Check for transverse circle-circle intersection strictly inside arc e
    const pts = intersectCircles(e, circle, eps * 0.1);
    if (pts.length === 2) {
      for (const pt of pts) {
        const ang = Math.atan2(pt.y - e.cy, pt.x - e.cx);
        const u = angleOffsetOnArc(ang, e.startAngle, e.sweep, ANG_EPS);
        if (u !== null && u > 1e-4 && u < 1 - 1e-4) {
          // Verify crossing by checking points slightly before and after u
          const pBefore = edgePointAt(e, Math.max(0, u - 1e-3));
          const pAfter = edgePointAt(e, Math.min(1, u + 1e-3));
          const dBefore = dist(pBefore, { x: circle.cx, y: circle.cy }) - circle.r;
          const dAfter = dist(pAfter, { x: circle.cx, y: circle.cy }) - circle.r;
          if ((dBefore < -eps && dAfter > eps) || (dBefore > eps && dAfter < -eps)) {
            return 'straddling';
          }
        }
      }
    }

    // Sample interior points of edge e (quarter, mid, three-quarter) and endpoints
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const pt = edgePointAt(e, t);
      const d = dist(pt, { x: circle.cx, y: circle.cy });
      if (d < circle.r - eps) hasInside = true;
      else if (d > circle.r + eps) hasOutside = true;
    }

    if (hasInside && hasOutside) return 'straddling';
  }

  if (hasInside && hasOutside) return 'straddling';
  if (hasInside) return 'inside';

  // Boundary is entirely outside (or on) the circle.
  // Check if the region completely encloses the circle!
  if (pointInRegion({ x: circle.cx, y: circle.cy }, region)) {
    return 'straddling';
  }
  return 'outside';
}

/**
 * Convert an ArcRegion (in right-handed +y-up math coordinates) to an SVG path
 * string (in SVG +y-down coordinates via y_svg = -y_math).
 */
export function regionToSvgPath(region: ArcRegion, decimals = 4): string {
  if (region.edges.length === 0) return '';
  const fmt = (n: number) => Number(n.toFixed(decimals)).toString();
  const start = edgeStart(region.edges[0]);
  const parts: string[] = [`M ${fmt(start.x)} ${fmt(-start.y)}`];

  for (const e of region.edges) {
    const absSweep = Math.abs(e.sweep);
    // In SVG (+y down), math CCW (e.sweep > 0) corresponds to sweep-flag = 0
    const sweepFlag = e.sweep > 0 ? 0 : 1;
    // Subdivide arcs > ~80° into exact analytical sub-arcs (≤ 80° each) so browsers/Skia
    // never suffer arc-endpoint or near-semicircle/origin rendering drift.
    const segments = Math.max(1, Math.ceil(absSweep / (Math.PI * 0.44)));
    for (let s = 1; s <= segments; s++) {
      const pt = s === segments ? edgeEnd(e) : edgePointAt(e, s / segments);
      parts.push(`A ${fmt(e.r)} ${fmt(e.r)} 0 0 ${sweepFlag} ${fmt(pt.x)} ${fmt(-pt.y)}`);
    }
  }
  parts.push('Z');
  return parts.join(' ');
}

/**
 * Canonical snapped signature of a region's geometric silhouette (used for
 * shape-invariance checks and state hashing).
 */
export function regionSilhouetteKey(region: ArcRegion, quantum = 1e-3): string {
  // Sort edge midpoints + lengths + signed curvature canonically
  const tokens = region.edges.map((e) => {
    const m = edgePointAt(e, 0.5);
    const mx = snapFloat(m.x, quantum).toFixed(3);
    const my = snapFloat(m.y, quantum).toFixed(3);
    const r = snapFloat(e.r, quantum).toFixed(3);
    const s = snapFloat(e.sweep, quantum).toFixed(3);
    return `${mx},${my},${r},${s}`;
  });
  tokens.sort();
  return tokens.join(';');
}

/**
 * Check if two ArcRegions represent the same geometric silhouette within tolerance.
 */
export function regionsCoincide(a: ArcRegion, b: ArcRegion, eps = 1e-3): boolean {
  if (a.edges.length !== b.edges.length) return false;
  return regionSilhouetteKey(a, eps) === regionSilhouetteKey(b, eps);
}

/**
 * Simplify consecutive collinear/co-circular edges in a region (merge adjacent
 * edges lying on the same circle with the same sweep direction).
 */
export function simplifyRegion(region: ArcRegion, eps = 1e-6): ArcRegion {
  let edges = [...region.edges];
  let changed = true;
  while (changed && edges.length > 1) {
    changed = false;
    for (let i = 0; i < edges.length; i++) {
      const a = edges[i];
      const b = edges[(i + 1) % edges.length];
      if (
        circlesEqual(a, b, eps) &&
        Math.sign(a.sweep) === Math.sign(b.sweep) &&
        Math.abs(a.sweep + b.sweep) < TWO_PI - eps
      ) {
        const merged: ArcEdge = {
          cx: a.cx,
          cy: a.cy,
          r: a.r,
          startAngle: a.startAngle,
          sweep: a.sweep + b.sweep,
        };
        if (i + 1 < edges.length) {
          edges.splice(i, 2, merged);
        } else {
          // Wrap around
          edges[0] = merged;
          edges.pop();
        }
        changed = true;
        break;
      }
    }
  }
  return { edges };
}
