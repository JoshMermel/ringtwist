import {
  ArcRegion,
  classifyRegionAgainstCircle,
  edgePointAt,
  interiorPointOfRegion,
  regionSignedArea,
  regionSilhouetteKey,
  rotateRegion,
} from '../geom/arcRegion.ts';
import { Circle, Point, deg2rad, dist, normAngle } from '../geom/math.ts';
import { splitRegionByCircle } from '../geom/slicer.ts';
import { Piece, PuzzleSpec, StickerWedge } from './types.ts';

/**
 * GeraniumsPot color table (matches GeraniumsPot / twisty-puzzles-2d):
 *   0 white, 1 black, 2 gray, 3 red, 4 green, 5 blue, 6 yellow, 7 purple,
 *   8 teal, 9 orange, 10 light blue, 11 pink, 12 brown, 13 lilac, 14 lime
 */
export const GPOT_COLORS: Record<number, string> = {
  0: '#f8fafc',
  1: '#1e293b',
  2: '#94a3b8',
  3: '#ef4444', // red
  4: '#16a34a', // green
  5: '#2563eb', // blue
  6: '#facc15', // yellow
  7: '#9333ea', // purple
  8: '#14b8a6', // teal
  9: '#f97316', // orange
  10: '#38bdf8', // light blue
  11: '#f472b6', // pink
  12: '#a16207', // brown
  13: '#c084fc', // lilac
  14: '#84cc16', // lime
};

interface GpotRing extends Circle {
  num: number; // 1-based
  angles: number[]; // single-element [36] or array [36,72,36,72,36,72,36]
  anglePos: number;
  type: number; // 0 = playable ring, 1 = non-rotatable helper cutting/pivot ring
}

interface GpotPart {
  num: number; // 1-based
  region: ArcRegion;
  visible: boolean;
  color: string;
}

/**
 * Exact polygon centroid matching GeraniumsPot's `calcPartsContour` (`maxIter=4` => 16 segments/arc)
 * + `calcCentroid` (shoelace area centroid).
 */
function contourCentroid(region: ArcRegion): Point {
  const pts: Point[] = [];
  const segsPerArc = region.edges.length === 1 ? 64 : 16;
  for (const e of region.edges) {
    for (let i = 0; i < segsPerArc; i++) {
      pts.push(edgePointAt(e, i / segsPerArc));
    }
  }
  if (pts.length === 0) return { x: 0, y: 0 };

  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % pts.length];
    const cross = p0.x * p1.y - p1.x * p0.y;
    area2 += cross;
    cx += (p0.x + p1.x) * cross;
    cy += (p0.y + p1.y) * cross;
  }
  if (Math.abs(area2) < 1e-8) {
    const sx = pts.reduce((s, p) => s + p.x, 0);
    const sy = pts.reduce((s, p) => s + p.y, 0);
    return { x: sx / pts.length, y: sy / pts.length };
  }
  return { x: cx / (3 * area2), y: cy / (3 * area2) };
}

/**
 * Exact `sortAndRenumAllParts` comparator from GeraniumsPot / twisty-puzzles-2d:
 * round centroid to 0.1-unit precision, sort descending cy, tie-break ascending cx, assign 1..N.
 */
function sortAndRenumber(parts: GpotPart[]): void {
  const keyed = parts.map((p) => {
    const c = contourCentroid(p.region);
    return {
      part: p,
      cx: Math.round(c.x * 10) / 10,
      cy: Math.round(c.y * 10) / 10,
    };
  });
  keyed.sort((a, b) => (a.cy !== b.cy ? b.cy - a.cy : a.cx - b.cx));
  parts.length = 0;
  keyed.forEach((k, idx) => {
    k.part.num = idx + 1;
    parts.push(k.part);
  });
}

function removeDuplicateParts(parts: GpotPart[]): void {
  const seen = new Set<string>();
  const kept: GpotPart[] = [];
  for (const p of parts) {
    // In native scale ~50-70, quantum 0.05 (~1e-3 in unit coords) matches compareXY(..., 3)
    const key = regionSilhouetteKey(p.region, 0.05);
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(p);
    }
  }
  parts.length = 0;
  parts.push(...kept);
}

