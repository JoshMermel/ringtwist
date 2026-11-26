import { describe, expect, it } from 'vitest';
import { decodeShareHash, encodeShareHash } from '../ui/storage.ts';
import { buildPuzzle } from './builder.ts';
import { getPuzzleSpec } from './catalog.ts';
import { computeMacroCyclePreview } from './cyclePreview.ts';
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
