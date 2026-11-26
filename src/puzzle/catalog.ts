import { deg2rad } from '../geom/math.ts';
import {
  ARECIBO_DOC,
  BAUHINIUM_DOC,
  BAUHINIUM_PLUS_DOC,
  COHAN_CIRCLE_DOC,
  CRAZY_LEKKI_DOC,
  CUBE4YOU_XO_DOC,
  ELIAC_DOC,
  GIGAHEX_PLUS_DOC,
  MIMOSA_DOC,
  MOONSPINNER_DOC,
  OCTOCRYSTAL_DOC,
  POCKET_QUATRIUM_DOC,
  THREE_CIRCLE_CLOVER_DOC,
} from './definitions.ts';
import { compileRingTwistDoc } from './formatBuilder.ts';
import {
  EXACT_GERANIUM_RADIUS,
  GERANIUM_PLUS_COLORS,
  GERANIUM_STD_COLORS,
  PHI,
  buildExactFomalhautPieces,
  buildExactFourCircleCloverPieces,
  buildExactFragmentationRingPieces,
  buildExactGeraniumPieces,
  buildExactGigaHexPieces,
  buildExactMandorlaPieces,
  buildExactMiniGeraniumPieces,
  buildExactPocketGeraniumPieces,
  buildExactPocketQuatriumPieces,
  buildExactSevenCircleFlowerPieces,
  buildExactSixCircleHexPieces,
  buildExactSuperGeraniumPieces,
  buildExactTwinRingsPieces,
  buildExactUfo2dPieces,
} from './geraniumBuilder.ts';
import { CircleDef, PuzzleSpec, evenStops } from './types.ts';

/** Crisp, distinct color palettes for circle puzzles. */
export const PALETTE_6 = ['#ef4444', '#f97316', '#facc15', '#16a34a', '#2563eb', '#9333ea'];

const GERANIUM_STANDARD_STOPS = [0, 36, 108, 144, 216, 252, 324];

function makeRingCircles(
  count: number,
  ringRadius: number,
  circleRadius: number,
  stops: number | number[],
  colors: string[],
  startAngleDeg = 90,
  labelOffset = 0,
): CircleDef[] {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const stopsDeg = Array.isArray(stops) ? stops : evenStops(stops);
  return Array.from({ length: count }, (_, k) => {
    const deg = startAngleDeg - (360 * k) / count;
    const rad = deg2rad(deg);
    return {
      id: letters[labelOffset + k],
      cx: ringRadius * Math.cos(rad),
      cy: ringRadius * Math.sin(rad),
      r: circleRadius,
      stopsDeg,
      color: colors[k % colors.length],
    };
  });
}

/**
 * 1. VeryPuzzle Geranium Plus (Exact 86-piece layout: 1 oriented 5-color pentagon + 5 × 17 arm pieces)
 */
export const GERANIUM_PLUS: PuzzleSpec = {
  id: 'geranium-plus',
  name: 'Geranium Plus',
  category: 'Geranium Family',
  description:
    'Exact 86-piece VeryPuzzle Geranium Plus (36° stops): unbandaged overlap shields & outer T-channels, 5 outer intersection pentagons, and an oriented 5-color central pentagon.',
  circles: makeRingCircles(5, 1.0, EXACT_GERANIUM_RADIUS, 10, GERANIUM_PLUS_COLORS, 90),
  symmetryStepDeg: 72,
  customBuilder: (spec) => buildExactGeraniumPieces(spec, 'plus'),
  sampleAlgorithms: [
    {
      name: '36°/108° Conjugate [A: D3]',
      alg: '[A: D3]',
      note: "A (36° CW) unlocks D; D3 (108°) exchanges pieces; A' restores alignment",
    },
    {
      name: 'Symmetry Macro [z: conj]',
      alg: 'conj = [A: D3]\n[z: conj]',
      note: 'Defines a macro and applies it rotated 72° CW via whole-puzzle rotation z',
    },
    {
      name: 'Next-unblocked walk',
      alg: "A> D3 A'",
      note: 'Uses > to snap A to its next unblocked alignment (36°, unlocking D), then turns D 108° and restores A',
    },
    {
      name: 'Blocking demo (A B)',
      alg: 'A B',
      note: 'A (36° CW) leaves pieces straddling B, so B blocks and highlights why',
    },
  ],
};