function parseRingCommand(cmd: string): { ringNum: number; dir: 1 | -1; step: number } | null {
  const m = cmd.trim().match(/^(\d+)([RL])(\d*)$/);
  if (!m) return null;
  return {
    ringNum: parseInt(m[1], 10),
    dir: m[2] === 'R' ? 1 : -1,
    step: m[3] ? parseInt(m[3], 10) : 1,
  };
}

function findAngleRotate(ring: GpotRing, dir: 1 | -1, freeze: boolean): number {
  if (ring.angles.length === 1) {
    return ring.angles[0];
  }
  const n = ring.angles.length;
  let pos = ring.anglePos;
  let deg: number;
  if (dir > 0) {
    deg = ring.angles[pos];
    pos = (pos + 1) % n;
  } else {
    pos = (pos - 1 + n) % n;
    deg = ring.angles[pos];
  }
  if (!freeze) ring.anglePos = pos;
  return deg;
}

/**
 * Split a flat comma-separated list while respecting nested parentheses `(...)`.
 */
function splitTopLevel(input: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      if (cur.trim()) result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) result.push(cur.trim());
  return result;
}

function unwrapParens(s: string): string {
  const t = s.trim();
  if (t.startsWith('(') && t.endsWith(')')) return t.slice(1, -1).trim();
  return t;
}

/**
 * Safely evaluate simple arithmetic expressions from GeraniumsPot `Param:` lines.
 */
function evalParamExpr(expr: string, params: Record<string, number>): number {
  let clean = expr.replace(/#.*$/, '').trim();
  const keys = Object.keys(params).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    clean = clean.replace(new RegExp(`\\b${k}\\b`, 'g'), `(${params[k]})`);
  }
  const fn = new Function(
    'pi',
    'sin',
    'cos',
    'tan',
    'sqrt',
    'abs',
    `return (${clean});`,
  );
  return Number(fn(Math.PI, Math.sin, Math.cos, Math.tan, Math.sqrt, Math.abs));
}

function transformRegion(
  region: ArcRegion,
  scale: number,
  offsetX: number,
  offsetY: number,
): ArcRegion {
  return {
    edges: region.edges.map((e) => ({
      cx: (e.cx - offsetX) * scale,
      cy: (e.cy - offsetY) * scale,
      r: e.r * scale,
      startAngle: normAngle(e.startAngle),
      sweep: e.sweep,
    })),
  };
}

function rotatePointAround(px: number, py: number, cx: number, cy: number, rad: number): Point {
  const dx = px - cx;
  const dy = py - cy;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: cx + dx * c - dy * s,
    y: cy + dx * s + dy * c,
  };
}

export interface GpotBuildOptions {
  /** Scale factor to normalize script coordinates (e.g. 1/50 for Geranium where ring radius=50). */
  coordScale: number;
  /** Optional origin translation subtracted from script coords BEFORE scaling. */
  originOffset?: Point;
  /** Add 5-color orientation sticker wedges to the central shared pentagon. */
  orientCenterPentagon?: boolean;
}

/**
 * Execute a verbatim GeraniumsPot `.txt` puzzle definition script using our exact
 * analytical ArcRegion engine, returning ready-to-play `Piece[]`.
 */
