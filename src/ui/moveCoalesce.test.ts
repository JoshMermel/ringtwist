import { describe, expect, it } from 'vitest';
import {
  GERANIUM_PLUS,
  GERANIUM_STANDARD,
  GIGAHEX,
  POCKET_GERANIUM,
  TWO_CIRCLE_VENN,
} from '../puzzle/catalog.ts';
import { applyInteractiveMoveToText } from './moveCoalesce.ts';

describe('interactive move coalescing & cancellation', () => {
  it('cancels B followed by B prime cleanly', () => {
    const r1 = applyInteractiveMoveToText('A B', 3, "B'", GERANIUM_PLUS);
    expect(r1.action).toBe('cancelled');
    expect(r1.nextText).toBe('A');
    expect(r1.nextCursor).toBe(1);

    const r2 = applyInteractiveMoveToText('B', 1, "B'", GERANIUM_PLUS);
    expect(r2.action).toBe('cancelled');
    expect(r2.nextText).toBe('');
    expect(r2.nextCursor).toBe(0);
  });

  it('merges consecutive same-circle clicks into compact powers and wraps modulo stop count', () => {
    // On Geranium Plus (10 stops): B + B -> B2, B2 + B -> B3, B5 + B -> B4'
    let res = applyInteractiveMoveToText('A B', 3, 'B', GERANIUM_PLUS);
    expect(res.action).toBe('merged');
    expect(res.nextText).toBe('A B2');

    res = applyInteractiveMoveToText(res.nextText, res.nextCursor, 'B', GERANIUM_PLUS);
    expect(res.action).toBe('merged');
    expect(res.nextText).toBe('A B3');

    res = applyInteractiveMoveToText(res.nextText, res.nextCursor, "B'", GERANIUM_PLUS);
    expect(res.action).toBe('merged');
    expect(res.nextText).toBe('A B2');

    // Shortest signed wrap: on 3-stop Mandorla, A + A -> A', A' + A' -> A, A + A + A -> cancelled!
    const v1 = applyInteractiveMoveToText('A', 1, 'A', TWO_CIRCLE_VENN);
    expect(v1.nextText).toBe("A'");
    const v2 = applyInteractiveMoveToText(v1.nextText, v1.nextCursor, 'A', TWO_CIRCLE_VENN);
    expect(v2.action).toBe('cancelled');
    expect(v2.nextText).toBe('');

    // Uneven stops: Standard Geranium has 7 stops; A3 + A -> A3', A3' + A' -> A3
    const s1 = applyInteractiveMoveToText('A3', 2, 'A', GERANIUM_STANDARD);
    expect(s1.nextText).toBe("A3'");
  });

  it('cancels next-unblocked (> / <) and whole-puzzle rotations (z / z prime)', () => {
    const n1 = applyInteractiveMoveToText('A>', 2, 'A<', GERANIUM_PLUS);
    expect(n1.action).toBe('cancelled');
    expect(n1.nextText).toBe('');

    const n2 = applyInteractiveMoveToText('A>', 2, 'A>', GERANIUM_PLUS);
    expect(n2.action).toBe('merged');
    expect(n2.nextText).toBe('A>2');

    const r1 = applyInteractiveMoveToText('A z', 3, "z'", GERANIUM_PLUS);
    expect(r1.action).toBe('cancelled');
    expect(r1.nextText).toBe('A');

    // Full 5-fold rotation on Geranium Plus cancels (z2' + z' -> z2)
    const r2 = applyInteractiveMoveToText("z2'", 3, "z'", GERANIUM_PLUS);
    expect(r2.nextText).toBe('z2');

    // Pocket Geranium has symmetryStepDeg = 0 so z does not coalesce
    const rNone = applyInteractiveMoveToText('A', 1, 'B', POCKET_GERANIUM);
    expect(rNone.action).toBe('appended');
    expect(rNone.nextText).toBe('A B');
  });

  it('never crosses newlines or mutates scramble lines or comments', () => {
    const script = '// Scramble (seed: 42)\nA B\n\n// Solve below:\n';
    const r1 = applyInteractiveMoveToText(script, script.length, "B'", GERANIUM_PLUS);
    expect(r1.action).toBe('appended');
    expect(r1.nextText).toBe(`${script}B'`);

    // Inside a bracketed group `[A: B` should not mutate `[` glued tokens
    const r2 = applyInteractiveMoveToText('[B', 2, "B'", GERANIUM_PLUS);
    expect(r2.action).toBe('appended');
    expect(r2.nextText).toBe("[B B'");
  });

  it('coalesces and cancels multi-layer slice (2A) and wide (a) moves independently on GigaHex', () => {
    const s1 = applyInteractiveMoveToText('2A', 2, '2A', GIGAHEX);
    expect(s1.action).toBe('merged');
    expect(s1.nextText).toBe('2A2');

    const s2 = applyInteractiveMoveToText('2A', 2, "2A'", GIGAHEX);
    expect(s2.action).toBe('cancelled');
    expect(s2.nextText).toBe('');

    const w1 = applyInteractiveMoveToText('a', 1, 'a', GIGAHEX);
    expect(w1.action).toBe('merged');
    expect(w1.nextText).toBe('a2');

    const w2 = applyInteractiveMoveToText('a', 1, "a'", GIGAHEX);
    expect(w2.action).toBe('cancelled');
    expect(w2.nextText).toBe('');

    // Different layers on the same circle (A vs 2A vs a) must NEVER merge together
    const diff1 = applyInteractiveMoveToText('A', 1, '2A', GIGAHEX);
    expect(diff1.action).toBe('appended');
    expect(diff1.nextText).toBe('A 2A');

    const diff2 = applyInteractiveMoveToText('2A', 2, 'a', GIGAHEX);
    expect(diff2.action).toBe('appended');
    expect(diff2.nextText).toBe('2A a');
  });
});