/**
 * 2. VeryPuzzle Geranium (Standard — Exact 71-piece layout)
 */
export const GERANIUM_STANDARD: PuzzleSpec = {
  id: 'geranium',
  name: 'Geranium (Standard)',
  category: 'Geranium Family',
  description:
    'Exact 71-piece VeryPuzzle Geranium with classic uneven (36°, 72°) stops, bandaged shields & T-channels, and 5-color oriented central pentagon.',
  circles: makeRingCircles(
    5,
    1.0,
    EXACT_GERANIUM_RADIUS,
    GERANIUM_STANDARD_STOPS,
    GERANIUM_STD_COLORS,
    90,
  ),
  symmetryStepDeg: 72,
  customBuilder: (spec) => buildExactGeraniumPieces(spec, 'standard'),
  sampleAlgorithms: [
    {
      name: '108° pair (A2 E2)',
      alg: 'A2 E2',
      note: 'With uneven (36,72,...) stops, A2 turns 108° CW (unlocking E), then E2 turns 108° CW',
    },
    {
      name: 'Blocking demo (A B)',
      alg: 'A B',
      note: '36° turn A unlocks D while blocking B, C, and E',
    },
  ],
};

/**
 * 3. Super Geranium Plus (Exact 10-circle, 196-piece unbandaged layout)
 */
const SUPER_OUTER_RING_RADIUS = 1 + PHI;
const SUPER_PLUS_INNER_COLORS = ['#facc15', '#38bdf8', '#9333ea', '#ef4444', '#16a34a'];
const SUPER_PLUS_OUTER_COLORS = ['#facc15', '#38bdf8', '#9333ea', '#ef4444', '#16a34a'];

export const SUPER_GERANIUM_PLUS: PuzzleSpec = {
  id: 'super-geranium-plus',
  name: 'Super Geranium Plus',
  category: 'Geranium Family',
  description:
    'Exact 196-piece 10-circle Super Geranium Plus: 5 inner 36° rings (A–E) plus 5 outer rings (F–J) at radius 1+φ in 5-fold star symmetry.',
  circles: [
    ...makeRingCircles(5, 1.0, EXACT_GERANIUM_RADIUS, 10, SUPER_PLUS_INNER_COLORS, 54, 0),
    ...makeRingCircles(
      5,
      SUPER_OUTER_RING_RADIUS,
      EXACT_GERANIUM_RADIUS,
      GERANIUM_STANDARD_STOPS,
      SUPER_PLUS_OUTER_COLORS,
      90,
      5,
    ),
  ],
  symmetryStepDeg: 72,
  customBuilder: (spec) => buildExactSuperGeraniumPieces(spec, 'plus'),
  sampleAlgorithms: [
    {
      name: 'Outer-inner exchange [F2: A3]',
      alg: '[F2: A3]',
      note: 'Turns outer circle F 108° CW, exchanges with inner circle A, then restores F',
    },
    {
      name: 'Star symmetry macro',
      alg: 'm = [F2: A3]\n[z: m]',
      note: 'Applies an outer-inner conjugate rotated 72° CW around the 5-fold star',
    },
  ],
};

/**
 * 4. Super Geranium (Standard — Exact 10-circle, 156-piece layout)
 */
