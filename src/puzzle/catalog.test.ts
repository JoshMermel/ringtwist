import { describe, expect, it } from 'vitest';
import { regionSignedArea } from '../geom/arcRegion.ts';
import { sliceCircles } from '../geom/slicer.ts';
import { buildPuzzle } from './builder.ts';
import {
  CRAZY_LEKKI,
  CUBE4YOU_XO,
  GERANIUM_PLUS,
  GERANIUM_STANDARD,
  GIGAHEX,
  GIGAHEX_PLUS,
  MINI_GERANIUM,
  MINI_GERANIUM_PLUS,
  MOONSPINNER,
  OCTOCRYSTAL,
  POCKET_GERANIUM,
  PUZZLE_CATALOG,
  SUPER_GERANIUM,
  SUPER_GERANIUM_PLUS,
  TWIN_RINGS,
  TWO_CIRCLE_VENN,
  UFO_2D,
} from './catalog.ts';
import { PHI } from './geraniumBuilder.ts';
import {
  flipWholePuzzle,
  generateScramble,
  getAllCircleStatuses,
  getCircleStatus,
  getSupportedMirrorAxes,
  hashPuzzleState,
  isPuzzleSolved,
  rotateWholePuzzle,
  turnCircleBySteps,
  turnCircleNextUnblocked,
} from './engine.ts';

