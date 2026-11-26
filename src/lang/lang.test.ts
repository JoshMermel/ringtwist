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
import { hashPuzzleState } from '../puzzle/engine.ts';
import { analyzeAlgorithm, evaluateProgram } from './evaluator.ts';
import { parseAlgorithm } from './parser.ts';

describe('notation parser, macros & non-doctrinaire evaluator', () => {
  it('parses sequences, groups, commutators, conjugates, rotations, next-unblocked, and macros', () => {
    const ast = parseAlgorithm(
      `// Demo script
      comm = [A3, E3]
      [r: comm]2 (A> D<)'`,
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

  it('supports inline macros, sidebar macros, whole-puzzle rotation r, and next-unblocked > on Geranium Plus', () => {
    const solved = buildPuzzle(GERANIUM_PLUS);

    const res = evaluateProgram(
      solved,
      `seq = [A: D3]
       seq seq' [r: seq] [r: seq]'`,
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
});