export const SUPER_GERANIUM: PuzzleSpec = {
  id: 'super-geranium',
  name: 'Super Geranium',
  category: 'Geranium Family',
  description:
    'Exact 156-piece 10-circle Super Geranium: 5 inner circles (A–E) and 5 outer star circles (F–J) with classic (36°, 72°) uneven stops.',
  circles: [
    ...makeRingCircles(
      5,
      1.0,
      EXACT_GERANIUM_RADIUS,
      GERANIUM_STANDARD_STOPS,
      GERANIUM_STD_COLORS,
      54,
      0,
    ),
    ...makeRingCircles(
      5,
      SUPER_OUTER_RING_RADIUS,
      EXACT_GERANIUM_RADIUS,
      GERANIUM_STANDARD_STOPS,
      GERANIUM_STD_COLORS,
      90,
      5,
    ),
  ],
  symmetryStepDeg: 72,
  customBuilder: (spec) => buildExactSuperGeraniumPieces(spec, 'standard'),
  sampleAlgorithms: [
    {
      name: 'Outer-inner conjugate [F2: A2]',
      alg: '[F2: A2]',
      note: '108° conjugate between outer circle F and inner circle A',
    },
    {
      name: 'Blocking demo (F A)',
      alg: 'F A',
      note: '36° turn F leaves pieces straddling inner circle A',
    },
  ],
};

/**
 * 5. Pocket Geranium (Exact 3 circles in a horizontal line, 60 pieces)
 */
const POCKET_CENTER_X = (50 + (50 + 68 * PHI)) / 2;
export const POCKET_GERANIUM: PuzzleSpec = {
  id: 'pocket-geranium',
  name: 'Pocket Geranium',
  category: 'Geranium Family',
  description:
    'Exact 60-piece Pocket Geranium: 3 circles in a horizontal line (A, B, C) with golden-ratio spacing and authentic uneven Geranium stops.',
  circles: [
    {
      id: 'A',
      cx: (50 - POCKET_CENTER_X) / 50,
      cy: 0,
      r: 1.0,
      stopsDeg: [0, 108, 216, 324],
      color: '#16a34a',
    },
    {
      id: 'B',
      cx: (118 - POCKET_CENTER_X) / 50,
      cy: 0,
      r: 1.0,
      stopsDeg: [0, 108, 144, 252],
      color: '#2563eb',
    },
    {
      id: 'C',
      cx: (50 + 68 * PHI - POCKET_CENTER_X) / 50,
      cy: 0,
      r: 1.0,
      stopsDeg: [0, 108],
      color: '#ef4444',
    },
  ],
  symmetryStepDeg: 0,
  customBuilder: (spec) => buildExactPocketGeraniumPieces(spec),
  sampleAlgorithms: [
    {
      name: 'Commutator [A, B]',
      alg: '[A, B]',
      note: '108° commutator between left circle A and middle circle B',
    },
    {
      name: '3-circle walk (B A\' B2 A2 C)',
      alg: "B A' B2 A2 C",
      note: 'Aligns B and A to unlock right circle C in the 3-circle line',
    },
    {
      name: 'Blocking demo (A B C)',
      alg: 'A B C',
      note: 'A B leaves pieces straddling right circle C so C blocks',
    },
  ],
};

/**
 * 6. Mini Geranium Plus (Exact unbandaged 2-circle Geranium, 56 pieces)
 */
export const MINI_GERANIUM_PLUS: PuzzleSpec = {
  id: 'mini-geranium-plus',
  name: 'Mini Geranium Plus (2-Circle)',
  category: 'Geranium Family',
  description:
    'Exact 56-piece unbandaged 2-circle Geranium: splits the outer Geranium shields for deeper 2-circle jumbling and piece exchanges.',
  circles: [
    { id: 'A', cx: -34 / 50, cy: 0, r: 1.0, stopsDeg: [0, 108, 144, 252], color: '#ef4444' },
    { id: 'B', cx: 34 / 50, cy: 0, r: 1.0, stopsDeg: [0, 108, 216, 252], color: '#84cc16' },
  ],
  symmetryStepDeg: 0,
  customBuilder: (spec) => buildExactMiniGeraniumPieces(spec, 'plus'),
  sampleAlgorithms: [
    {
      name: '108° Commutator [A, B]',
      alg: '[A, B]',
      note: 'Exchanges unbandaged shields across the two Geranium circles',
    },
    {
      name: 'Deep sequence (A2 B\' A2 B2)',
      alg: "A2 B' A2 B2",
      note: 'Mixes 144° and 108° uneven turns across both circles',
    },
  ],
};

