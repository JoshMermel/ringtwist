import { describe, expect, it } from 'vitest';
import { reflectRegion, rotateRegion } from '../geom/arcRegion.ts';
import { decodeShareHash, encodeShareHash } from '../ui/storage.ts';
import { buildPuzzle } from './builder.ts';
import { getPuzzleSpec } from './catalog.ts';
import {
  computeMacroCyclePreview,
  pieceShapeType,
  toggleFocusTypeAtPoint,
} from './cyclePreview.ts';
import { generateScramble } from './engine.ts';
import { parseSolveTranscript, serializeSolveTranscript } from './solveStack.ts';

describe('macro piece-cycle preview', () => {
  it('detects exact permutation cycles for a commutator on 2-Circle Venn', () => {
    const state = buildPuzzle(getPuzzleSpec('two-circle'));
    const preview = computeMacroCyclePreview(state, '[A, B]', [], 'comm');
    expect(preview.ok).toBe(true);
    expect(preview.blocked).toBeUndefined();
    expect(preview.arrows.length).toBeGreaterThan(0);
    expect(preview.cycleLengths.length).toBeGreaterThan(0);
    expect(preview.summary).toMatch(/cycle/);
  });

  it('reports identity cleanly for a trivial move pair', () => {
    const state = buildPuzzle(getPuzzleSpec('geranium-plus'));
    const preview = computeMacroCyclePreview(state, "A A'", [], 'noop');
    expect(preview.ok).toBe(true);
    expect(preview.arrows).toEqual([]);
    expect(preview.spins).toEqual([]);
    expect(preview.summary).toMatch(/identity/i);
  });

  it('reports blocked info when a macro cannot execute from the current state', () => {
    const state = buildPuzzle(getPuzzleSpec('geranium-plus'));
    // Turning A by 2 stops (72°) leaves B/E straddling on Geranium Plus
    const preview = computeMacroCyclePreview(state, 'A2 B', [], 'bad');
    expect(preview.ok).toBe(true);
    expect(preview.blocked).toBeDefined();
    expect(preview.blocked?.circleId).toBe('B');
    expect(preview.summary).toMatch(/Blocked at B/);
  });

  it('reports exact signed CW spin angle for in-place sticker rotations and ignores invisible solid-piece spins', () => {
    const state = buildPuzzle(getPuzzleSpec('geranium-plus'));
    // Whole-puzzle rotation z rotates the oriented 5-color central pentagon by +72° CW in place
    const zPrev = computeMacroCyclePreview(state, 'z', [], 'rot');
    expect(zPrev.ok).toBe(true);
    expect(zPrev.spins.length).toBe(1);
    expect(zPrev.spins[0].angleDeg).toBe(72);
    expect(zPrev.summary).toContain('↻ 72°');

    const zInvPrev = computeMacroCyclePreview(state, "z'", [], 'rotInv');
    expect(zInvPrev.spins.length).toBe(1);
    expect(zInvPrev.spins[0].angleDeg).toBe(-72);
    expect(zInvPrev.summary).toContain('↺ 72°');

    // On a single-color puzzle with a symmetric center piece (e.g. 4-Circle Clover / Roto 36),
    // rotating a solid-color piece in place should NOT emit bogus moved arrows
    const r36 = buildPuzzle(getPuzzleSpec('roto-36'));
    const r36Spin = computeMacroCyclePreview(r36, 'A', [], 'turnA');
    expect(r36Spin.ok).toBe(true);
    // The central hexagon of A stays in place (solid red) — only the 18 surrounding pieces should have arrows!
    expect(r36Spin.arrows.length).toBe(18);
    expect(r36Spin.spins.length).toBe(0);
  });

  it('computes rotation- and mirror-invariant pieceShapeType IDs and filters by piece type cleanly', () => {
    const gp = buildPuzzle(getPuzzleSpec('geranium-plus'));
    // Every piece keeps its exact shapeType under arbitrary rotation and mirror reflection
    for (const p of gp.pieces.slice(0, 12)) {
      const base = pieceShapeType(p.region);
      expect(pieceShapeType(rotateRegion(p.region, 0, 0, 1.234))).toBe(base);
      expect(pieceShapeType(reflectRegion(p.region, 'x', 0, 0))).toBe(base);
      expect(pieceShapeType(reflectRegion(p.region, 'y', 0, 0))).toBe(base);
    }

    // On Geranium Plus, z moves multiple distinct piece types AND spins the central pentagon
    const zFull = computeMacroCyclePreview(gp, 'z', [], 'rot');
    expect(zFull.pieceTypes.length).toBeGreaterThan(2);
    // Largest piece type is the regular pentagon: includes the 5 outer pentagons (arrows) AND central pentagon (spin)!
    const pentType = zFull.pieceTypes[0];
    expect(pentType.hasArrows).toBe(true);
    expect(pentType.hasSpins).toBe(true);

    // Click an outer pentagon -> focuses ONLY the pentagon piece type!
    const pentArrow = zFull.arrows.find((a) => a.shapeType === pentType.shapeType)!;
    const focus1 = toggleFocusTypeAtPoint(undefined, gp, zFull, pentArrow.from);
    expect(focus1).toEqual([pentType.shapeType]);

    // Normal hover with focusTypes fully hides all non-pentagon pieces while keeping pentagon arrows + center spin
    const focused = computeMacroCyclePreview(gp, 'z', [], 'rot', { focusTypes: focus1! });
    const expectedPentArrows = zFull.arrows.filter((a) => a.shapeType === pentType.shapeType).length;
    expect(focused.arrows.length).toBe(expectedPentArrows);
    expect(focused.spins.length).toBe(1);
    expect(focused.hiddenCount).toBe(zFull.arrows.length - expectedPentArrows);
    expect(focused.summary).toContain('hidden');

    // Inverse macro with the exact same focusTypes highlights the exact same piece type!
    const invFocused = computeMacroCyclePreview(gp, "z'", [], "rot'", { focusTypes: focus1! });
    expect(invFocused.arrows.length).toBe(expectedPentArrows);
    expect(invFocused.spins.length).toBe(1);

    // Focus-picking mode keeps non-focused piece types as `dimmed: true`
    const pickView = computeMacroCyclePreview(gp, 'z', [], 'rot', {
      focusTypes: focus1!,
      includeDimmed: true,
    });
    expect(pickView.arrows.length).toBe(zFull.arrows.length);
    expect(pickView.arrows.filter((a) => !a.dimmed).length).toBe(expectedPentArrows);
    expect(pickView.arrows.filter((a) => a.dimmed).length).toBe(
      zFull.arrows.length - expectedPentArrows,
    );

    // Clicking a DIFFERENT pentagon removes the pentagon shape type from focus
    const otherPent = zFull.arrows.find(
      (a) => a.shapeType === pentType.shapeType && a.pieceId !== pentArrow.pieceId,
    )!;
    const focusCleared = toggleFocusTypeAtPoint(focus1!, gp, zFull, otherPent.from);
    expect(focusCleared).toEqual([]);
  });
});

