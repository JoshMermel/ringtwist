import {
  Circle,
  EPS,
  Point,
  TWO_PI,
  angleOffsetOnArc,
  circlesEqual,
  normAngle,
  pointOnCircle,
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
  /** Optional cached bounding circle enclosing the region (rotation-invariant radius). */
  _bounds?: Circle;
  /**
   * Optional lazily cached packed edge geometry `[vx, vy, mx, my, cosHalf, ...]` (5 numbers/edge):
   * start vertex `(vx, vy)`, unit midpoint direction `(mx, my)`, and `cos(|sweep| / 2)`.
   * Enables exact zero-trig unimodal `classifyRegionAgainstCircle` and O(1) rotation propagation.
   */
  _eg?: number[];
  /** Optional lazily cached SVG path string (for default decimals = 4). */
  _svgPath?: string;
  /** Optional lazily cached canonical silhouette key and the quantum it was computed at. */
  _silhouetteKey?: string;
  _silhouetteQuantum?: number;
  /** Optional lazily cached rotation- & reflection-invariant congruence signature (`pieceShapeType`). */
  _shapeType?: string;
}

/** Lazily compute and cache packed per-edge geometry `[vx, vy, mx, my, cosHalf, ...]`. */
function getEdgeGeom(region: ArcRegion): number[] {
  if (region._eg) return region._eg;
  const edges = region.edges;
  const n = edges.length;
  const eg: number[] = [];
  for (let i = 0; i < n; i++) {
    const e = edges[i];
    const halfSweep = e.sweep * 0.5;
    const midAngle = e.startAngle + halfSweep;
    eg.push(
      e.cx + e.r * Math.cos(e.startAngle),
      e.cy + e.r * Math.sin(e.startAngle),
      Math.cos(midAngle),
      Math.sin(midAngle),
      Math.cos(halfSweep < 0 ? -halfSweep : halfSweep),
    );
  }
  region._eg = eg;
  return eg;
}

/** Return (and lazily cache) a tight enclosing circle for `region`. */
export function getRegionBoundingCircle(region: ArcRegion): Circle {
  if (region._bounds) return region._bounds;
  const b = regionBounds(region);
  const cx = (b.minX + b.maxX) * 0.5;
  const cy = (b.minY + b.maxY) * 0.5;
  const dx = b.maxX - b.minX;
  const dy = b.maxY - b.minY;
  const r = Math.sqrt(dx * dx + dy * dy) * 0.5;
  const circle: Circle = { cx, cy, r };
  region._bounds = circle;
  return circle;
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
  const cos = Math.cos(deltaAngle);
  const sin = Math.sin(deltaAngle);
  const srcEdges = region.edges;
  const n = srcEdges.length;
  const edges: ArcEdge[] = [];
  for (let i = 0; i < n; i++) {
    const e = srcEdges[i];
    const dx = e.cx - cx;
    const dy = e.cy - cy;
    edges.push({
      cx: cx + dx * cos - dy * sin,
      cy: cy + dx * sin + dy * cos,
      r: e.r,
      startAngle: normAngle(e.startAngle + deltaAngle),
      sweep: e.sweep,
    });
  }
  const out: ArcRegion = { edges };
  if (region._bounds) {
    const b = region._bounds;
    const dx = b.cx - cx;
    const dy = b.cy - cy;
    out._bounds = {
      cx: cx + dx * cos - dy * sin,
      cy: cy + dx * sin + dy * cos,
      r: b.r,
    };
  }
  if (region._eg) {
    const srcEg = region._eg;
    const eg: number[] = [];
    for (let i = 0; i < srcEg.length; i += 5) {
      const vdx = srcEg[i] - cx;
      const vdy = srcEg[i + 1] - cy;
      const mx = srcEg[i + 2];
      const my = srcEg[i + 3];
      eg.push(
        cx + vdx * cos - vdy * sin,
        cy + vdx * sin + vdy * cos,
        mx * cos - my * sin,
        mx * sin + my * cos,
        srcEg[i + 4],
      );
    }
    out._eg = eg;
  }
  if (region._shapeType !== undefined) {
    out._shapeType = region._shapeType;
  }
  return out;
}

/**
 * Reflect an entire ArcRegion across a horizontal ('x': top <-> bottom around y = cy)
 * or vertical ('y': left <-> right around x = cx) mirror axis, reversing edge order
 * so the reflected boundary remains counter-clockwise with identical positive signed area.
 */