/**
 * 7. Mini Geranium (Exact standard 2-circle Geranium, 46 pieces)
 */
export const MINI_GERANIUM: PuzzleSpec = {
  id: 'mini-geranium',
  name: 'Mini Geranium (2-Circle)',
  category: 'Geranium Family',
  description:
    'Exact 46-piece 2-circle Geranium with authentic Geranium spacing (d/r = 1.36) and uneven (108°, 36°) stops.',
  circles: [
    { id: 'A', cx: -34 / 50, cy: 0, r: 1.0, stopsDeg: [0, 108, 144, 252], color: '#ef4444' },
    { id: 'B', cx: 34 / 50, cy: 0, r: 1.0, stopsDeg: [0, 108, 216, 252], color: '#84cc16' },
  ],
  symmetryStepDeg: 0,
  customBuilder: (spec) => buildExactMiniGeraniumPieces(spec, 'standard'),
  sampleAlgorithms: [
    {
      name: '108° Commutator [A, B]',
      alg: '[A, B]',
      note: 'Classic 2-circle Geranium 108° commutator',
    },
    {
      name: 'Uneven sequence (A2 B\' A2 B2)',
      alg: "A2 B' A2 B2",
      note: 'Mixes 144° and 108° uneven stops across A and B',
    },
  ],
};

/**
 * 8. 2-Circle Venn / Mandorla (Exact fully unbandaged 120° 2-circle puzzle, 21 pieces)
 */
export const TWO_CIRCLE_VENN: PuzzleSpec = {
  id: 'two-circle',
  name: '2-Circle Venn (Mandorla 120°)',
  category: 'Classic Circles',
  description:
    'Fully unbandaged 21-piece 2-circle Venn puzzle (Mandorla) with 120° stops. Every turn aligns cleanly — ideal for learning commutators and conjugates.',
  circles: [
    { id: 'A', cx: -25.05 / 50, cy: 0, r: 1.0, stopsDeg: evenStops(3), color: '#38bdf8' },
    { id: 'B', cx: 25.05 / 50, cy: 0, r: 1.0, stopsDeg: evenStops(3), color: '#16a34a' },
  ],
  symmetryStepDeg: 180,
  customBuilder: (spec) => buildExactMandorlaPieces(spec),
  sampleAlgorithms: [
    {
      name: '120° Commutator [A, B]',
      alg: '[A, B]',
      note: 'Clean 120° commutator across the unbandaged Mandorla lens',
    },
    {
      name: '180° flip conjugate',
      alg: '[z: A B]',
      note: 'Whole-puzzle 180° rotation swaps A and B',
    },
  ],
};

/**
 * 9. Twin Rings (Exact unbandaged 90° 2-circle puzzle with inner rings, 67 pieces)
 */
export const TWIN_RINGS: PuzzleSpec = {
  id: 'twin-rings',
  name: 'Twin Rings (90°)',
  category: 'Classic Circles',
  description:
    'Exact 67-piece Twin Rings puzzle: two overlapping 90° circles with concentric inner rings and full unbandaged quarter-turn slicing.',
  circles: [
    { id: 'A', cx: -29 / 50, cy: 0, r: 1.0, stopsDeg: evenStops(4), color: '#facc15' },
    { id: 'B', cx: 29 / 50, cy: 0, r: 1.0, stopsDeg: evenStops(4), color: '#2563eb' },
  ],
  symmetryStepDeg: 180,
  customBuilder: (spec) => buildExactTwinRingsPieces(spec),
  sampleAlgorithms: [
    {
      name: '180°/90° Commutator [A2, B]',
      alg: '[A2, B]',
      note: '180° turn A2 keeps B unblocked for clean concentric ring exchanges',
    },
    {
      name: 'Symmetric conjugate [z: A2 B2]',
      alg: '[z: A2 B2]',
      note: 'Rotates the puzzle 180° to swap A and B, then runs 180° half-turns',
    },
    {
      name: 'Blocking demo (A B)',
      alg: 'A B',
      note: 'A (90° CW) turns pieces across B so B blocks',
    },
  ],
};