export function buildFromGeraniumsPotScript(
  script: string,
  spec: PuzzleSpec,
  options: GpotBuildOptions,
): Piece[] {
  const params: Record<string, number> = {};
  const rings: GpotRing[] = [];
  const ringMap = new Map<number, GpotRing>();
  let parts: GpotPart[] = [];
  let initialized = false;

  const playableRings = () => rings.filter((r) => r.type === 0);
  const getMaxNum = () => parts.reduce((m, p) => (p.num > m ? p.num : m), 0);

  const rotatePartInRing = (part: GpotPart, ring: GpotRing, deg: number, dir: 1 | -1) => {
    // In +y-up script coords: R (+1) => CW (-rad), L (-1) => CCW (+rad)
    const rad = deg2rad(-deg * dir);
    part.region = rotateRegion(part.region, ring.cx, ring.cy, rad);
  };

  /**
   * Apply a GeraniumsPot turn specification to a list of parts:
   * - `(ringNum, deg)` or chained `(r1, deg1, r2, deg2, ...)` (positive deg = CW)
   * - `1R3` / `2L` (uses ring's stop angle with freeze=true)
   */
  const applyTurnSpec = (targetParts: GpotPart[], turnSpec: string) => {
    const trimmed = turnSpec.trim();
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      const tokens = splitTopLevel(unwrapParens(trimmed));
      for (let t = 0; t + 1 < tokens.length; t += 2) {
        const ring = ringMap.get(parseInt(tokens[t], 10));
        const deg = evalParamExpr(tokens[t + 1], params);
        if (ring) {
          for (const p of targetParts) rotatePartInRing(p, ring, deg, 1);
        }
      }
    } else {
      const cmd = parseRingCommand(trimmed);
      if (cmd) {
        const ring = ringMap.get(cmd.ringNum);
        if (ring) {
          // freeze = true (does not mutate ring.anglePos), multiplied by step count
          const stepDeg = findAngleRotate(ring, cmd.dir, true);
          const totalDeg = stepDeg * cmd.step;
          for (const p of targetParts) rotatePartInRing(p, ring, totalDeg, cmd.dir);
        }
      }
    }
  };

  const cutPartsByRing = (cutterRing: GpotRing) => {
    let nextNum = getMaxNum() + 1;
    const appended: GpotPart[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part.visible) continue;
      if (classifyRegionAgainstCircle(part.region, cutterRing, 1e-3) !== 'straddling') continue;
      const subs = splitRegionByCircle(part.region, cutterRing, 1e-2);
      if (subs.length >= 2) {
        part.region = subs[0];
        for (let k = 1; k < subs.length; k++) {
          appended.push({
            num: nextNum++,
            region: subs[k],
            visible: true,
            color: part.color,
          });
        }
      }
    }
    if (appended.length > 0) parts.push(...appended);
  };

  const turnRing = (ringNum: number, dir: 1 | -1, step: number, cutAfter: boolean) => {
    const ring = ringMap.get(ringNum);
    if (!ring) return;
    let totalDeg = 0;
    for (let s = 0; s < step; s++) {
      totalDeg += findAngleRotate(ring, dir, false);
    }
    // Rotate ALL parts (including hidden parts) inside this ring
    for (const part of parts) {
      if (classifyRegionAgainstCircle(part.region, ring, 1e-3) === 'inside') {
        rotatePartInRing(part, ring, totalDeg, dir);
      }
    }
    if (cutAfter) {
      for (const r of rings) {
        cutPartsByRing(r);
      }
    }
  };

  const ensureInitialized = () => {
    if (initialized) return;
    initialized = true;
    // Match GeraniumsPot makeDefCircles: each playable ring starts as an uncut full disk
    // (represented by two 180° CCW semicircles). Subsequent AutoCutParts / CutCircles
    // split them and removeDuplicateParts deduplicates shared overlaps!
    parts = playableRings().map((r, idx) => ({
      num: idx + 1,
      region: {
        edges: [
          { cx: r.cx, cy: r.cy, r: r.r, startAngle: 0, sweep: Math.PI },
          { cx: r.cx, cy: r.cy, r: r.r, startAngle: Math.PI, sweep: Math.PI },
        ],
      },
      visible: true,
      color: '#f8fafc',
    }));
  };

  const lines = script.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Param: name, expr
    if (line.startsWith('Param:')) {
      const body = line.slice('Param:'.length).trim();
      const commaIdx = body.indexOf(',');
      if (commaIdx !== -1) {
        const name = body.slice(0, commaIdx).trim();
        const expr = body.slice(commaIdx + 1).trim();
        params[name] = evalParamExpr(expr, params);
      }
      continue;
    }

    // Ring: num, cx, cy, r, angleSpec [, type]
    if (line.startsWith('Ring:')) {
      const body = line.slice('Ring:'.length).replace(/#.*$/, '').trim();
      const fields = splitTopLevel(body);
      const num = parseInt(fields[0], 10);
      const cx = evalParamExpr(fields[1], params);
      const cy = evalParamExpr(fields[2], params);
      const r = evalParamExpr(fields[3], params);
      const angField = unwrapParens(fields[4]);
      const angles = angField.split(',').map((s) => evalParamExpr(s.trim(), params));
      const type = fields.length >= 6 ? parseInt(fields[5], 10) : 0;
      const ring: GpotRing = { num, cx, cy, r, angles, anglePos: 0, type };
      rings.push(ring);
      ringMap.set(num, ring);
      continue;
    }

    // CopyRing: newNum, srcRingNum, (pivotRingNum, deg), radius, angleSpec [, type]
    if (line.startsWith('CopyRing:')) {
      const body = line.slice('CopyRing:'.length).replace(/#.*$/, '').trim();
      const fields = splitTopLevel(body);
      const newNum = parseInt(fields[0], 10);
      const srcRing = ringMap.get(parseInt(fields[1], 10));
      const turnTokens = splitTopLevel(unwrapParens(fields[2]));
      const r = evalParamExpr(fields[3], params);
      const angField = unwrapParens(fields[4]);
      const angles = angField.split(',').map((s) => evalParamExpr(s.trim(), params));
      const type = fields.length >= 6 ? parseInt(fields[5], 10) : 0;
      if (srcRing) {
        let px = srcRing.cx;
        let py = srcRing.cy;
        for (let t = 0; t + 1 < turnTokens.length; t += 2) {
          const pivot = ringMap.get(parseInt(turnTokens[t], 10));
          const deg = evalParamExpr(turnTokens[t + 1], params);
          if (pivot) {
            const rot = rotatePointAround(px, py, pivot.cx, pivot.cy, deg2rad(-deg));
            px = rot.x;
            py = rot.y;
          }
        }
        const ring: GpotRing = { num: newNum, cx: px, cy: py, r, angles, anglePos: 0, type };
        rings.push(ring);
        ringMap.set(newNum, ring);
      }
      continue;
    }

    // AutoCutParts: ...
    if (line.startsWith('AutoCutParts:')) {
      const body = line.slice('AutoCutParts:'.length).replace(/#.*$/, '').trim();
      ensureInitialized();

      if (body.length === 0) {
        // Empty `AutoCutParts:` slices all parts against all current rings (base Venn cut)
        for (const r of rings) {
          cutPartsByRing(r);
        }
      } else {
        const items = splitTopLevel(body);
        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx];

          // Random, N (deterministic seeded random cuts)
          if (item.toLowerCase() === 'random') {
            const count = idx + 1 < items.length ? parseInt(items[++idx], 10) : 20;
            const pr = playableRings();
            if (pr.length > 0) {
              let rng = 0x51a7c3d9;
              const nextRand = () => {
                rng = (rng + 0x6d2b79f5) | 0;
                let t = Math.imul(rng ^ (rng >>> 15), 1 | rng);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
              };
              for (let k = 0; k < count; k++) {
                const chosen = pr[Math.floor(nextRand() * pr.length)];
                const dir: 1 | -1 = nextRand() < 0.5 ? 1 : -1;
                turnRing(chosen.num, dir, 1, true);
              }
            }
            continue;
          }

          if (item.startsWith('(') && item.endsWith(')')) {
            // Check if the next top-level item is a repeat count, e.g. `(1R,2R),7`
            let repeat = 1;
            const hasRepeat = idx + 1 < items.length && /^\d+$/.test(items[idx + 1]);
            if (hasRepeat) {
              repeat = parseInt(items[++idx], 10);
            }
            const subItems = splitTopLevel(unwrapParens(item));
            const cutRingNums: number[] = [];
            const cmds: { ringNum: number; dir: 1 | -1; step: number }[] = [];
            for (const sub of subItems) {
              const cmd = parseRingCommand(sub);
              if (cmd) {
                cmds.push(cmd);
              } else if (/^\d+$/.test(sub)) {
                cutRingNums.push(parseInt(sub, 10));
              }
            }

            if (hasRepeat && cutRingNums.length === 0) {
              // `(1R,2R),7` executes each command in sequence (turning + cutting) `repeat` times
              for (let rep = 0; rep < repeat; rep++) {
                for (const cmd of cmds) {
                  turnRing(cmd.ringNum, cmd.dir, cmd.step, true);
                }
              }
            } else {
              for (let rep = 0; rep < repeat; rep++) {
                for (const cmd of cmds) {
                  turnRing(cmd.ringNum, cmd.dir, cmd.step, false);
                }
                const cutters =
                  cutRingNums.length > 0
                    ? cutRingNums.map((n) => ringMap.get(n)!).filter(Boolean)
                    : playableRings();
                for (const c of cutters) cutPartsByRing(c);
              }
            }
          } else {
            const cmd = parseRingCommand(item);
            if (cmd) {
              turnRing(cmd.ringNum, cmd.dir, cmd.step, true);
            }
          }
        }
      }

      removeDuplicateParts(parts);
      sortAndRenumber(parts);
      continue;
    }

    // CutCircles: r1, r2, ...
    if (line.startsWith('CutCircles:')) {
      ensureInitialized();
      const nums = line
        .slice('CutCircles:'.length)
        .replace(/#.*$/, '')
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
      for (const rn of nums) {
        const ring = ringMap.get(rn);
        if (ring) cutPartsByRing(ring);
      }
      removeDuplicateParts(parts);
      sortAndRenumber(parts);
      continue;
    }

    // HideParts: 15,28
    if (line.startsWith('HideParts:')) {
      const nums = line
        .slice('HideParts:'.length)
        .replace(/#.*$/, '')
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
      const set = new Set(nums);
      for (const p of parts) {
        if (set.has(p.num)) p.visible = false;
      }
      continue;
    }

    if (line === 'InvertAllParts') {
      for (const p of parts) p.visible = !p.visible;
      continue;
    }

    if (line === 'ShowAllParts') {
      for (const p of parts) p.visible = true;
      continue;
    }

    // RemoveParts: 1,2,4,...
    if (line.startsWith('RemoveParts:')) {
      const nums = line
        .slice('RemoveParts:'.length)
        .replace(/#.*$/, '')
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
      const set = new Set(nums);
      parts = parts.filter((p) => !set.has(p.num));
      continue;
    }

    // MoveParts: (ids...), (ringNum, deg), ...
    if (line.startsWith('MoveParts:')) {
      const body = line.slice('MoveParts:'.length).replace(/#.*$/, '').trim();
      const items = splitTopLevel(body);
      for (let i = 0; i + 1 < items.length; i += 2) {
        const partNums = unwrapParens(items[i])
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !Number.isNaN(n));
        const turnSpec = items[i + 1].trim();
        const targets = partNums
          .map((pn) => parts.find((p) => p.num === pn))
          .filter((p): p is GpotPart => Boolean(p));
        applyTurnSpec(targets, turnSpec);
      }
      continue;
    }

    // CopyParts: (14,22,...),1R3, ... OR (23,26),(5,108), ...
    if (line.startsWith('CopyParts:')) {
      const body = line.slice('CopyParts:'.length).replace(/#.*$/, '').trim();
      const items = splitTopLevel(body);
      for (let i = 0; i + 1 < items.length; i += 2) {
        const partNums = unwrapParens(items[i])
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !Number.isNaN(n));
        const turnSpec = items[i + 1].trim();

        const clones: GpotPart[] = [];
        let nextNum = getMaxNum() + 1;
        for (const pn of partNums) {
          const orig = parts.find((p) => p.num === pn);
          if (!orig) continue;
          clones.push({
            num: nextNum++,
            region: { edges: orig.region.edges.map((e) => ({ ...e })) },
            visible: true,
            color: orig.color,
          });
        }

        applyTurnSpec(clones, turnSpec);
        parts.push(...clones);
      }
      continue;
    }

    if (line === 'Renumbering') {
      removeDuplicateParts(parts);
      sortAndRenumber(parts);
      continue;
    }

    // RotateAllParts: deg (CW around origin)
    if (line.startsWith('RotateAllParts:')) {
      const deg = evalParamExpr(line.slice('RotateAllParts:'.length), params);
      const rad = deg2rad(-deg);
      for (const r of rings) {
        const rot = rotatePointAround(r.cx, r.cy, 0, 0, rad);
        r.cx = rot.x;
        r.cy = rot.y;
      }
      for (const p of parts) {
        p.region = rotateRegion(p.region, 0, 0, rad);
      }
      continue;
    }

    // AutoColorParts: c1..cN [, overlap slot colors ...]
    if (line.startsWith('AutoColorParts:')) {
      removeDuplicateParts(parts);
      const colorIds = line
        .slice('AutoColorParts:'.length)
        .replace(/#.*$/, '')
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
      const pr = playableRings();
      const nRings = pr.length;

      if (colorIds.length > nRings) {
        // Exact GeraniumsPot `initColorAllParts` slot formula for overlap-colored puzzles
        for (const p of parts) {
          if (!p.visible) continue;
          let slot = 0;
          for (const ring of pr) {
            if (classifyRegionAgainstCircle(p.region, ring, 1e-3) === 'inside') {
              if (slot === 0) slot = ring.num;
              else if (slot < nRings) slot += ring.num + nRings - 2;
              else slot += ring.num;
            }
          }
          const cid = colorIds[slot - 1];
          if (cid !== undefined && GPOT_COLORS[cid]) {
            p.color = GPOT_COLORS[cid];
          }
        }
      } else {
        for (const p of parts) {
          if (!p.visible) continue;
          const memberIdx: number[] = [];
          for (let i = 0; i < nRings; i++) {
            if (classifyRegionAgainstCircle(p.region, pr[i], 1e-3) === 'inside') {
              memberIdx.push(i);
            }
          }
          if (memberIdx.length === 1) {
            const cid = colorIds[memberIdx[0]];
            if (cid !== undefined && GPOT_COLORS[cid]) p.color = GPOT_COLORS[cid];
          } else if (memberIdx.length === nRings && nRings > 2) {
            p.color = GPOT_COLORS[0];
          } else if (memberIdx.length >= 2) {
            const c0 = colorIds[memberIdx[0]];
            if (
              c0 !== undefined &&
              GPOT_COLORS[c0] &&
              memberIdx.every((mi) => colorIds[mi] === c0)
            ) {
              p.color = GPOT_COLORS[c0];
            }
          }
        }
      }
      continue;
    }

    // SetColorParts: (ids...),colorId, ...
    if (line.startsWith('SetColorParts:')) {
      const body = line.slice('SetColorParts:'.length).replace(/#.*$/, '').trim();
      const items = splitTopLevel(body);
      for (let i = 0; i + 1 < items.length; i += 2) {
        const partNums = unwrapParens(items[i])
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !Number.isNaN(n));
        const cid = parseInt(items[i + 1].trim(), 10);
        const hex = GPOT_COLORS[cid];
        if (!hex) continue;
        const set = new Set(partNums);
        for (const p of parts) {
          if (p.visible && set.has(p.num)) p.color = hex;
        }
      }
      continue;
    }
  }

  removeDuplicateParts(parts);

  // Convert to normalized CircleSim coordinates & Piece[]
  const scale = options.coordScale;
  const ox = options.originOffset?.x ?? 0;
  const oy = options.originOffset?.y ?? 0;
  const result: Piece[] = parts.map((p, idx) => {
    const region = transformRegion(p.region, scale, ox, oy);
    return {
      id: idx,
      region,
      color: p.color,
      homeColor: p.color,
      area: regionSignedArea(region.edges),
    };
  });

  if (options.orientCenterPentagon) {
    attachCenterPentagonStickers(result, spec);
  }

  return result;
}

/**
 * Attach 5 colored orientation wedges to the central pentagon piece matching
 * the exact color of the piece bordering each of its 5 curved edges.
 */
export function attachCenterPentagonStickers(pieces: Piece[], spec: PuzzleSpec): void {
  // For 10-circle Super Geranium, the center pentagon is inside the 5 inner circles (first 5)
  const innerCircles = spec.circles.slice(0, 5);
  if (innerCircles.length < 5) return;
  const centerPiece = pieces.find((p) =>
    innerCircles.every((c) => classifyRegionAgainstCircle(p.region, c) === 'inside'),
  );
  if (!centerPiece || centerPiece.region.edges.length !== 5) return;

  const others = pieces.filter((p) => p !== centerPiece);
  const centerPt = interiorPointOfRegion(centerPiece.region);

  const stickers: StickerWedge[] = centerPiece.region.edges.map((arc) => {
    const mid = edgePointAt(arc, 0.5);
    const dx = mid.x - centerPt.x;
    const dy = mid.y - centerPt.y;
    const len = Math.hypot(dx, dy) || 1;
    const probe = { x: mid.x + (dx / len) * 0.06, y: mid.y + (dy / len) * 0.06 };
    let bestColor = innerCircles[0].color;
    let bestD = Infinity;
    for (const o of others) {
      const pt = interiorPointOfRegion(o.region);
      const d = dist(probe, pt);
      if (d < bestD) {
        bestD = d;
        bestColor = o.color;
      }
    }
    return { apex: centerPt, arc, color: bestColor };
  });

  centerPiece.stickers = stickers;
  centerPiece.homeColor = 'pentagon-5color';
}