describe('opaque scramble share-hash round-trip & determinism', () => {
  it('round-trips scrambleSeed and scrambleMoves alongside transcript and macros', () => {
    const hash = encodeShareHash({
      puzzleId: 'geranium-plus',
      scrambleSeed: 'friday-night-solve',
      scrambleMoves: 25,
      alg: '// @milestone outer ring\nA3 D3',
      macros: [{ name: 'conj', body: '[A: D3]' }],
    });
    const decoded = decodeShareHash(hash);
    expect(decoded).not.toBeNull();
    expect(decoded?.puzzleId).toBe('geranium-plus');
    expect(decoded?.scrambleSeed).toBe('friday-night-solve');
    expect(decoded?.scrambleMoves).toBe(25);
    expect(decoded?.alg).toBe('// @milestone outer ring\nA3 D3');
    expect(decoded?.macros).toEqual([{ name: 'conj', body: '[A: D3]' }]);
  });

  it('keeps seeded scrambles 100% deterministic for Geranium Plus', () => {
    const state = buildPuzzle(getPuzzleSpec('geranium-plus'));
    const s1 = generateScramble(state, 12, 'solve-seed-v1');
    const s2 = generateScramble(state, 12, 'solve-seed-v1');
    expect(s1).toBe(s2);
  });

  it('round-trips Solve Stack milestones and active scratchpad through transcript serialization', () => {
    const milestones = [
      { label: 'outer ring', alg: 'A3 D3' },
      { label: 'green petals', alg: '[z: conj] B2' },
    ];
    const active = 'E3 A';
    const text = serializeSolveTranscript(milestones, active);
    expect(text).toContain('// @milestone outer ring');
    expect(text).toContain('// @milestone green petals');
    expect(text).toContain('// @active');

    const hydrated = parseSolveTranscript(text);
    expect(hydrated.milestones).toEqual(milestones);
    expect(hydrated.activeAlg).toBe(active);

    // Works cleanly with milestones only (no active draft)
    const textCommittedOnly = serializeSolveTranscript(milestones, '');
    expect(parseSolveTranscript(textCommittedOnly)).toEqual({
      milestones,
      activeAlg: '',
    });

    // Works cleanly with raw draft only (no milestones yet)
    expect(parseSolveTranscript('A2 B3')).toEqual({
      milestones: [],
      activeAlg: 'A2 B3',
    });
  });
});