/**
 * 10. 3-Circle Clover / Tri-Venn — compiled natively from ringtwist/v1 declarative doc (37 pcs, mirror=[y])
 */
export const THREE_CIRCLE_CLOVER: PuzzleSpec = compileRingTwistDoc(THREE_CIRCLE_CLOVER_DOC);

/**
 * 11. 4-Circle Clover (Unbandaged 90° orthogonal circles)
 */
export const FOUR_CIRCLE_CLOVER: PuzzleSpec = {
  id: 'four-circle-clover',
  name: '4-Circle Clover (90°)',
  category: 'Classic Circles',
  description:
    '4 intersecting circles in square symmetry with 90° stops, distinct blended overlap lenses, and fully unbandaged quarter-turn moves.',
  circles: makeRingCircles(
    4,
    (38 / 50) * Math.SQRT2,
    1.0,
    4,
    ['#ef4444', '#facc15', '#16a34a', '#2563eb'],
    45,
  ),
  symmetryStepDeg: 90,
  customBuilder: (spec) => buildExactFourCircleCloverPieces(spec),
  sampleAlgorithms: [
    {
      name: '90° Commutator [A, B]',
      alg: '[A, B]',
      note: 'Clean quarter-turn commutator between adjacent circles',
    },
    {
      name: '4-fold symmetry [z: A B]',
      alg: '[z: A B]',
      note: 'Applies A B rotated 90° CW around the clover',
    },
  ],
};

/**
 * 11. 6-Circle Hex Flower (Unbandaged 60° hexagonal circles)
 */
export const SIX_CIRCLE_HEX: PuzzleSpec = {
  id: 'six-circle-hex',
  name: '6-Circle Hex Flower (60°)',
  category: 'Classic Circles',
  description:
    '6 overlapping circles in hexagonal symmetry with 60° stops, unbandaged across the full hexagonal lattice.',
  circles: makeRingCircles(6, 1.0, 1.0, 6, PALETTE_6, 90),
  symmetryStepDeg: 60,
  customBuilder: (spec) => buildExactSixCircleHexPieces(spec),
  sampleAlgorithms: [
    {
      name: '60° Commutator [A, B]',
      alg: '[A, B]',
      note: 'Clean 60° commutator across adjacent hexagonal circles',
    },
    {
      name: 'Symmetry conjugate',
      alg: 'm = [A, B]\n[z2: m]',
      note: 'Applies m rotated 120° CW around the hex flower',
    },
  ],
};

/**
 * 13. 7-Circle Flower (1 central ring G + 6 outer rings A..F, 60° stops)
 */
export const SEVEN_CIRCLE_FLOWER: PuzzleSpec = {
  id: 'seven-circle-flower',
  name: '7-Circle Flower (60°)',
  category: 'Classic Circles',
  description:
    '6 hexagonal outer rings (A–F) surrounding a playable central ring (G) with 60° stops — spin the center flower to route pieces between all six arms.',
  circles: [
    ...makeRingCircles(6, 1.0, 1.0, 6, PALETTE_6, 90),
    { id: 'G', cx: 0, cy: 0, r: 1.0, stopsDeg: evenStops(6), color: '#14b8a6' },
  ],
  symmetryStepDeg: 60,
  customBuilder: (spec) => buildExactSevenCircleFlowerPieces(spec),
  sampleAlgorithms: [
    {
      name: 'Center-arm commutator [G, A]',
      alg: '[G, A]',
      note: 'Commutes the playable center ring G with outer ring A',
    },
    {
      name: '6-fold swirl (G A)3',
      alg: '(G A)3',
      note: 'Alternates center ring G and outer ring A in 60° steps',
    },
  ],
};

