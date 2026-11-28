import { describe, expect, it } from 'vitest';
import { reflectRegion, rotateRegion } from '../geom/arcRegion.ts';
import { evaluateProgram } from '../lang/evaluator.ts';
import {
  parseMacroLibraryText,
  serializeMacroLibraryToText,
} from '../lang/focusDirectives.ts';
import { decodeShareHash, encodeShareHash } from '../ui/storage.ts';
import { buildPuzzle } from './builder.ts';
import { getPuzzleSpec } from './catalog.ts';
import {
  computeMacroCyclePreview,
  getPuzzlePieceTypeCatalog,
  pieceShapeType,
  toggleFocusTypeAtPoint,
} from './cyclePreview.ts';
import { generateScramble } from './engine.ts';

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

    // Any slot of an oriented piece type (e.g. an outer solid pentagon on Geranium Plus)
    // should ALSO report its exact rotation-in-place spin angle, even when currently occupied
    // by a solid-color piece (because another piece of that type has orientation).
    const big3Pure = "[[A3', D3], [z': [A3: C4' [E4: C3] C]]]";
    const rot8 = "[A3' D B4', D3]";
    const cspinPure = `[${rot8}, ${big3Pure}]`;
    const cspinCenter = computeMacroCyclePreview(state, cspinPure, [], 'cspin_pure');
    expect(cspinCenter.ok).toBe(true);
    expect(cspinCenter.arrows.length).toBe(0);
    // Commutator [rot8, big3_pure] twists the central pentagon (+72°) AND a solid outer pentagon (-72°)!
    expect(cspinCenter.spins.length).toBe(2);
    const spinAngles = cspinCenter.spins.map((s) => s.angleDeg).sort((a, b) => a - b);
    expect(spinAngles).toEqual([-72, 72]);

    // Pure big3_pure is a clean 3-cycle of big pentagons with zero stationary spins
    const big3Prev = computeMacroCyclePreview(state, big3Pure, [], 'big3_pure');
    expect(big3Prev.ok).toBe(true);
    expect(big3Prev.arrows.length).toBe(3);
    expect(big3Prev.spins.length).toBe(0);

    // On a single-color puzzle where NO piece of the center shape type has orientation (e.g. Roto 36),
    // rotating a solid-color piece in place should STILL NOT emit bogus moved arrows or spins
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

    // Click an outer pentagon -> focuses ONLY the canonical named "big_pent" piece type!
    const pentArrow = zFull.arrows.find((a) => a.shapeType === pentType.shapeType)!;
    const focus1 = toggleFocusTypeAtPoint(undefined, gp, zFull, pentArrow.from, gp);
    expect(focus1).toEqual(['big_pent']);

    // Normal hover with focusTypes fully hides all non-pentagon pieces while keeping pentagon arrows + center spin
    const focused = computeMacroCyclePreview(gp, 'z', [], 'rot', {
      focusTypes: focus1!,
      solvedState: gp,
    });
    const expectedPentArrows = zFull.arrows.filter((a) => a.shapeType === pentType.shapeType).length;
    expect(focused.arrows.length).toBe(expectedPentArrows);
    expect(focused.spins.length).toBe(1);
    expect(focused.hiddenCount).toBe(zFull.arrows.length - expectedPentArrows);
    expect(focused.summary).toContain('hidden');

    // Legacy raw shapeType hash also still works alongside semantic names
    const legacyFocused = computeMacroCyclePreview(gp, 'z', [], 'rot', {
      focusTypes: [pentType.shapeType],
      solvedState: gp,
    });
    expect(legacyFocused.arrows.length).toBe(expectedPentArrows);

    // Inverse macro with the exact same focusTypes highlights the exact same piece type!
    const invFocused = computeMacroCyclePreview(gp, "z'", [], "rot'", {
      focusTypes: focus1!,
      solvedState: gp,
    });
    expect(invFocused.arrows.length).toBe(expectedPentArrows);
    expect(invFocused.spins.length).toBe(1);

    // Focus-picking mode keeps non-focused piece types as `dimmed: true`
    const pickView = computeMacroCyclePreview(gp, 'z', [], 'rot', {
      focusTypes: focus1!,
      solvedState: gp,
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
    const focusCleared = toggleFocusTypeAtPoint(focus1!, gp, zFull, otherPent.from, gp);
    expect(focusCleared).toEqual([]);
  });

  it('resolves named pieceTypes on Geranium family and parses/edits // @focus directives cleanly', () => {
    const gp = buildPuzzle(getPuzzleSpec('geranium-plus'));
    const gpCatalog = getPuzzlePieceTypeCatalog(gp);
    expect(gpCatalog.map((c) => [c.id, c.totalCount])).toEqual([
      ['big_pent', 6],
      ['petal', 15],
      ['small_pent', 10],
      ['kite', 15],
      ['tri', 40],
    ]);

    const gStd = buildPuzzle(getPuzzleSpec('geranium'));
    expect(getPuzzlePieceTypeCatalog(gStd).map((c) => c.id)).toEqual([
      'big_pent',
      'shield',
      'petal',
      't_piece',
      'tri',
    ]);

    // Unnamed puzzle falls back cleanly to area-ranked type1, type2, ...
    const two = buildPuzzle(getPuzzleSpec('two-circle'));
    expect(getPuzzlePieceTypeCatalog(two).map((c) => c.id)[0]).toBe('type1');

    // Parse section-level and per-line // @focus, // @hide, and // @show directives via Macro Library sheet
    const directiveSheet = [
      '// === Core Generators ===',
      '// @hide',
      "g4 = [A3, C3']",
      "p8 = [A: D4'] D5 [B': D4'] D3",
      'peek = g4 // @show — explicitly kept visible',
      '// @show',
      '// === Phase 3: Big Pentagons ===',
      '// @focus big_pent',
      'big3 = g4 // 4t: BigPent(3)',
      'petal3 = p8 // @focus petal, big_pent — 8t: Petal(3)',
      'show_all = g4 // @focus all',
      'tmp = g4 // @hide — one-off helper',
      '// @focus all',
      'tri3 = (p8)2',
    ].join('\n');

    const parsedDirs = parseMacroLibraryText(directiveSheet, {
      validCircleIds: ['A', 'B', 'C', 'D', 'E'],
    });
    expect(parsedDirs.errors).toEqual([]);
    const byName = new Map(parsedDirs.entries.map((e) => [e.name, e]));
    expect(parsedDirs.entries.filter((e) => e.hidden).map((e) => e.name).sort()).toEqual([
      'g4',
      'p8',
      'tmp',
    ]);
    expect(byName.get('peek')?.hidden).toBeUndefined();
    expect(byName.get('big3')?.focusTypes).toEqual(['big_pent']);
    expect(byName.get('petal3')?.focusTypes).toEqual(['petal', 'big_pent']);
    expect(byName.get('show_all')?.focusTypes).toBeUndefined();
    expect(byName.get('tmp')?.focusTypes).toEqual(['big_pent']);
    expect(byName.get('tri3')?.focusTypes).toBeUndefined();

    // Plain-text Macro Library sheet parser + serializer lossless round-trip (with section & macro notes)
    const sheet = [
      '// === Core Generators ===',
      '// @hide',
      "g4 = [A3, C3']",
      '// @show',
      '// === Phase 3: Big Pentagons ===',
      '// Solve all 6 big pentagons without disturbing Kites or Small Pentagons.',
      '// @focus big_pent',
      'big3 = g4  // 4t: fast BigPent(3)',
      '// Swaps 3 big pentagons cleanly',
      "big3_pure = [[A3', D3], [z': [A3: C4' [E4: C3] C]]]  // 22t: pure BigPent(3)",
    ].join('\n');
    const parsedSheet = parseMacroLibraryText(sheet, {
      reservedNames: new Set(['A', 'B', 'C', 'D', 'E', 'x', 'y', 'z']),
      validCircleIds: ['A', 'B', 'C', 'D', 'E'],
    });
    expect(parsedSheet.errors).toEqual([]);
    expect(parsedSheet.entries).toEqual([
      { name: 'g4', body: "[A3, C3']", hidden: true, section: 'Core Generators' },
      {
        name: 'big3',
        body: 'g4',
        note: '4t: fast BigPent(3)',
        focusTypes: ['big_pent'],
        section: 'Phase 3: Big Pentagons',
        sectionNote: 'Solve all 6 big pentagons without disturbing Kites or Small Pentagons.',
      },
      {
        name: 'big3_pure',
        body: "[[A3', D3], [z': [A3: C4' [E4: C3] C]]]",
        note: 'Swaps 3 big pentagons cleanly\n22t: pure BigPent(3)',
        focusTypes: ['big_pent'],
        section: 'Phase 3: Big Pentagons',
      },
    ]);

    const serialized = serializeMacroLibraryToText(parsedSheet.entries);
    const reparsed = parseMacroLibraryText(serialized, {
      reservedNames: new Set(['A', 'B', 'C', 'D', 'E', 'x', 'y', 'z']),
      validCircleIds: ['A', 'B', 'C', 'D', 'E'],
    });
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.entries).toEqual(parsedSheet.entries);

    // Legacy JSON array import still works cleanly
    const jsonParsed = parseMacroLibraryText(
      '[{"name":"conj","body":"[A: D3]","focusTypes":["big_pent"]}]',
    );
    expect(jsonParsed.errors).toEqual([]);
    expect(jsonParsed.entries).toEqual([
      { name: 'conj', body: '[A: D3]', focusTypes: ['big_pent'] },
    ]);

    // disallowMacroDefs rejects inline `=` in Algorithm box cleanly
    const disallowed = evaluateProgram(gp, 'g4 = [A3, C3\']\ng4', [], {
      disallowMacroDefs: true,
    });
    expect(disallowed.parseErrors.length).toBe(1);
    expect(disallowed.parseErrors[0].message).toContain('belongs in the Macro Library');
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

  it('handles Move-macros-to-Library on bracketed scripts, section resets, negative notes, reflections, and corrupt hashes', () => {
    // Script starting with `[A, B]` must NOT trip legacy JSON parsing when allowNonMacroLines is true
    const mixed = [
      '[A: D3]',
      '// Comment for macro',
      'm1 = [A3, C3\']  // -36° setup note',
      '// Keep this algorithm comment',
      'm1',
    ].join('\n');
    const extracted = parseMacroLibraryText(mixed, {
      validCircleIds: ['A', 'B', 'C', 'D', 'E'],
      allowNonMacroLines: true,
    });
    expect(extracted.errors).toEqual([]);
    expect(extracted.entries).toEqual([
      {
        name: 'm1',
        body: "[A3, C3']",
        note: 'Comment for macro\n-36° setup note',
      },
    ]);
    expect(extracted.remainingText).toBe('[A: D3]\n// Keep this algorithm comment\nm1');

    // Unsectioned macro after sectioned macro round-trips cleanly via `// @section none`
    const withTrailingUngrouped = [
      { name: 's1', body: '[A: D3]', section: 'Phase 1', note: '-36° leading dash' },
      { name: 'loose', body: 'A3 D3' },
    ];
    const roundTripped = parseMacroLibraryText(
      serializeMacroLibraryToText(withTrailingUngrouped),
      { validCircleIds: ['A', 'B', 'C', 'D', 'E'] },
    );
    expect(roundTripped.errors).toEqual([]);
    expect(roundTripped.entries).toEqual(withTrailingUngrouped);

    // Reflected stickered pieces (`y` and fast-forwarded `y25`) report no fake spin angles
    const gp = buildPuzzle(getPuzzleSpec('geranium-plus'));
    const flipPreview = computeMacroCyclePreview(gp, 'y', [], 'y', { solvedState: gp });
    expect(flipPreview.spins).toEqual([]);
    const fastFlipPreview = computeMacroCyclePreview(gp, 'y25', [], 'y25', { solvedState: gp });
    expect(fastFlipPreview.spins).toEqual([]);

    // Corrupt `m=` parameter in share hash degrades gracefully without losing `p`, `s`, `n`, `a`
    const partial = decodeShareHash('#p=geranium-plus&s=abc&n=50&a=QTM&m=!!!corrupt!!!');
    expect(partial).not.toBeNull();
    expect(partial?.puzzleId).toBe('geranium-plus');
    expect(partial?.scrambleSeed).toBe('abc');
    expect(partial?.scrambleMoves).toBe(50);
    expect(partial?.alg).toBe('A3');
    expect(partial?.macros).toBeUndefined();

    // Unattached section headers & preceding comments survive Move-macros-to-Library (`allowNonMacroLines`)
    const withAlgSection = [
      'm1 = A3',
      '// Note before algorithm section',
      '// === Algorithm Phase ===',
      '// Step description',
      'm1 D3',
    ].join('\n');
    const kept = parseMacroLibraryText(withAlgSection, {
      validCircleIds: ['A', 'B', 'C', 'D', 'E'],
      allowNonMacroLines: true,
    });
    expect(kept.errors).toEqual([]);
    expect(kept.entries).toEqual([{ name: 'm1', body: 'A3' }]);
    expect(kept.remainingText).toBe(
      '// Note before algorithm section\n// === Algorithm Phase ===\n// Step description\nm1 D3',
    );

    // Chronological order preserved when blank lines and standalone comments follow an unattached section
    const ordered = parseMacroLibraryText(
      'm1 = A3\n// === Intro ===\n// Section note\n\n// Standalone comment\n\nm1 D3',
      { validCircleIds: ['A', 'B', 'C', 'D', 'E'], allowNonMacroLines: true },
    );
    expect(ordered.errors).toEqual([]);
    expect(ordered.remainingText).toBe(
      '// === Intro ===\n// Section note\n\n// Standalone comment\n\nm1 D3',
    );

    // Rejects empty-statement macro bodies (`;;;`) and globally reserved `x2`/`z2` even without validCircleIds
    const badMacros = parseMacroLibraryText('noop = ;;;\nx2 = A\nz2 = A');
    expect(badMacros.entries).toEqual([]);
    expect(badMacros.errors.length).toBe(3);
  });
});
