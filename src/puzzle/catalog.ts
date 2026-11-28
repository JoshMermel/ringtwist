import { deg2rad } from '../geom/math.ts';
import {
  ARECIBO_DOC,
  BAUHINIUM_DOC,
  BAUHINIUM_PLUS_DOC,
  BICYCLE_PUZZLER_DOC,
  COHAN_CIRCLE_DOC,
  CRAZY_LEKKI_DOC,
  CRAZY_LOTICA_DOC,
  CUBE4YOU_XO_DOC,
  ELIAC_DOC,
  FOMALHAUT_DOC,
  FOUR_CIRCLE_CLOVER_DOC,
  GIGAHEX_DOC,
  GIGAHEX_PLUS_DOC,
  GRIPPLE_DOC,
  LOTICA_DOC,
  MIMOSA_DOC,
  MOONSPINNER_DOC,
  OCTOCRYSTAL_DOC,
  POCKET_QUATRIUM_DOC,
  POCKET_QUATRIUM_PLUS_DOC,
  RASHKEY_DOC,
  ROTASCOPE_DOC,
  ROTO_36_DOC,
  ROTO_44_DOC,
  SEVEN_CIRCLE_FLOWER_DOC,
  SIX_CIRCLE_HEX_DOC,
  THREE_CIRCLE_CLOVER_DOC,
  TRILOTICA_DOC,
  TURNSTILE_DOC,
  TWIN_RINGS_DOC,
  TWO_CIRCLE_VENN_DOC,
  UFO_2D_DOC,
  WHIRLIGIG_3X3_DOC,
} from './definitions.ts';
import { compileRingTwistDoc } from './formatBuilder.ts';
import {
  EXACT_GERANIUM_RADIUS,
  GERANIUM_PLUS_COLORS,
  GERANIUM_STD_COLORS,
  PHI,
  buildExactFragmentationRingPieces,
  buildExactGeraniumPieces,
  buildExactMiniGeraniumPieces,
  buildExactPocketGeraniumPieces,
  buildExactSuperGeraniumPieces,
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
  pieceTypes: [
    { id: 'big_pent', label: 'Big Pentagon', probe: { x: 0, y: 0 } },
    { id: 'petal', label: 'Petal', probe: { x: 0.0422, y: 0.6743 } },
    { id: 'small_pent', label: 'Small Pentagon', probe: { x: -0.5878, y: 0.8408 } },
    { id: 'kite', label: 'Kite', probe: { x: -1.0633, y: 0.6545 } },
    { id: 'tri', label: 'Triangle', probe: { x: 0, y: 1.1772 } },
  ],
  customBuilder: (spec) => buildExactGeraniumPieces(spec, 'plus'),
  sampleAlgorithms: [
    {
      name: '36°/108° Conjugate [A: D3]',
      alg: '[A: D3]',
      note: "A (36° CW) unlocks D; D3 (108°) exchanges pieces; A' restores alignment",
    },
    {
      name: 'Symmetry Conjugate [z: [A: D3]]',
      alg: '[z: [A: D3]]',
      note: 'Applies [A: D3] rotated 72° CW via whole-puzzle rotation z (or call [z: conj] from Macro Library)',
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
  pieceTypes: [
    { id: 'big_pent', label: 'Big Pentagon', probe: { x: 0, y: 0 } },
    { id: 'shield', label: 'Shield', probe: { x: -0.8257, y: 0.7317 } },
    { id: 'petal', label: 'Petal', probe: { x: 0.0422, y: 0.6743 } },
    { id: 't_piece', label: 'T-Piece', probe: { x: 0, y: 1.8682 } },
    { id: 'tri', label: 'Triangle', probe: { x: 0, y: 1.1772 } },
  ],
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
  pieceTypes: [
    { id: 'big_pent', label: 'Big Pentagon', probe: { x: 0, y: 0 } },
    { id: 'petal', label: 'Petal', probe: { x: 0.6544, y: 1.7863 } },
    { id: 'small_pent', label: 'Small Pentagon', probe: { x: 0.9698, y: 1.2833 } },
    { id: 'kite', label: 'Kite', probe: { x: 1.2449, y: 1.7135 } },
    { id: 'tri', label: 'Triangle', probe: { x: 1.1196, y: 1.9818 } },
  ],
  customBuilder: (spec) => buildExactSuperGeraniumPieces(spec, 'plus'),
  sampleAlgorithms: [
    {
      name: 'Outer-inner exchange [F2: A3]',
      alg: '[F2: A3]',
      note: 'Turns outer circle F 108° CW, exchanges with inner circle A, then restores F',
    },
    {
      name: 'Star symmetry conjugate',
      alg: '[z: [F2: A3]]',
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
  pieceTypes: [
    { id: 'big_pent', label: 'Big Pentagon', probe: { x: 0, y: 0 } },
    { id: 'shield', label: 'Shield', probe: { x: 0.2379, y: 1.0773 } },
    { id: 'petal', label: 'Petal', probe: { x: 0.4305, y: 0.5207 } },
    { id: 't_piece', label: 'T-Piece', probe: { x: 1.0981, y: 1.5114 } },
    { id: 'tri', label: 'Triangle', probe: { x: 0.6919, y: 0.9524 } },
  ],
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
  pieceTypes: [
    { id: 'big_pent', label: 'Big Pentagon', probe: { x: -1.1132, y: 0.7328 } },
    { id: 'shield', label: 'Shield', probe: { x: -1.0095, y: 0.3026 } },
    { id: 't_piece', label: 'T-Piece', probe: { x: -0.1044, y: 0.5013 } },
    { id: 'petal', label: 'Petal', probe: { x: 0.2132, y: 0.6993 } },
    { id: 'tri', label: 'Triangle', probe: { x: 0.4457, y: 0.9009 } },
  ],
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
  pieceTypes: [
    { id: 'big_pent', label: 'Big Pentagon', probe: { x: -1.0794, y: 0.5852 } },
    { id: 'petal', label: 'Petal', probe: { x: -0.6335, y: 0.6993 } },
    { id: 'small_pent', label: 'Small Pentagon', probe: { x: -0.4068, y: 0.339 } },
    { id: 'kite', label: 'Kite', probe: { x: -0.2101, y: 0.6467 } },
    { id: 'tri', label: 'Triangle', probe: { x: -0.866, y: 0.9009 } },
  ],
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
  pieceTypes: [
    { id: 'big_pent', label: 'Big Pentagon', probe: { x: -1.0794, y: 0.5852 } },
    { id: 'shield', label: 'Shield', probe: { x: -0.4203, y: 0.1798 } },
    { id: 't_piece', label: 'T-Piece', probe: { x: -0.3158, y: -0.5013 } },
    { id: 'petal', label: 'Petal', probe: { x: -0.6335, y: 0.6993 } },
    { id: 'tri', label: 'Triangle', probe: { x: -0.866, y: 0.9009 } },
  ],
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
 * 8. 2-Circle Venn / Mandorla — compiled natively from ringtwist/v1 declarative doc (21 pcs)
 */
export const TWO_CIRCLE_VENN: PuzzleSpec = compileRingTwistDoc(TWO_CIRCLE_VENN_DOC);

/**
 * 9. Twin Rings — compiled natively from ringtwist/v1 declarative doc (69 pcs, mirror=[x,y])
 */
export const TWIN_RINGS: PuzzleSpec = compileRingTwistDoc(TWIN_RINGS_DOC);

/**
 * 10. 3-Circle Clover / Tri-Venn — compiled natively from ringtwist/v1 declarative doc (37 pcs, mirror=[y])
 */
export const THREE_CIRCLE_CLOVER: PuzzleSpec = compileRingTwistDoc(THREE_CIRCLE_CLOVER_DOC);

/**
 * 11. 4-Circle Clover — compiled natively from ringtwist/v1 declarative doc (16 pcs)
 */
export const FOUR_CIRCLE_CLOVER: PuzzleSpec = compileRingTwistDoc(FOUR_CIRCLE_CLOVER_DOC);

/**
 * 12. 6-Circle Hex Flower — compiled natively from ringtwist/v1 declarative doc (66 pcs)
 */
export const SIX_CIRCLE_HEX: PuzzleSpec = compileRingTwistDoc(SIX_CIRCLE_HEX_DOC);

/**
 * 13. 7-Circle Flower — compiled natively from ringtwist/v1 declarative doc (66 pcs)
 */
export const SEVEN_CIRCLE_FLOWER: PuzzleSpec = compileRingTwistDoc(SEVEN_CIRCLE_FLOWER_DOC);

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
 * 17. Pocket Quatrium Plus — compiled natively from ringtwist/v1 declarative doc (49 pcs)
 */
export const POCKET_QUATRIUM_PLUS: PuzzleSpec = compileRingTwistDoc(POCKET_QUATRIUM_PLUS_DOC);

/**
 * 18. Starcopter / Fomalhaut — compiled natively from ringtwist/v1 declarative doc (90 pcs)
 */
export const FOMALHAUT: PuzzleSpec = compileRingTwistDoc(FOMALHAUT_DOC);

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
 * 25. Cube4you GigaHex — compiled natively from ringtwist/v1 declarative doc (105 pcs)
 */
export const GIGAHEX: PuzzleSpec = compileRingTwistDoc(GIGAHEX_DOC);

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
 * 30. Cube4you UFO 2D / 10 Stars — compiled natively from ringtwist/v1 declarative doc (100 pcs, mirror=[x,y])
 */
export const UFO_2D: PuzzleSpec = compileRingTwistDoc(UFO_2D_DOC);

/**
 * 31. Roto 36 (Galen Ivanov, 2015) — compiled natively from ringtwist/v1 declarative doc (58 pcs, mirror=[y])
 */
export const ROTO_36: PuzzleSpec = compileRingTwistDoc(ROTO_36_DOC);

/**
 * 32. Roto 44 (Galen Ivanov, 2015) — compiled natively from ringtwist/v1 declarative doc (73 pcs, mirror=[x,y])
 */
export const ROTO_44: PuzzleSpec = compileRingTwistDoc(ROTO_44_DOC);

/**
 * 33. Bicycle Puzzler (Evgeniy Grigoriev, 2024) — compiled natively from ringtwist/v1 declarative doc (51 pcs, mirror=[x])
 */
export const BICYCLE_PUZZLER: PuzzleSpec = compileRingTwistDoc(BICYCLE_PUZZLER_DOC);

/**
 * 34. Rotascope (Raoul Raba / Pentangle, 1977) — compiled natively from ringtwist/v1 declarative doc (13 pcs, mirror=[y])
 */
export const ROTASCOPE: PuzzleSpec = compileRingTwistDoc(ROTASCOPE_DOC);

/**
 * 35. Lotica / Turn'Push (Bagdassarian 1995 / Jose Romero) — compiled natively from ringtwist/v1 (13 pcs, mirror=[x])
 */
export const LOTICA: PuzzleSpec = compileRingTwistDoc(LOTICA_DOC);

/**
 * 36. Crazy Lotica (Wdoviak & Jose Romero, 2021) — compiled natively from ringtwist/v1 (24 pcs, mirror=[x])
 */
export const CRAZY_LOTICA: PuzzleSpec = compileRingTwistDoc(CRAZY_LOTICA_DOC);

/**
 * 37. Trilotica V1 (El_Cubitero, 2022) — compiled natively from ringtwist/v1 (11 pcs, mirror=[x])
 */
export const TRILOTICA: PuzzleSpec = compileRingTwistDoc(TRILOTICA_DOC);

/**
 * 38. Rashkey (Oleg Raschkov, 1999) — compiled natively from ringtwist/v1 (33 pcs, mirror=[x,y])
 */
export const RASHKEY: PuzzleSpec = compileRingTwistDoc(RASHKEY_DOC);

/**
 * 39. Turnstile / Twinspin (Douglas A. Engel, 1983) — compiled natively from ringtwist/v1 (23 pcs, mirror=[x,y])
 */
export const TURNSTILE: PuzzleSpec = compileRingTwistDoc(TURNSTILE_DOC);

/**
 * 40. Gripple (Murray J. Gould, 1988) — compiled natively from ringtwist/v1 (21 pcs, mirror=[x,y])
 */
export const GRIPPLE: PuzzleSpec = compileRingTwistDoc(GRIPPLE_DOC);

/**
 * 41. 3×3 Circle Grid / Whirligig (Jaap Scherphuis) — compiled natively from ringtwist/v1 (33 pcs, mirror=[x,y])
 */
export const WHIRLIGIG_3X3: PuzzleSpec = compileRingTwistDoc(WHIRLIGIG_3X3_DOC);

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
  CRAZY_LOTICA,
  LOTICA,
  TRILOTICA,
  GIGAHEX,
  GIGAHEX_PLUS,
  OCTOCRYSTAL,
  CUBE4YOU_XO,
  UFO_2D,
  ROTO_36,
  ROTO_44,
  GRIPPLE,
  BICYCLE_PUZZLER,
  ROTASCOPE,
  RASHKEY,
  TURNSTILE,
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
  WHIRLIGIG_3X3,
];

export function getPuzzleSpec(id: string): PuzzleSpec {
  return PUZZLE_CATALOG.find((p) => p.id === id) ?? GERANIUM_PLUS;
}