/**
 * 14. Bauhinium — compiled natively from ringtwist/v1 declarative doc (28 pcs, mirror=[x])
 */
export const BAUHINIUM: PuzzleSpec = compileRingTwistDoc(BAUHINIUM_DOC);

/**
 * 15. Bauhinium Plus — compiled natively from ringtwist/v1 declarative doc (34 pcs, mirror=[x,y])
 */
export const BAUHINIUM_PLUS: PuzzleSpec = compileRingTwistDoc(BAUHINIUM_PLUS_DOC);

/**
 * 16. Pocket Quatrium — compiled natively from ringtwist/v1 declarative doc (35 pcs, mirror=[x,y])
 */
export const POCKET_QUATRIUM: PuzzleSpec = compileRingTwistDoc(POCKET_QUATRIUM_DOC);

/**
 * 17. Pocket Quatrium Plus (James Li — 3 inline 90° circles)
 */
export const POCKET_QUATRIUM_PLUS: PuzzleSpec = {
  id: 'pocket-quatrium-plus',
  name: 'Pocket Quatrium Plus',
  category: 'Designer & Exotic',
  description:
    'James Li’s 3-circle inline 90° Pocket Quatrium Plus with pink, light-blue, and yellow circles plus blended overlap lenses.',
  circles: [
    { id: 'A', cx: -58 / 50, cy: 0, r: 1.0, stopsDeg: evenStops(4), color: '#f472b6' },
    { id: 'B', cx: 0, cy: 0, r: 1.0, stopsDeg: evenStops(4), color: '#38bdf8' },
    { id: 'C', cx: 58 / 50, cy: 0, r: 1.0, stopsDeg: evenStops(4), color: '#facc15' },
  ],
  symmetryStepDeg: 180,
  customBuilder: (spec) => buildExactPocketQuatriumPieces(spec, true),
  sampleAlgorithms: [
    {
      name: 'Inline walk (A B C2 B\')',
      alg: "A B C2 B'",
      note: 'Quarter-turns and half-turns ripple across all three inline 90° circles',
    },
    {
      name: '180° Symmetry [z: A2 B2 C2]',
      alg: '[z: A2 B2 C2]',
      note: 'Mirrors half-turns across the 3-circle line via z',
    },
  ],
};

/**
 * 18. Starcopter / Fomalhaut (Dmitry Andreev / Pluton — 72° unequal circles)
 */
export const FOMALHAUT: PuzzleSpec = {
  id: 'fomalhaut',
  name: 'Starcopter (Fomalhaut)',
  category: 'Designer & Exotic',
  description:
    'Dmitry Andreev’s Fomalhaut (Starcopter): two unequal 72° pentagonal circles with intricate star-petal bandaging.',
  circles: [
    { id: 'A', cx: (50 - 86) / 50, cy: 0, r: 1.0, stopsDeg: evenStops(5), color: '#facc15' },
    { id: 'B', cx: (114 - 86) / 50, cy: 0, r: 58 / 50, stopsDeg: evenStops(5), color: '#2563eb' },
  ],
  symmetryStepDeg: 0,
  customBuilder: (spec) => buildExactFomalhautPieces(spec),
  sampleAlgorithms: [
    {
      name: '72° Commutator [A, B\']',
      alg: "[A, B']",
      note: '72° commutator across the unequal Fomalhaut overlap',
    },
  ],
};

/**
 * 19. Curvystar / Mimosa — compiled natively from ringtwist/v1 declarative doc (73 pcs, mirror=[x])
 */
export const MIMOSA: PuzzleSpec = compileRingTwistDoc(MIMOSA_DOC);

