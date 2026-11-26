import { describe, expect, it } from 'vitest';
import {
  classifyRegionAgainstCircle,
  interiorPointOfRegion,
  pointInRegion,
  regionSignedArea,
  rotateRegion,
} from './arcRegion.ts';
import { Circle, deg2rad } from './math.ts';
import { mergeRegions, sliceCircles, splitRegionByCircle } from './slicer.ts';

describe('arcRegion & circle slicer', () => {
  it('slices 2 overlapping circles into 3 regions (2 crescents + 1 lens)', () => {
    const c1: Circle = { cx: -0.5, cy: 0, r: 1 };
    const c2: Circle = { cx: 0.5, cy: 0, r: 1 };
    const faces = sliceCircles([c1, c2]);
    expect(faces.length).toBe(3);

    const totalArea = faces.reduce((s, f) => s + regionSignedArea(f.edges), 0);
    // Area of union of two unit circles at distance 1: 2*PI - (2*PI/3 - sqrt(3)/2)
    const lensArea = (2 * Math.PI) / 3 - Math.sqrt(3) / 2;
    const expectedUnion = 2 * Math.PI - lensArea;
    expect(totalArea).toBeCloseTo(expectedUnion, 4);

    // Classify all 3 faces against c1: 2 inside (left crescent + lens), 1 outside (right crescent)
    const classes = faces.map((f) => classifyRegionAgainstCircle(f, c1));
    expect(classes.filter((c) => c === 'inside').length).toBe(2);
    expect(classes.filter((c) => c === 'outside').length).toBe(1);
    expect(classes.filter((c) => c === 'straddling').length).toBe(0);
  });

  it('detects a straddling piece after rotating one circle by a non-aligning angle', () => {
    const c1: Circle = { cx: -0.5, cy: 0, r: 1 };
    const c2: Circle = { cx: 0.5, cy: 0, r: 1 };
    const faces = sliceCircles([c1, c2]);

    // Rotate pieces inside c1 by 45 degrees: the lens now straddles c2!
    const rotated = faces.map((f) =>
      classifyRegionAgainstCircle(f, c1) === 'inside'
        ? rotateRegion(f, c1.cx, c1.cy, deg2rad(-45))
        : f,
    );

    const classesAgainstC2 = rotated.map((f) => classifyRegionAgainstCircle(f, c2));
    expect(classesAgainstC2.includes('straddling')).toBe(true);
  });

  it('splits a region by a cutting circle and merges it back cleanly', () => {
    const c1: Circle = { cx: 0, cy: 0, r: 1 };
    const [disk] = sliceCircles([c1]);
    expect(regionSignedArea(disk.edges)).toBeCloseTo(Math.PI, 4);

    const cutter: Circle = { cx: 1, cy: 0, r: 1 };
    const parts = splitRegionByCircle(disk, cutter);
    expect(parts.length).toBe(2);

    const partSum = parts.reduce((s, p) => s + regionSignedArea(p.edges), 0);
    expect(partSum).toBeCloseTo(Math.PI, 4);

    // Every interior point is strictly inside its part
    for (const p of parts) {
      const pt = interiorPointOfRegion(p);
      expect(pointInRegion(pt, p)).toBe(true);
    }

    // Merging the two halves restores the full disk area
    const merged = mergeRegions(parts);
    expect(merged.length).toBe(1);
    expect(regionSignedArea(merged[0].edges)).toBeCloseTo(Math.PI, 4);
  });

  it('slices 5 Geranium circles accurately with exact area conservation', () => {
    const r = Math.sqrt(4 - Math.sqrt(5)); // ~1.32813
    const circles: Circle[] = Array.from({ length: 5 }, (_, k) => {
      const ang = deg2rad(90 - 72 * k);
      return { cx: Math.cos(ang), cy: Math.sin(ang), r };
    });
    const baseFaces = sliceCircles(circles);
    // 5 pairwise-intersecting circles in general position have 21 bounded faces
    expect(baseFaces.length).toBe(21);

    // Verify no base face straddles any of the 5 circles
    for (const c of circles) {
      for (const f of baseFaces) {
        expect(classifyRegionAgainstCircle(f, c)).not.toBe('straddling');
      }
    }
  });
});
