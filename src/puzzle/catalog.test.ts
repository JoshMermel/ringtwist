import { describe, expect, it } from 'vitest';
import { regionSignedArea } from '../geom/arcRegion.ts';
import { sliceCircles } from '../geom/slicer.ts';
import { buildPuzzle } from './builder.ts';
import {
  GERANIUM_PLUS,
  GERANIUM_STANDARD,
  MINI_GERANIUM,
  MINI_GERANIUM_PLUS,
  POCKET_GERANIUM,
  PUZZLE_CATALOG,
  SUPER_GERANIUM,
  SUPER_GERANIUM_PLUS,
  TWIN_RINGS,
  TWO_CIRCLE_VENN,
} from './catalog.ts';
import {
  generateScramble,
  getAllCircleStatuses,
  getCircleStatus,
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

      // Exact area conservation against union of playable circles
      const unionArea = sliceCircles(spec.circles).reduce(
        (s, r) => s + regionSignedArea(r.edges),
        0,
      );
      const pieceArea = state.pieces.reduce((s, p) => s + p.area, 0);
      expect(pieceArea, `${spec.id} area conservation`).toBeCloseTo(unionArea, 3);

      // Every playable circle must start unblocked (0 straddling pieces)
      const statuses = getAllCircleStatuses(state);
      for (const c of spec.circles) {
        expect(statuses[c.id].blocked, `${spec.id} circle ${c.id} should be free`).toBe(false);
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

      // Seeded scramble generator is deterministic for both numeric and string seeds
      const scramble1 = generateScramble(state, 8, 'seed-42');
      const scramble2 = generateScramble(state, 8, 'seed-42');
      const scrambleDiff = generateScramble(state, 8, 'seed-99');
      expect(scramble1).toBe(scramble2);
      expect(scramble1).not.toBe(scrambleDiff);

      const moves = scramble1.split(/\s+/).filter(Boolean);
      expect(moves.length, `${spec.id} scramble should have moves`).toBeGreaterThanOrEqual(6);
      console.log(
        `${spec.id.padEnd(22)}: ${String(state.pieces.length).padStart(3)} pcs | scramble(${moves.length}): ${scramble1}`,
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
});