/**
 * 20. Cohan Circle / Arusloky (Venn) — compiled natively from ringtwist/v1 declarative doc (29 pcs, mirror=[x,y])
 */
export const COHAN_CIRCLE: PuzzleSpec = compileRingTwistDoc(COHAN_CIRCLE_DOC);

/**
 * 21. Arecibo — compiled natively from ringtwist/v1 declarative doc (69 pcs, mirror=[x,y])
 */
export const ARECIBO: PuzzleSpec = compileRingTwistDoc(ARECIBO_DOC);

/**
 * 22. Eliac — compiled natively from ringtwist/v1 declarative doc (59 pcs, mirror=[x])
 */
export const ELIAC: PuzzleSpec = compileRingTwistDoc(ELIAC_DOC);

/**
 * 23. Fragmentation Ring (James Li — 72° jumbling/bandaged two-circle puzzle)
 */
export const FRAGMENTATION_RING: PuzzleSpec = {
  id: 'fragmentation-ring',
  name: 'Fragmentation Ring',
  category: 'Designer & Exotic',
  description:
    'James Li’s Fragmentation Ring: two 72° pentagonal circles with intricate non-doctrinaire blocking and jumbling exchanges.',
  circles: [
    { id: 'A', cx: -31 / 50, cy: 0, r: 1.0, stopsDeg: evenStops(5), color: '#ef4444' },
    { id: 'B', cx: 31 / 50, cy: 0, r: 1.0, stopsDeg: evenStops(5), color: '#38bdf8' },
  ],
  symmetryStepDeg: 0,
  customBuilder: (spec) => buildExactFragmentationRingPieces(spec),
  sampleAlgorithms: [
    {
      name: 'Jumbling exchange (A\' B)',
      alg: "A' B",
      note: 'CCW 72° turn A\' unlocks B for a 72° jumbling transfer',
    },
    {
      name: 'Blocking demo (A B)',
      alg: 'A B',
      note: 'CW 72° turn A leaves fragments straddling B',
    },
  ],
};

/**
 * 24. Cube4you Crazy Lekki — compiled natively from ringtwist/v1 declarative doc
 */
export const CRAZY_LEKKI: PuzzleSpec = compileRingTwistDoc(CRAZY_LEKKI_DOC);

/**
 * 25. Cube4you GigaHex (2 concentric 2-layer 60° circles)
 */
export const GIGAHEX: PuzzleSpec = {
  id: 'gigahex',
  name: 'GigaHex',
  category: 'Designer & Exotic',
  description:
    'Cube4you GigaHex: two overlapping 2-layer 60° circles (A/B inner disks, 2A/2B outer slices, a/b wide turns) with 105 pieces.',
  circles: [
    {
      id: 'A',
      cx: -31.5 / 50,
      cy: 0,
      r: 1.0,
      layerRadii: [0.8, 1.0],
      stopsDeg: evenStops(6),
      color: '#16a34a',
    },
    {
      id: 'B',
      cx: 31.5 / 50,
      cy: 0,
      r: 1.0,
      layerRadii: [0.8, 1.0],
      stopsDeg: evenStops(6),
      color: '#f97316',
    },
  ],
  symmetryStepDeg: 180,
  customBuilder: (spec) => buildExactGigaHexPieces(spec),
  sampleAlgorithms: [
    {
      name: 'Wide/inner commutator [a, B]',
      alg: '[a, B]',
      note: 'Commutes wide turn a with inner disk B in 60° steps',
    },
    {
      name: 'Outer-slice exchange [2A, 2B]',
      alg: '[2A, 2B]',
      note: 'Swaps pieces between the two concentric outer rings 2A and 2B',
    },
  ],
};

/**
 * 26. Cube4you GigaHex Plus — compiled natively from ringtwist/v1 declarative doc
 */
export const GIGAHEX_PLUS: PuzzleSpec = compileRingTwistDoc(GIGAHEX_PLUS_DOC);

