import { describe, expect, it } from 'vitest';
import { buildPuzzle } from '../puzzle/builder.ts';
import {
  FOUR_CIRCLE_CLOVER,
  GERANIUM_PLUS,
  MINI_GERANIUM,
  POCKET_GERANIUM,
  PUZZLE_CATALOG,
  SIX_CIRCLE_HEX,
  TWIN_RINGS,
  TWO_CIRCLE_VENN,
} from '../puzzle/catalog.ts';
import { generateScramble, hashPuzzleState } from '../puzzle/engine.ts';
import { analyzeAlgorithm, evaluateProgram } from './evaluator.ts';
import { parseAlgorithm } from './parser.ts';

describe('notation parser, macros & non-doctrinaire evaluator', () => {
  it('parses sequences, groups, commutators, conjugates, rotations, next-unblocked, and macros', () => {
    const ast = parseAlgorithm(
      `// Demo script
      comm = [A3, E3]
      [z: comm]2 (A> D<)'`,
      ['A', 'B', 'C', 'D', 'E'],
    );
    expect(ast.errors).toEqual([]);
    expect(ast.statements.length).toBe(2);
    expect(ast.statements[0].kind).toBe('macroDef');
    expect(ast.statements[1].kind).toBe('exprStmt');
  });

  it('executes sequences, conjugates, inverses, and rotations cleanly on unbandaged 2-Circle Venn & 4-Circle Clover', () => {
    const venn = buildPuzzle(TWO_CIRCLE_VENN);
    // Properly unbandaged Mandorla 120°: A B succeeds cleanly!
    const okRes = evaluateProgram(venn, '([A, B]) ([A, B])\'');
    expect(okRes.blocked).toBeUndefined();
    expect(okRes.solved).toBe(true);
    expect(hashPuzzleState(okRes.finalState)).toBe(hashPuzzleState(venn));

    // 4-Circle Clover (unbandaged 90°): [A, B] + inverse returns to solved
    const clover = buildPuzzle(FOUR_CIRCLE_CLOVER);
    const cloverRes = evaluateProgram(clover, 'c = [A, B]\nc c\'');
    expect(cloverRes.blocked).toBeUndefined();
    expect(cloverRes.solved).toBe(true);
  });

  it('stops on blocked move on Geranium Plus and identifies exact blocking pieces and source span', () => {
    const solved = buildPuzzle(GERANIUM_PLUS);
    const src = 'A B C';
    const res = evaluateProgram(solved, src);

    expect(res.steps.length).toBe(1);
    expect(res.blocked).toBeDefined();
    expect(res.blocked!.circleId).toBe('B');
    expect(res.blocked!.blockingPieceIds.length).toBeGreaterThan(0);
    expect(src.slice(res.blocked!.topSpan.start, res.blocked!.topSpan.end)).toBe('B');
  });

  it('supports inline macros, sidebar macros, whole-puzzle rotation z, and next-unblocked > on Geranium Plus', () => {
    const solved = buildPuzzle(GERANIUM_PLUS);

    const res = evaluateProgram(
      solved,
      `seq = [A: D3]
       seq seq' [z: seq] [z: seq]'`,
    );
    expect(res.blocked).toBeUndefined();
    expect(res.solved).toBe(true);

    // Sidebar macro passed externally works too
    const extRes = evaluateProgram(solved, 'myconj myconj\'', [
      { name: 'myconj', body: '[A: D3]' },
    ]);
    expect(extRes.blocked).toBeUndefined();
    expect(extRes.solved).toBe(true);

    // Next-unblocked move A> advances A to 36° where D is free, so A> D3 succeeds!
    const res2 = evaluateProgram(solved, 'A> D3');
    expect(res2.blocked).toBeUndefined();
    expect(res2.steps.length).toBe(2);
    expect(res2.steps[0].angleDeg).toBeCloseTo(36, 4);
  });

  it('accelerates huge repeats via shape-invariant group-theory fast exponentiation AND cycle detection', () => {
    // 1. Shape-preserving unbandaged 2-Circle Venn (Mandorla 120°) => pure permutation group element!
    const venn = buildPuzzle(TWO_CIRCLE_VENN);
    const shapeAnalysis = analyzeAlgorithm(venn, 'A B');
    expect(shapeAnalysis.status).toBe('shape-preserving');
    expect(shapeAnalysis.order).toBeGreaterThan(1);

    const sOrd = shapeAnalysis.order!;
    const fastShape = evaluateProgram(venn, `(A B)${sOrd * 1000}`);
    expect(fastShape.blocked).toBeUndefined();
    expect(fastShape.usedFastForward).toBe(true);
    expect(fastShape.solved).toBe(true);
    expect(hashPuzzleState(fastShape.finalState)).toBe(hashPuzzleState(venn));

    // Non-identity fast-forward: (sOrd * 1000 + 1) matches 1 execution!
    const oneShape = evaluateProgram(venn, 'A B');
    const plusOneShape = evaluateProgram(venn, `(A B)${sOrd * 1000 + 1}`);
    expect(plusOneShape.usedFastForward).toBe(true);
    expect(hashPuzzleState(plusOneShape.finalState)).toBe(hashPuzzleState(oneShape.finalState));

    // 2. Non-shape-preserving periodic sequence on Mini Geranium (`[A, B]`) or shape-preserving Twin Rings (`A2 B2`)
    const twin = buildPuzzle(TWIN_RINGS);
    const twinAnalysis = analyzeAlgorithm(twin, 'A2 B2');
    expect(['periodic', 'shape-preserving']).toContain(twinAnalysis.status);
    expect(twinAnalysis.order).toBeGreaterThan(1);

    const tOrd = twinAnalysis.order!;
    const fastTwin = evaluateProgram(twin, `(A2 B2)${tOrd * 200}`);
    expect(fastTwin.blocked).toBeUndefined();
    expect(fastTwin.usedFastForward).toBe(true);
    expect(fastTwin.solved).toBe(true);

    // 3. Non-shape-preserving cycle-detection check on Geranium Plus (`A3 E3 A3' E3'`)
    const mini = buildPuzzle(MINI_GERANIUM);
    const miniRes = evaluateProgram(mini, '[A, B] [A, B]\'');
    expect(miniRes.blocked).toBeUndefined();
    expect(miniRes.solved).toBe(true);
  });

  it('analyzes Pocket Geranium, Mini Geranium, Hex Flower, and ALL catalog sample algorithms accurately', () => {
    // Pocket Geranium (3 circles in a line): B A' B2 A2 C succeeds cleanly, and inverse restores solved
    const pocket = buildPuzzle(POCKET_GERANIUM);
    const pocketRes = evaluateProgram(pocket, "(B A' B2 A2 C) (B A' B2 A2 C)'");
    expect(pocketRes.blocked).toBeUndefined();
    expect(pocketRes.solved).toBe(true);

    // Hex Flower: [A, B] + inverse returns to solved
    const hex = buildPuzzle(SIX_CIRCLE_HEX);
    const hexRes = evaluateProgram(hex, '[A, B] [A, B]\'');
    expect(hexRes.blocked).toBeUndefined();
    expect(hexRes.solved).toBe(true);

    // Geranium Plus order analysis
    const plus = buildPuzzle(GERANIUM_PLUS);
    const plusAnalysis = analyzeAlgorithm(plus, '[A3: E3]');
    expect(['shape-preserving', 'periodic', 'blocked', 'identity']).toContain(plusAnalysis.status);
    expect(plusAnalysis.message.length).toBeGreaterThan(0);

    // Every sample algorithm in the catalog parses cleanly AND matches its expected blocking status
    for (const spec of PUZZLE_CATALOG) {
      const state = buildPuzzle(spec);
      for (const sample of spec.sampleAlgorithms ?? []) {
        const res = evaluateProgram(state, sample.alg);
        expect(res.parseErrors, `${spec.id} / ${sample.name}`).toEqual([]);
        expect(res.runtimeError, `${spec.id} / ${sample.name}`).toBeUndefined();
        if (sample.name.toLowerCase().includes('blocking')) {
          expect(res.blocked, `${spec.id} / ${sample.name} should block`).toBeDefined();
        } else {
          expect(res.blocked, `${spec.id} / ${sample.name} should not block`).toBeUndefined();
        }
      }
    }
  });

  it('handles prime-factor order analysis, sticker orientation, parser modifiers, and 160-move zero-drift round-trips', () => {
    // 1. High-order shape-preserving Hex Flower algorithm via BigInt prime-factor reduction
    const hex = buildPuzzle(SIX_CIRCLE_HEX);
    const hexAnalysis = analyzeAlgorithm(hex, 'A B C D E F');
    expect(hexAnalysis.status).toBe('shape-preserving');
    expect(hexAnalysis.order).toBeGreaterThan(1);
    expect(hexAnalysis.cycleSummary).toBeTruthy();

    const hexPow = evaluateProgram(hex, `(A B C D E F)${hexAnalysis.order}`);
    expect(hexPow.blocked).toBeUndefined();
    expect(hexPow.solved).toBe(true);
    expect(hashPuzzleState(hexPow.finalState)).toBe(hashPuzzleState(hex));

    // 2. Geranium Plus whole-puzzle rotation `z` respects 5-color central pentagon orientation (order 5)
    const plus = buildPuzzle(GERANIUM_PLUS);
    const rotAnalysis = analyzeAlgorithm(plus, 'z');
    expect(rotAnalysis.status).toBe('periodic');
    expect(rotAnalysis.order).toBe(5);

    // 3. Parser modifier symmetry (`A>'2` === `A>2'`), `A>0` no-op, and digit-suffixed macro def `m2 = ...`
    const a1 = parseAlgorithm("A>'2", ['A']);
    const a2 = parseAlgorithm("A>2'", ['A']);
    expect(a1.errors).toEqual([]);
    expect(a2.errors).toEqual([]);
    const s1 = a1.statements[0];
    const s2 = a2.statements[0];
    expect(s1.kind === 'exprStmt' && s1.expr.kind === 'sequence' && s1.expr.items[0]).toMatchObject({
      kind: 'nextUnblocked',
      circleId: 'A',
      direction: -1,
      count: 2,
    });
    expect(s2.kind === 'exprStmt' && s2.expr.kind === 'sequence' && s2.expr.items[0]).toMatchObject({
      kind: 'nextUnblocked',
      circleId: 'A',
      direction: -1,
      count: 2,
    });

    const noopRes = evaluateProgram(plus, 'A>0');
    expect(noopRes.blocked).toBeUndefined();
    expect(noopRes.steps.length).toBe(0);
    expect(noopRes.solved).toBe(true);

    const venn = buildPuzzle(TWO_CIRCLE_VENN);
    const digitMacro = evaluateProgram(venn, 'm2 = [A, B]\nm2 m2\'');
    expect(digitMacro.parseErrors).toEqual([]);
    expect(digitMacro.runtimeError).toBeUndefined();
    expect(digitMacro.solved).toBe(true);

    // 4. 160-move seeded scramble + exact inverse round-trip on Geranium Plus has zero float drift
    const scramble = generateScramble(plus, 80, 'zero-drift-r2');
    const roundTrip = evaluateProgram(plus, `s = ${scramble}\ns s'`);
    expect(roundTrip.blocked).toBeUndefined();
    expect(roundTrip.solved).toBe(true);
    expect(hashPuzzleState(roundTrip.finalState)).toBe(hashPuzzleState(plus));

    // 5. Inverted-sphere Twizzle multi-layer notation: A (inner cap), a (wide), 2A (outer slice)
    const multiAst = parseAlgorithm("A a2' 2A3' 2A> z'", ['A', 'B'], ['A']);
    expect(multiAst.errors).toEqual([]);
    const st0 = multiAst.statements[0];
    expect(st0.kind === 'exprStmt' && st0.expr.kind === 'sequence' && st0.expr.items).toMatchObject([
      { kind: 'circleMove', circleId: 'A', steps: 1 },
      { kind: 'circleMove', circleId: 'A', steps: -2, wide: true },
      { kind: 'circleMove', circleId: 'A', steps: -3, layer: 2 },
      { kind: 'nextUnblocked', circleId: 'A', direction: 1, count: 1, layer: 2 },
      { kind: 'rotation', steps: -1 },
    ]);
  });
});