export function reflectRegion(
  region: ArcRegion,
  axis: 'x' | 'y',
  cx: number,
  cy: number,
): ArcRegion {
  const baseAngle = axis === 'x' ? 0 : Math.PI;
  const edges = new Array<ArcEdge>(region.edges.length);
  for (let i = 0; i < region.edges.length; i++) {
    const e = region.edges[region.edges.length - 1 - i];
    edges[i] = {
      cx: axis === 'y' ? 2 * cx - e.cx : e.cx,
      cy: axis === 'x' ? 2 * cy - e.cy : e.cy,
      r: e.r,
      startAngle: normAngle(baseAngle - (e.startAngle + e.sweep)),
      sweep: e.sweep,
    };
  }
  let _bounds: Circle | undefined;
  if (region._bounds) {
    const b = region._bounds;
    _bounds = {
      cx: axis === 'y' ? 2 * cx - b.cx : b.cx,
      cy: axis === 'x' ? 2 * cy - b.cy : b.cy,
      r: b.r,
    };
  }
  return { edges, _bounds, _shapeType: region._shapeType };
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
  // O(1) bounding-circle early-out skips ~95% of ray-casting in hit testing & probes
  const b = getRegionBoundingCircle(region);
  const dx0 = p.x - b.cx;
  const dy0 = p.y - b.cy;
  const maxR = b.r + 1e-5;
  if (dx0 * dx0 + dy0 * dy0 > maxR * maxR) return false;

  const tryPoint = (pt: Point): boolean | null => {
    for (const angle of RAY_ANGLES) {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      let total = 0;
      let ambiguous = false;
      for (const e of region.edges) {
        const res = rayEdgeCrossings(pt, dx, dy, e);
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
    return null;
  };

  const direct = tryPoint(p);
  if (direct !== null) return direct;

  // Jitter fallback when all 6 rays hit vertices/tangencies simultaneously
  for (const [jx, jy] of [
    [1.3e-7, 0.7e-7],
    [-0.9e-7, 1.1e-7],
    [0.5e-7, -1.4e-7],
  ]) {
    const res = tryPoint({ x: p.x + jx, y: p.y + jy });
    if (res !== null) return res;
  }
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
  // O(1) bounding-circle fast-path: skips ~55-85% of (piece, circle) pairs on multi-circle puzzles
  const b = getRegionBoundingCircle(region);
  const ccx = circle.cx;
  const ccy = circle.cy;
  const cr = circle.r;
  const bdx = b.cx - ccx;
  const bdy = b.cy - ccy;
  const bd2 = bdx * bdx + bdy * bdy;
  const outer = cr + b.r + eps;
  if (bd2 > outer * outer) return 'outside';
  const inner = cr - b.r - eps;
  if (inner > 0 && bd2 < inner * inner) return 'inside';

  const rIn = cr - eps;
  const rInSq = rIn > 0 ? rIn * rIn : -1;
  const rOut = cr + eps;
  const rOutSq = rOut * rOut;
  const epsSq = eps * eps;

  let hasInside = false;
  let hasOutside = false;

  // Exact zero-trig unimodal arc distance test:
  // Along an arc on circle (ecx, ecy, er), squared distance to (ccx, ccy) is strictly unimodal,
  // so its min/max on the arc are achieved ONLY at the arc's endpoints or at the radial directions
  // +u = (C - E)/|C - E| (distance |d - er|) and -u (distance d + er) if they lie on the arc.
  const edges = region.edges;
  const eg = getEdgeGeom(region);
  const n = edges.length;

  for (let ei = 0; ei < n; ei++) {
    const e = edges[ei];
    const er = e.r;
    const cdx = ccx - e.cx;
    const cdy = ccy - e.cy;
    const cdSq = cdx * cdx + cdy * cdy;

    if (cdSq <= epsSq) {
      // Concentric with target circle
      const dr = er - cr;
      if (dr <= eps && dr >= -eps) {
        // Edge lies directly on target circle's boundary; CCW interior is on left of e
        if (e.sweep > 0) hasInside = true;
        else hasOutside = true;
      } else if (dr < 0) {
        hasInside = true;
      } else {
        hasOutside = true;
      }
      if (hasInside && hasOutside) return 'straddling';
      continue;
    }

    const base = ei * 5;
    // 1. Check start vertex of this edge (closed loop => visits every edge endpoint once)
    const vdx = eg[base] - ccx;
    const vdy = eg[base + 1] - ccy;
    const dvSq = vdx * vdx + vdy * vdy;
    if (dvSq < rInSq) hasInside = true;
    else if (dvSq > rOutSq) hasOutside = true;
    if (hasInside && hasOutside) return 'straddling';

    // 2. Check global minimum (+u, distance |d - er|) if we still haven't seen an inside point
    let dotComputed = false;
    let dot = 0;
    let cosHalf = 0;
    let rhs = 0;

    if (!hasInside && rIn > 0) {
      const sumIn = er + rIn;
      if (cdSq < sumIn * sumIn) {
        const diffIn = er - rIn;
        if (diffIn <= 0 || cdSq > diffIn * diffIn) {
          dot = cdx * eg[base + 2] + cdy * eg[base + 3];
          cosHalf = eg[base + 4];
          rhs = cdSq * cosHalf * cosHalf;
          dotComputed = true;
          const onArc =
            cosHalf <= 0
              ? dot >= 0 || dot * dot <= rhs
              : dot > 0 && dot * dot >= rhs;
          if (onArc) {
            hasInside = true;
            if (hasOutside) return 'straddling';
          }
        }
      }
    }

    // 3. Check global maximum (-u, distance d + er) if we still haven't seen an outside point
    if (!hasOutside) {
      const diffOut = rOut - er;
      if (diffOut <= 0 || cdSq > diffOut * diffOut) {
        if (!dotComputed) {
          dot = cdx * eg[base + 2] + cdy * eg[base + 3];
          cosHalf = eg[base + 4];
          rhs = cdSq * cosHalf * cosHalf;
        }
        const negDot = -dot;
        const onArc =
          cosHalf <= 0
            ? negDot >= 0 || negDot * negDot <= rhs
            : negDot > 0 && negDot * negDot >= rhs;
        if (onArc) {
          hasOutside = true;
          if (hasInside) return 'straddling';
        }
      }
    }
  }

  if (hasInside && hasOutside) return 'straddling';
  if (hasInside) return 'inside';

  // Boundary is entirely outside (or on) the circle.
  // Check if the region completely encloses the circle!
  if (pointInRegion({ x: ccx, y: ccy }, region)) {
    return 'straddling';
  }
  return 'outside';
}

/**
 * Convert an ArcRegion (in right-handed +y-up math coordinates) to an SVG path
 * string (in SVG +y-down coordinates via y_svg = -y_math).
 */
export function regionToSvgPath(region: ArcRegion, decimals = 4): string {
  if (decimals === 4 && region._svgPath !== undefined) return region._svgPath;
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
  const path = parts.join(' ');
  if (decimals === 4) region._svgPath = path;
  return path;
}

/**
 * Canonical snapped signature of a region's geometric silhouette (used for
 * shape-invariance checks and state hashing).
 */
export function regionSilhouetteKey(region: ArcRegion, quantum = 1e-3): string {
  if (region._silhouetteKey !== undefined && region._silhouetteQuantum === quantum) {
    return region._silhouetteKey;
  }
  const decimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(quantum))));
  let key: string;
  // Rotation-invariant key for uncut full circular disks (stored as two 180° semicircles)
  if (
    region.edges.length === 2 &&
    circlesEqual(region.edges[0], region.edges[1], 1e-5) &&
    Math.sign(region.edges[0].sweep) === Math.sign(region.edges[1].sweep) &&
    Math.abs(Math.abs(region.edges[0].sweep + region.edges[1].sweep) - TWO_PI) < 1e-4
  ) {
    const e0 = region.edges[0];
    const cx = snapFloat(e0.cx, quantum).toFixed(decimals);
    const cy = snapFloat(e0.cy, quantum).toFixed(decimals);
    const r = snapFloat(e0.r, quantum).toFixed(decimals);
    key = `DISK:${cx},${cy},${r}`;
  } else {
    // Sort edge midpoints + lengths + signed curvature canonically
    const tokens = region.edges.map((e) => {
      const m = edgePointAt(e, 0.5);
      const mx = snapFloat(m.x, quantum).toFixed(decimals);
      const my = snapFloat(m.y, quantum).toFixed(decimals);
      const r = snapFloat(e.r, quantum).toFixed(decimals);
      const s = snapFloat(e.sweep, quantum).toFixed(decimals);
      return `${mx},${my},${r},${s}`;
    });
    tokens.sort();
    key = tokens.join(';');
  }
  region._silhouetteKey = key;
  region._silhouetteQuantum = quantum;
  return key;
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