/**
 * 27. ThinkFun Moonspinner — compiled natively from ringtwist/v1 declarative doc
 */
export const MOONSPINNER: PuzzleSpec = compileRingTwistDoc(MOONSPINNER_DOC);

/**
 * 28. Cube4you OctoCrystal — compiled natively from ringtwist/v1 declarative doc
 */
export const OCTOCRYSTAL: PuzzleSpec = compileRingTwistDoc(OCTOCRYSTAL_DOC);

/**
 * 29. Cube4you 2D Puzzle – XO — compiled natively from ringtwist/v1 declarative doc
 */
export const CUBE4YOU_XO: PuzzleSpec = compileRingTwistDoc(CUBE4YOU_XO_DOC);

/**
 * 30. Cube4you UFO 2D / 10 Stars (Evgeniy Grigoriev — 10 decagonal circles, 100 pieces)
 */
const UFO_2D_STOPS = [0, 36, 144, 180, 216, 324];
const UFO_2D_PALETTE = [
  '#84cc16',
  '#facc15',
  '#f97316',
  '#ef4444',
  '#f8fafc',
  '#c084fc',
  '#9333ea',
  '#f472b6',
  '#2563eb',
  '#38bdf8',
];

export const UFO_2D: PuzzleSpec = {
  id: 'ufo-2d',
  name: 'Cube4you UFO 2D',
  category: 'Designer & Exotic',
  description:
    'Evgeniy Grigoriev’s Cube4you UFO 2D (10 Stars): 10 decagonal circles with asymmetric 36°/108° stops forming 10 colored 5-pointed stars on a black ring (100 pieces).',
  circles: Array.from({ length: 10 }, (_, k) => {
    const rad = deg2rad(90 - 36 * k);
    return {
      id: 'ABCDEFGHIJ'[k],
      cx: 2 * Math.cos(rad),
      cy: 2 * Math.sin(rad),
      r: 1.05,
      stopsDeg: UFO_2D_STOPS,
      color: UFO_2D_PALETTE[k],
    };
  }),
  symmetryStepDeg: 36,
  customBuilder: (spec) => buildExactUfo2dPieces(spec),
  sampleAlgorithms: [
    {
      name: '180° Star conjugate [A3: B3]',
      alg: '[A3: B3]',
      note: 'Half-turn A3 aligns cuts for a 180° star transfer on adjacent circle B',
    },
    {
      name: 'Decagonal walk (A3 D3 G3)',
      alg: 'A3 D3 G3',
      note: '180° star flips spaced evenly around the 10-circle UFO ring',
    },
  ],
};

export const PUZZLE_CATALOG: PuzzleSpec[] = [
  GERANIUM_PLUS,
  GERANIUM_STANDARD,
  SUPER_GERANIUM_PLUS,
  SUPER_GERANIUM,
  POCKET_GERANIUM,
  MINI_GERANIUM_PLUS,
  MINI_GERANIUM,
  MOONSPINNER,
  CRAZY_LEKKI,
  GIGAHEX,
  GIGAHEX_PLUS,
  OCTOCRYSTAL,
  CUBE4YOU_XO,
  UFO_2D,
  BAUHINIUM,
  BAUHINIUM_PLUS,
  POCKET_QUATRIUM,
  POCKET_QUATRIUM_PLUS,
  FOMALHAUT,
  MIMOSA,
  COHAN_CIRCLE,
  ARECIBO,
  ELIAC,
  FRAGMENTATION_RING,
  TWO_CIRCLE_VENN,
  TWIN_RINGS,
  THREE_CIRCLE_CLOVER,
  FOUR_CIRCLE_CLOVER,
  SIX_CIRCLE_HEX,
  SEVEN_CIRCLE_FLOWER,
];

export function getPuzzleSpec(id: string): PuzzleSpec {
  return PUZZLE_CATALOG.find((p) => p.id === id) ?? GERANIUM_PLUS;
}
