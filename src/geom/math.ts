export const EPS = 1e-7;
export const ANG_EPS = 1e-7;
export const TWO_PI = Math.PI * 2;

export interface Point {
  x: number;
  y: number;
}

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

/** Normalize angle to [0, 2*PI). */
export function normAngle(a: number): number {
  if (a >= 0 && a < TWO_PI - 1e-12) return a;
  if (a >= TWO_PI && a < 2 * TWO_PI - 1e-12) return a - TWO_PI;
  if (a < 0 && a >= -TWO_PI) {
    const r = a + TWO_PI;
    return r >= TWO_PI - 1e-12 ? 0 : r;
  }
  let r = a % TWO_PI;
  if (r < 0) r += TWO_PI;
  if (r >= TWO_PI - 1e-12) r = 0;
  return r;
}

/** Normalize signed angle difference to (-PI, PI]. */
export function normAngleSigned(a: number): number {
  let r = (a + Math.PI) % TWO_PI;
  if (r <= 0) r += TWO_PI;
  return r - Math.PI;
}

export function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function distSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function pointsEqual(a: Point, b: Point, eps = EPS): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= eps * eps;
}

export function circlesEqual(a: Circle, b: Circle, eps = EPS): boolean {
  const dr = a.r - b.r;
  if (dr > eps || dr < -eps) return false;
  const dx = a.cx - b.cx;
  const dy = a.cy - b.cy;
  return dx * dx + dy * dy <= eps * eps;
}

export function pointOnCircle(c: Circle, angle: number): Point {
  return {
    x: c.cx + c.r * Math.cos(angle),
    y: c.cy + c.r * Math.sin(angle),
  };
}

/** Rotate point p counter-clockwise around center by deltaAngle (radians). */
export function rotatePoint(p: Point, center: Point, deltaAngle: number): Point {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const cos = Math.cos(deltaAngle);
  const sin = Math.sin(deltaAngle);
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/**
 * Snap a float to a clean precision grid to eliminate floating-point noise
 * (e.g. -0, 1e-16, or 1.0000000000000002) for canonical hashing.
 */
export function snapFloat(v: number, quantum = 1e-6): number {
  const absSnapped = Math.round(Math.abs(v) / quantum) * quantum;
  if (absSnapped < quantum * 0.5) return 0;
  return v < 0 ? -absSnapped : absSnapped;
}

/**
 * Compute intersection points of two distinct circles.
 * Returns 0, 1 (tangent), or 2 intersection points.
 */
export function intersectCircles(a: Circle, b: Circle, eps = EPS): Point[] {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const dSq = dx * dx + dy * dy;
  if (dSq <= eps * eps) {
    // Concentric (or identical)
    return [];
  }
  const sumR = a.r + b.r + eps;
  if (dSq > sumR * sumR) return [];
  const diffR = Math.abs(a.r - b.r) - eps;
  if (diffR > 0 && dSq < diffR * diffR) return [];

  const d = Math.sqrt(dSq);
  const aR2 = a.r * a.r;
  const x = (aR2 - b.r * b.r + dSq) / (2 * d);
  const hSq = aR2 - x * x;

  const invD = 1 / d;
  const px = a.cx + x * dx * invD;
  const py = a.cy + x * dy * invD;

  if (hSq <= eps * eps) {
    return [{ x: px, y: py }];
  }

  const h = Math.sqrt(Math.max(0, hSq));
  const rx = -dy * h * invD;
  const ry = dx * h * invD;

  return [
    { x: px + rx, y: py + ry },
    { x: px - rx, y: py - ry },
  ];
}

/**
 * Check if an angle lies strictly inside (or inclusively on) a directed arc
 * starting at startAngle with signed sweep.
 */
export function angleOffsetOnArc(
  angle: number,
  startAngle: number,
  sweep: number,
  eps = ANG_EPS,
): number | null {
  if (sweep > 0) {
    let delta = normAngle(angle - startAngle);
    if (delta > TWO_PI - eps) delta = 0;
    if (delta <= sweep + eps) {
      return Math.max(0, Math.min(sweep, delta)) / sweep;
    }
    return null;
  } else {
    const absSweep = -sweep;
    let delta = normAngle(startAngle - angle);
    if (delta > TWO_PI - eps) delta = 0;
    if (delta <= absSweep + eps) {
      return Math.max(0, Math.min(absSweep, delta)) / absSweep;
    }
    return null;
  }
}

/** Degrees to radians. */
export function deg2rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Radians to degrees. */
export function rad2deg(rad: number): number {
  return (rad * 180) / Math.PI;
}