describe('puzzle catalog & Geranium geometry', () => {
  it('builds every puzzle in the catalog cleanly with exact area conservation, 0 straddlers, and deterministic seeded scrambles', () => {
    for (const spec of PUZZLE_CATALOG) {
      const state = buildPuzzle(spec);
      expect(state.pieces.length).toBeGreaterThan(2);

      // Exact area conservation against union of playable circles (or 5-lobe flower for Moonspinner)
      const areaCircles =
        spec.id === 'moonspinner'
          ? [
              spec.circles[1],
              ...Array.from({ length: 5 }, (_, k) => {
                const ang = Math.PI + (k * 2 * Math.PI) / 5;
                return { cx: Math.cos(ang) / PHI, cy: Math.sin(ang) / PHI, r: 1 };
              }),
            ]
          : spec.circles;
      const unionArea = sliceCircles(areaCircles).reduce(
        (s, r) => s + regionSignedArea(r.edges),
        0,
      );
      const pieceArea = state.pieces.reduce((s, p) => s + p.area, 0);
      expect(pieceArea, `${spec.id} area conservation`).toBeCloseTo(unionArea, 3);

      // Every playable circle (and every concentric layer/slice) must start unblocked
      const statuses = getAllCircleStatuses(state);
      for (const c of spec.circles) {
        expect(statuses[c.id].blocked, `${spec.id} circle ${c.id} should be free`).toBe(false);
        if (c.layerRadii && c.layerRadii.length > 1) {
          for (const lo of [{ layer: 1 }, { layer: 2 }, { wide: true }]) {
            expect(
              getCircleStatus(state, c.id, lo).blocked,
              `${spec.id} circle ${c.id} layer ${JSON.stringify(lo)} should be free`,
            ).toBe(false);
          }
        }
      }

      // Whole-puzzle rotation by a full cycle preserves solved state (when symmetric)
      if (spec.symmetryStepDeg > 0) {
        const symCount = Math.round(360 / spec.symmetryStepDeg);
        let cur = state;
        for (let i = 0; i < symCount; i++) {
          const rot = rotateWholePuzzle(cur, 1);
          expect(rot.ok, `${spec.id} symmetry step ${i}`).toBe(true);
          if (rot.ok) cur = rot.nextState;
        }
        expect(isPuzzleSolved(cur, state)).toBe(true);
      } else {
        const rot = rotateWholePuzzle(state, 1);
        expect(rot.ok).toBe(false);
      }

      // Mirror flip symmetries (x = top↔bottom, y = left↔right): involution, 0 straddlers, solved orbit
      const mirrorAxes = getSupportedMirrorAxes(state);
      for (const axis of mirrorAxes) {
        const f1 = flipWholePuzzle(state, axis);
        expect(f1.ok, `${spec.id} flip ${axis}`).toBe(true);
        if (!f1.ok) continue;
        expect(isPuzzleSolved(f1.nextState, state), `${spec.id} flipped ${axis} is solved`).toBe(true);
        const f1Statuses = getAllCircleStatuses(f1.nextState);
        for (const c of spec.circles) {
          expect(f1Statuses[c.id].blocked, `${spec.id} flipped ${axis} circle ${c.id}`).toBe(false);
        }
        const f2 = flipWholePuzzle(f1.nextState, axis);
        expect(f2.ok).toBe(true);
        if (f2.ok) {
          expect(hashPuzzleState(f2.nextState)).toBe(hashPuzzleState(state));
        }
      }
      for (const axis of ['x', 'y'] as const) {
        if (!mirrorAxes.includes(axis)) {
          expect(flipWholePuzzle(state, axis).ok).toBe(false);
        }
      }

      // Seeded scramble generator is deterministic for both numeric and string seeds
      const scramble1 = generateScramble(state, 8, 'seed-42');
      const scramble2 = generateScramble(state, 8, 'seed-42');
      const scrambleDiff = generateScramble(state, 8, 'seed-99');
      expect(scramble1).toBe(scramble2);
      expect(scramble1).not.toBe(scrambleDiff);

      const moves = scramble1.split(/\s+/).filter(Boolean);
      expect(moves.length, `${spec.id} scramble should have moves`).toBeGreaterThanOrEqual(6);
      console.log(
        `${spec.id.padEnd(22)}: ${String(state.pieces.length).padStart(3)} pcs | mirror=[${mirrorAxes.join(',')}] | scramble(${moves.length}): ${scramble1}`,
      );
    }
  }, 15_000);

  it('matches exact piece counts and layouts across the entire Geranium family & 2-circle classics', () => {
    const plus = buildPuzzle(GERANIUM_PLUS);
    const std = buildPuzzle(GERANIUM_STANDARD);
    const superPlus = buildPuzzle(SUPER_GERANIUM_PLUS);
    const superStd = buildPuzzle(SUPER_GERANIUM);
    const pocket = buildPuzzle(POCKET_GERANIUM);
    const miniPlus = buildPuzzle(MINI_GERANIUM_PLUS);
    const mini = buildPuzzle(MINI_GERANIUM);
    const mandorla = buildPuzzle(TWO_CIRCLE_VENN);
    const twinRings = buildPuzzle(TWIN_RINGS);

    expect(plus.pieces.length).toBe(86);
    expect(std.pieces.length).toBe(71);
    expect(superPlus.pieces.length).toBe(196);
    expect(superStd.pieces.length).toBe(156);
    expect(pocket.pieces.length).toBe(60);
    expect(miniPlus.pieces.length).toBe(56);
    expect(mini.pieces.length).toBe(46);
    expect(mandorla.pieces.length).toBe(21);
    expect(twinRings.pieces.length).toBe(67);

    // Pocket Geranium must be 3 circles in a horizontal line (cy === 0)
    expect(POCKET_GERANIUM.circles.length).toBe(3);
    for (const c of POCKET_GERANIUM.circles) {
      expect(c.cy).toBeCloseTo(0, 6);
    }
    expect(POCKET_GERANIUM.circles[0].cx).toBeLessThan(POCKET_GERANIUM.circles[1].cx);
    expect(POCKET_GERANIUM.circles[1].cx).toBeLessThan(POCKET_GERANIUM.circles[2].cx);

    // Verify 5-color oriented central pentagon on Geranium, Geranium Plus, Super Geranium, Super Geranium Plus
    for (const s of [plus, std, superPlus, superStd]) {
      const pent = s.pieces.find((p) => p.stickers && p.stickers.length === 5)!;
      expect(pent, `${s.spec.id} center pentagon`).toBeDefined();
      expect(new Set(pent.stickers!.map((w) => w.color)).size).toBe(5);
    }

    // Verify 6 congruent rounded pentagons on Geranium Plus & Standard Geranium
    const pentPlus = plus.pieces.find((p) => p.stickers && p.stickers.length === 5)!;
    expect(plus.pieces.filter((p) => Math.abs(p.area - pentPlus.area) < 1e-3).length).toBe(6);
  });

  it('exhibits authentic non-doctrinaire blocking on Geranium Plus', () => {
    const plus = buildPuzzle(GERANIUM_PLUS);

    // A1 (36° CW): unlocks D, blocks B, C, E
    const afterA1 = turnCircleBySteps(plus, 'A', 1);
    expect(afterA1.ok).toBe(true);
    if (!afterA1.ok) return;
    expect(getCircleStatus(afterA1.nextState, 'D').blocked).toBe(false);
    expect(getCircleStatus(afterA1.nextState, 'B').blocked).toBe(true);

    // Attempting B after A1 fails and reports specific blocking pieces
    const blockedB = turnCircleBySteps(afterA1.nextState, 'B', 1);
    expect(blockedB.ok).toBe(false);
    if (!blockedB.ok) {
      expect(blockedB.blockingPieceIds.length).toBeGreaterThan(0);
    }

    // A2 (72° CW): blocks all neighboring circles B, C, D, E
    const afterA2 = turnCircleBySteps(plus, 'A', 2);
    expect(afterA2.ok).toBe(true);
    if (afterA2.ok) {
      for (const id of ['B', 'C', 'D', 'E']) {
        expect(getCircleStatus(afterA2.nextState, id).blocked).toBe(true);
      }
    }

    // A3 (108° CW): unlocks C and E
    const afterA3 = turnCircleBySteps(plus, 'A', 3);
    expect(afterA3.ok).toBe(true);
    if (afterA3.ok) {
      expect(getCircleStatus(afterA3.nextState, 'E').blocked).toBe(false);
      expect(getCircleStatus(afterA3.nextState, 'C').blocked).toBe(false);
    }

    // Next-unblocked move A> advances to A1 (36°) where D is free
    const nextRes = turnCircleNextUnblocked(plus, 'A', 1, 1);
    expect(nextRes.ok).toBe(true);
    if (nextRes.ok) {
      expect(nextRes.angleDeg).toBeCloseTo(36, 4);
      expect(getCircleStatus(nextRes.nextState, 'D').blocked).toBe(false);
    }
  });

  it('verifies exact piece counts, multi-layer blocking, exterior turns, and jumbling on Phase 2 & 3 puzzles', () => {
    const lekki = buildPuzzle(CRAZY_LEKKI);
    expect(lekki.pieces.length).toBe(43);
    expect(lekki.mirrorAxes).toEqual(['x']);
    // Turning B by 90° bandages A's outer ring (2A & a) while leaving inner disk A free!
    const afterB1 = turnCircleBySteps(lekki, 'B', 1);
    expect(afterB1.ok).toBe(true);
    if (afterB1.ok) {
      expect(getCircleStatus(afterB1.nextState, 'A', { layer: 1 }).blocked).toBe(false);
      expect(getCircleStatus(afterB1.nextState, 'A', { layer: 2 }).blocked).toBe(true);
      expect(getCircleStatus(afterB1.nextState, 'A', { wide: true }).blocked).toBe(true);
      // Completing a 180° flip on B unlocks 2A and wide a again!
      const afterB2 = turnCircleBySteps(afterB1.nextState, 'B', 1);
      expect(afterB2.ok).toBe(true);
      if (afterB2.ok) {
        expect(getCircleStatus(afterB2.nextState, 'A', { layer: 2 }).blocked).toBe(false);
        expect(getCircleStatus(afterB2.nextState, 'A', { wide: true }).blocked).toBe(false);
      }
    }

    const gigahex = buildPuzzle(GIGAHEX);
    expect(gigahex.pieces.length).toBe(105);
    const gigahexPlus = buildPuzzle(GIGAHEX_PLUS);
    expect(gigahexPlus.pieces.length).toBe(139);
    expect(gigahexPlus.mirrorAxes).toEqual(['y']);

    const moon = buildPuzzle(MOONSPINNER);
    expect(moon.pieces.length).toBe(27);
    // B rotates 20 exterior pieces around (0,0), keeping the 7 inner pieces (moon + lens) fixed!
    const moonB = turnCircleBySteps(moon, 'B', 1);
    expect(moonB.ok).toBe(true);
    if (moonB.ok) {
      expect(moonB.movedPieceIds.length).toBe(20);
      expect(getCircleStatus(moonB.nextState, 'A').blocked).toBe(false);
    }

    const octo = buildPuzzle(OCTOCRYSTAL);
    expect(octo.pieces.length).toBe(64);
    // 135° jumbling move on A unlocks C and D!
    const octoA3 = turnCircleBySteps(octo, 'A', 3);
    expect(octoA3.ok).toBe(true);
    if (octoA3.ok) {
      expect(getCircleStatus(octoA3.nextState, 'C').blocked).toBe(false);
      expect(getCircleStatus(octoA3.nextState, 'D').blocked).toBe(false);
    }

    const xo = buildPuzzle(CUBE4YOU_XO);
    expect(xo.pieces.length).toBe(33);

    const ufo = buildPuzzle(UFO_2D);
    expect(ufo.pieces.length).toBe(100);
  });

  it('verifies complete unbandaging and mirror symmetry on Bauhinium, Cohan Circle, Pocket Quatrium, and doctrinaire peers', () => {
    const expected: Record<string, { pieces: number; mirror: ('x' | 'y')[] }> = {
      bauhinium: { pieces: 28, mirror: ['x'] },
      'bauhinium-plus': { pieces: 34, mirror: ['x', 'y'] },
      'cohan-circle': { pieces: 29, mirror: ['x', 'y'] },
      'pocket-quatrium': { pieces: 35, mirror: ['x', 'y'] },
      'pocket-quatrium-plus': { pieces: 49, mirror: ['x', 'y'] },
      arecibo: { pieces: 69, mirror: ['x', 'y'] },
      mimosa: { pieces: 73, mirror: ['x'] },
      eliac: { pieces: 59, mirror: ['x'] },
      'three-circle-clover': { pieces: 37, mirror: ['y'] },
    };

    for (const [id, exp] of Object.entries(expected)) {
      const spec = PUZZLE_CATALOG.find((p) => p.id === id)!;
      const state = buildPuzzle(spec);
      expect(state.pieces.length, `${id} piece count`).toBe(exp.pieces);
      expect(getSupportedMirrorAxes(state), `${id} mirror axes`).toEqual(exp.mirror);
      // Every single stop turn on every circle must leave all circles completely unblocked (no accidental bandaging)
      for (const c of spec.circles) {
        for (let s = 1; s < c.stopsDeg.length; s++) {
          const res = turnCircleBySteps(state, c.id, s);
          expect(res.ok, `${id} ${c.id}${s}`).toBe(true);
          if (!res.ok) continue;
          const st = getAllCircleStatuses(res.nextState);
          for (const other of spec.circles) {
            expect(
              st[other.id].blocked,
              `${id} after ${c.id}${s}: circle ${other.id} should not be bandaged`,
            ).toBe(false);
          }
        }
      }
    }
  });
});
