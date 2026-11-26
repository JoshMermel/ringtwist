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
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function pointsEqual(a: Point, b: Point, eps = EPS): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps;
}

export function circlesEqual(a: Circle, b: Circle, eps = EPS): boolean {
  return (
    Math.hypot(a.cx - b.cx, a.cy - b.cy) <= eps &&
    Math.abs(a.r - b.r) <= eps
  );
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
  const snapped = Math.round(v / quantum) * quantum;
  return Math.abs(snapped) < quantum * 0.5 ? 0 : snapped;
}

/**
 * Compute intersection points of two distinct circles.
 * Returns 0, 1 (tangent), or 2 intersection points.
 */
export function intersectCircles(a: Circle, b: Circle, eps = EPS): Point[] {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const d = Math.hypot(dx, dy);

  if (d <= eps) {
    // Concentric (or identical)
    return [];
  }
  if (d > a.r + b.r + eps || d < Math.abs(a.r - b.r) - eps) {
    return [];
  }

  const x = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const hSq = a.r * a.r - x * x;

  const px = a.cx + (x * dx) / d;
  const py = a.cy + (x * dy) / d;

  if (hSq <= eps * eps) {
    return [{ x: px, y: py }];
  }

  const h = Math.sqrt(Math.max(0, hSq));
  const rx = (-dy * h) / d;
  const ry = (dx * h) / d;

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
