import { describe, expect, it } from 'vitest';
import { decodeShareHash, encodeShareHash } from '../ui/storage.ts';
import { buildPuzzle } from './builder.ts';
import { getPuzzleSpec } from './catalog.ts';
import {
  CRAZY_LEKKI_DOC,
  CUBE4YOU_XO_DOC,
  GIGAHEX_PLUS_DOC,
  MOONSPINNER_DOC,
  OCTOCRYSTAL_DOC,
} from './definitions.ts';
import {
  RingTwistPuzzleDoc,
  evalNumExpr,
  resolveParams,
  validateRingTwistDoc,
} from './format.ts';
import { compileRingTwistDoc } from './formatBuilder.ts';

describe('RingTwist v1 math expressions & validation', () => {
  it('evaluates constants, arithmetic, functions, and derived params cleanly', () => {
    const env = resolveParams({
      a: '2 * cos(rad(36))',
      b: 'sqrt(2) / 2',
      c: 'a + phi',
    });
    expect(env.a).toBeCloseTo((1 + Math.sqrt(5)) / 2, 10);
    expect(env.b).toBeCloseTo(Math.SQRT1_2, 10);
    expect(env.c).toBeCloseTo(1 + Math.sqrt(5), 10);
    expect(evalNumExpr('-1 + 2 * (3 + 4) / 7', env)).toBeCloseTo(1, 10);
    expect(evalNumExpr('sin(rad(30)) + cos(rad(60))', env)).toBeCloseTo(1, 10);
    expect(evalNumExpr('deg(pi / 3)', env)).toBeCloseTo(60, 10);
    expect(evalNumExpr('sqrt3 * sqrt3', env)).toBeCloseTo(3, 10);
  });

  it('rejects unknown identifiers and syntax errors safely (no eval)', () => {
    expect(() => evalNumExpr('process.exit(1)', {})).toThrow();
    expect(() => evalNumExpr('unknownVar + 1', {})).toThrow();
    expect(() => evalNumExpr('1 + (2 * 3', {})).toThrow();
  });

  it('validates good docs and rejects malformed docs with clear errors', () => {
    expect(validateRingTwistDoc(MOONSPINNER_DOC).ok).toBe(true);
    expect(validateRingTwistDoc(CRAZY_LEKKI_DOC).ok).toBe(true);
    expect(validateRingTwistDoc(GIGAHEX_PLUS_DOC).ok).toBe(true);
    expect(validateRingTwistDoc(OCTOCRYSTAL_DOC).ok).toBe(true);
    expect(validateRingTwistDoc(CUBE4YOU_XO_DOC).ok).toBe(true);

    const badFormat = validateRingTwistDoc({ ...MOONSPINNER_DOC, format: 'other/v1' });
    expect(badFormat.ok).toBe(false);

    const badId = validateRingTwistDoc({ ...MOONSPINNER_DOC, id: 'Has Spaces!' });
    expect(badId.ok).toBe(false);

    const badAxisId = validateRingTwistDoc({
      format: 'ringtwist/v1',
      id: 'reserved-axis',
      name: 'Reserved Axis',
      axes: [{ id: 'Z', cx: 0, cy: 0, r: 1, stops: 4, color: '#ef4444' }],
    });
    expect(badAxisId.ok).toBe(false);

    const emptyAxes = validateRingTwistDoc({
      format: 'ringtwist/v1',
      id: 'empty',
      name: 'Empty',
      axes: [],
    });
    expect(emptyAxes.ok).toBe(false);
  });
});

describe('RingTwist v1 features & URL share round-trip', () => {
  it('reproduces GigaHex exact 6-color rotated-lens distribution natively in ringtwist/v1', () => {
    const state = buildPuzzle(getPuzzleSpec('gigahex'));
    const counts = new Map<string, number>();
    for (const p of state.pieces) counts.set(p.color, (counts.get(p.color) ?? 0) + 1);
    expect(counts.get('#16a34a')).toBe(17);
    expect(counts.get('#ef4444')).toBe(17);
    expect(counts.get('#facc15')).toBe(17);
    expect(counts.get('#f97316')).toBe(17);
    expect(counts.get('#2563eb')).toBe(17);
    expect(counts.get('#1e293b')).toBe(20);
  });

  it('supports predicate bandage.where, masked cutCircles (only/skip), and repeatSymmetry region coloring', () => {
    const doc: RingTwistPuzzleDoc = {
      format: 'ringtwist/v1',
      id: 'ext-feature-test',
      name: 'Extension Feature Test',
      symmetryStepDeg: 180,
      axes: [
        { id: 'A', cx: -0.6, cy: 0, r: 1, stops: 4, color: '#ef4444' },
        { id: 'B', cx: 0.6, cy: 0, r: 1, stops: 4, color: '#38bdf8' },
      ],
      cuts: [
        { op: 'sliceByAxes' },
        // Masked cut: cut only pieces inside A∩B by an inner circle centered at origin
        {
          op: 'cutCircles',
          circles: [{ cx: 0, cy: 0, r: 0.35 }],
          only: { inside: ['A', 'B'] },
        },
        // Predicate bandage: fuse the newly split A∩B pieces back into 1 overlap lens!
        {
          op: 'bandage',
          where: [{ inside: ['A', 'B'] }],
        },
      ],
      coloring: [
        { type: 'fill', color: '#facc15' },
        {
          type: 'region',
          inside: ['A'],
          memberCount: 1,
          repeatSymmetry: { count: 2, colors: ['#ef4444', '#38bdf8'] },
        },
      ],
    };
    const state = buildPuzzle(compileRingTwistDoc(doc));
    // A\B (red), B\A (blue), and re-fused A∩B (yellow) = 3 pieces!
    expect(state.pieces.length).toBe(3);
    const cols = new Set(state.pieces.map((p) => p.color));
    expect(cols).toEqual(new Set(['#ef4444', '#38bdf8', '#facc15']));
  });

  it('round-trips puzzle state, scramble, alg, and macros through URL share hashes', () => {
    const hash = encodeShareHash({
      puzzleId: 'geranium-plus',
      scrambleSeed: 'demo-seed',
      scrambleMoves: 80,
      alg: 'A B A\' B\'',
      macros: [{ name: 'comm', body: '[A, B]', focusTypes: ['big3'] }],
    });
    const decoded = decodeShareHash(hash);
    expect(decoded).not.toBeNull();
    expect(decoded?.puzzleId).toBe('geranium-plus');
    expect(decoded?.scrambleSeed).toBe('demo-seed');
    expect(decoded?.scrambleMoves).toBe(80);
    expect(decoded?.alg).toBe('A B A\' B\'');
    expect(decoded?.macros).toEqual([{ name: 'comm', body: '[A, B]', focusTypes: ['big3'] }]);
  });
});
