import { RingTwistPuzzleDoc } from './format.ts';

/**
 * Native RingTwist v1 declarative puzzle definitions.
 * Every puzzle here is 100% pure JSON-serializable, index-free, and uses exact math expressions.
 */

export const MOONSPINNER_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'moonspinner',
  name: 'ThinkFun Moonspinner',
  category: 'Designer & Exotic',
  description:
    'Oskar van Deventer’s ThinkFun Moonspinner in doctrinaire exterior-turn form: A flips the oval lens circle 180°, while B rotates everything outside the fixed crescent-moon circle by 72°.',
  viewBounds: [-1.68, 1.56, -1.62, 1.62],
  axes: [
    {
      id: 'A',
      cx: '-1/phi',
      cy: 0,
      r: 1,
      stops: 2,
      color: '#0ea5e9',
      labelPos: ['-1/phi - 1.24', 0],
    },
    {
      id: 'B',
      cx: 0,
      cy: 0,
      r: 1,
      stops: 5,
      region: 'outside',
      color: '#facc15',
      labelPos: [1.78, 0],
    },
  ],
  silhouette: {
    parts: [
      {
        circles: [
          'B',
          {
            ring: {
              count: 5,
              centerRadius: '1/phi',
              r: 1,
              startAngleDeg: 180,
              direction: 'ccw',
            },
          },
        ],
        outside: ['B'],
      },
      {
        circles: ['B', 'A'],
        inside: ['B'],
      },
    ],
  },
  cuts: [
    {
      op: 'closure',
      maxIters: 10,
      blocks: [
        { moves: ['A', 'B'], repeat: 5 },
        { moves: ['A'], repeat: 1 },
      ],
    },
  ],
  coloring: [
    { type: 'fill', color: '#22c55e' },
    { type: 'region', outside: ['B', 'A'], angleDeg: [7, 180], color: '#f43f5e' },
    { type: 'region', outside: ['B', 'A'], angleDeg: [-10, 10], minY: 0.14, color: '#f43f5e' },
    { type: 'region', outside: ['B', 'A'], angleDeg: [-138, -80], color: '#a855f7' },
    { type: 'region', outside: ['B'], inside: ['A'], color: '#f97316' },
    { type: 'region', inside: ['B', 'A'], color: '#0ea5e9' },
    { type: 'region', inside: ['B'], outside: ['A'], color: '#facc15' },
  ],
  sampleAlgorithms: [
    {
      name: '5-lobe commutator [A, B]',
      alg: '[A, B]',
      note: 'Flips the lens disk A 180° and spins the entire 5-lobed exterior frame B by 72°',
    },
    {
      name: "Double-step walk (A B2 A B2')",
      alg: "A B2 A B2'",
      note: 'Transfers pieces across opposite outer lobes via 144° exterior turns',
    },
  ],
};

export const CRAZY_LEKKI_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'crazy-lekki',
  name: 'Crazy Lekki',
  category: 'Designer & Exotic',
  description:
    'Jose Romero’s Cube4you Crazy Lekki: a 2-layer 120° disk (A inner, 2A outer slice, a wide) paired with a 90° yellow disk (B). Turning B by 90° bandages A’s outer ring until B completes a 180° flip.',
  params: {
    d: '130 * sqrt3 / 3 / 50',
    ox: '(-84/50 + d + 58/50) / 2',
  },
  axes: [
    {
      id: 'A',
      cx: '-ox',
      cy: 0,
      r: '84/50',
      layers: ['53/50', '84/50'],
      stops: 3,
      color: '#f97316',
    },
    {
      id: 'B',
      cx: 'd - ox',
      cy: 0,
      r: '58/50',
      stops: 4,
      color: '#facc15',
    },
  ],
  cuts: [
    {
      op: 'closure',
      maxIters: 8,
      blocks: [
        { moves: ['A'], repeat: 3 },
        { moves: ['a', 'B2'], repeat: 6 },
        { moves: ["a'", 'B2'], repeat: 6 },
        {
          moves: [
            { move: 'B', cutBy: ['A:1', 'B'] },
            { move: 'A', cutBy: ['A:1', 'B'] },
            "B'",
            'a',
          ],
          repeat: 3,
        },
        {
          moves: [
            { move: 'B', cutBy: ['A:1', 'B'] },
            { move: "A'", cutBy: ['A:1', 'B'] },
            "B'",
            "a'",
          ],
          repeat: 3,
        },
        {
          moves: [
            { move: "B'", cutBy: ['A:1', 'B'] },
            { move: 'A', cutBy: ['A:1', 'B'] },
            'B',
            'a',
          ],
          repeat: 3,
        },
        {
          moves: [
            { move: "B'", cutBy: ['A:1', 'B'] },
            { move: "A'", cutBy: ['A:1', 'B'] },
            'B',
            "a'",
          ],
          repeat: 3,
        },
      ],
    },
  ],
  coloring: [
    { type: 'fill', color: '#06b6d4' },
    {
      type: 'region',
      inside: [{ axis: 'B', around: 'A', angleDeg: 120 }],
      color: '#f97316',
    },
    {
      type: 'region',
      inside: [{ axis: 'B', around: 'A', angleDeg: -120 }],
      color: '#ef4444',
    },
    { type: 'region', inside: ['B'], color: '#facc15' },
  ],
  sampleAlgorithms: [
    {
      name: 'Inner-layer commutator [B, A]',
      alg: '[B, A]',
      note: 'Turning B 90° leaves A’s inner disk free for a clean 3-cycle',
    },
    {
      name: 'Wide 180° commutator [B2, a]',
      alg: '[B2, a]',
      note: 'A 180° flip on B unlocks wide turns (a) of the entire large disk',
    },
    {
      name: 'Blocking demo (B 2A)',
      alg: 'B 2A',
      note: 'Quarter-turn B bandages the outer slice 2A while leaving inner disk A free',
    },
  ],
};

export const GIGAHEX_PLUS_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'gigahex-plus',
  name: 'GigaHex Plus',
  category: 'Designer & Exotic',
  description:
    'Cube4you GigaHex Plus: three 2-layer 60° circles (A, B, C) in an equilateral Venn triangle with 7-color RGB/CMY/White shading and 139 pieces.',
  params: {
    s: '63 / sqrt3 / 50',
  },
  symmetryStepDeg: 120,
  axes: [
    {
      ring: {
        ids: 'ABC',
        centerRadius: 's',
        r: 1,
        layers: [0.8, 1],
        startAngleDeg: 90,
        stops: 6,
        colors: ['#16a34a', '#2563eb', '#ef4444'],
      },
    },
  ],
  cuts: [
    {
      op: 'closure',
      maxIters: 4,
      blocks: [
        { moves: ['a', 'b', 'c'], repeat: 6 },
        { moves: ["a'", "b'", "c'"], repeat: 6 },
        { moves: ['a', 'c', 'b'], repeat: 6 },
        { moves: ["a'", "c'", "b'"], repeat: 6 },
      ],
    },
  ],
  coloring: [
    {
      type: 'venn',
      colors: {
        A: '#16a34a',
        B: '#2563eb',
        C: '#ef4444',
        AB: '#06b6d4',
        BC: '#9333ea',
        AC: '#facc15',
        ABC: '#f8fafc',
      },
    },
  ],
  sampleAlgorithms: [
    {
      name: 'Outer-slice commutator [2A, 2B]',
      alg: '[2A, 2B]',
      note: 'Commutes the outer concentric rings of A and B',
    },
    {
      name: '120° Symmetry conjugate',
      alg: 'm = [a, B]\n[z: m]',
      note: 'Applies the wide/inner commutator rotated 120° around the triangle',
    },
  ],
};

export const OCTOCRYSTAL_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'octocrystal',
  name: 'Cube4you OctoCrystal',
  category: 'Designer & Exotic',
  description:
    'Cube4you OctoCrystal: 8 overlapping 45° circles with 8 swirling rainbow arms, 64 pieces, and 135° jumbling moves.',
  symmetryStepDeg: 45,
  axes: [
    {
      ring: {
        ids: 'ABCDEFGH',
        centerRadius: 1,
        r: 1,
        startAngleDeg: 135,
        stops: 8,
        colors: [
          '#ef4444',
          '#f472b6',
          '#9333ea',
          '#1d4ed8',
          '#06b6d4',
          '#4ade80',
          '#facc15',
          '#f97316',
        ],
      },
    },
  ],
  cuts: [
    {
      op: 'cutCircles',
      repeatSymmetry: 8,
      circles: [
        { cx: '1 + sqrt2', cy: 0, r: 1 },
        { cx: '1 + sqrt2', cy: '-sqrt2', r: 1 },
        { cx: '1 + sqrt2', cy: 'sqrt2', r: 1 },
      ],
    },
  ],
  coloring: [
    {
      type: 'cyclicArm',
      axes: 'ABCDEFGH',
      direction: 'cw',
      colors: [
        '#ef4444',
        '#f472b6',
        '#9333ea',
        '#1d4ed8',
        '#06b6d4',
        '#4ade80',
        '#facc15',
        '#f97316',
      ],
    },
  ],
  sampleAlgorithms: [
    {
      name: '135° Jumbling exchange (A3 C3)',
      alg: 'A3 C3',
      note: 'A 135° turn on A unlocks non-adjacent circle C for jumbling',
    },
    {
      name: "45° Symmetry walk (A3 E3' z)",
      alg: "A3 E3' z",
      note: 'Opposite 135° turns followed by a 45° whole-puzzle rotation',
    },
  ],
};

export const CUBE4YOU_XO_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'cube4you-xo',
  name: 'Cube4you 2D – XO',
  category: 'Designer & Exotic',
  description:
    'Cube4you 2D Puzzle – XO: a big 90° red circle (A) intersecting a smaller 180° light-blue circle (B) at exact r = d = 1/√2 tangency (33 pieces).',
  params: {
    d: '1 / sqrt2',
    ox: '(-1 + 2 * d) / 2',
  },
  axes: [
    { id: 'A', cx: '-ox', cy: 0, r: 1, stops: 4, color: '#ef4444' },
    { id: 'B', cx: 'd - ox', cy: 0, r: 'd', stops: 2, color: '#38bdf8' },
  ],
  cuts: [
    {
      op: 'closure',
      maxIters: 12,
      blocks: [{ moves: ['A', 'B'], repeat: 4 }],
    },
  ],
  coloring: [
    { type: 'fill', color: '#ef4444' },
    { type: 'region', inside: ['B'], color: '#38bdf8' },
  ],
  sampleAlgorithms: [
    {
      name: '90°/180° Commutator [A, B]',
      alg: '[A, B]',
      note: 'Commutes quarter-turns on the red circle with 180° flips on the blue circle',
    },
    {
      name: 'Lens swap (A2 B A B A)',
      alg: 'A2 B A B A',
      note: 'Shuttles narrow lenses between the red and blue circles',
    },
  ],
};

/**
 * 6. Bauhinium (James Li — 180° + 72° unequal-radius circles, 28 pieces, mirror=[x])
 */
export const BAUHINIUM_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'bauhinium',
  name: 'Bauhinium',
  category: 'Designer & Exotic',
  description:
    'James Li’s 2-circle Bauhinium: a 180° red disk paired with a smaller 72° blue pentagonal disk (fully unbandaged, 28 pieces).',
  params: {
    r2: '0.5 / sin(rad(36))',
    ox: '(1 + 2 * r2) / 2',
  },
  axes: [
    { id: 'A', cx: '1 - ox', cy: 0, r: 1, stops: 2, color: '#ef4444' },
    { id: 'B', cx: '1 + r2 - ox', cy: 0, r: 'r2', stops: 5, color: '#2563eb' },
  ],
  cuts: [
    { op: 'sliceByAxes' },
    {
      op: 'closure',
      maxIters: 8,
      blocks: [
        { moves: ['A', 'B'], repeat: 10 },
        { moves: ['A', "B'"], repeat: 10 },
      ],
    },
  ],
  coloring: [
    {
      type: 'venn',
      colors: { A: '#ef4444', B: '#2563eb', AB: '#2563eb' },
    },
  ],
  sampleAlgorithms: [
    {
      name: "72°/180° Conjugate [B': A]",
      alg: "[B': A]",
      note: 'Turns blue pentagonal disk B 72° CCW, flips red disk A 180°, then restores B',
    },
    {
      name: "Pentagonal walk (B' A B2 A)",
      alg: "B' A B2 A",
      note: 'Alternates 72°/144° turns on B with 180° flips on A',
    },
  ],
};

/**
 * 7. Bauhinium Plus (James Li — 3-circle symmetric 72° / 180° / 72°, 34 pieces, mirror=[x,y])
 */
export const BAUHINIUM_PLUS_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'bauhinium-plus',
  name: 'Bauhinium Plus',
  category: 'Designer & Exotic',
  description:
    'James Li’s 3-circle Bauhinium Plus: a central 180° red disk flanked symmetrically by two 72° green pentagonal disks (fully unbandaged, 34 pieces).',
  symmetryStepDeg: 180,
  params: {
    r2: '0.5 / sin(rad(36))',
  },
  axes: [
    { id: 'A', cx: '-r2', cy: 0, r: 'r2', stops: 5, color: '#16a34a' },
    { id: 'B', cx: 0, cy: 0, r: 1, stops: 2, color: '#ef4444' },
    { id: 'C', cx: 'r2', cy: 0, r: 'r2', stops: 5, color: '#16a34a' },
  ],
  cuts: [
    { op: 'sliceByAxes' },
    {
      op: 'closure',
      maxIters: 8,
      blocks: [
        { moves: ['A', 'B', 'C'], repeat: 10 },
        { moves: ["A'", 'B', "C'"], repeat: 10 },
        { moves: ['A', 'B', "C'"], repeat: 10 },
        { moves: ["A'", 'B', 'C'], repeat: 10 },
      ],
    },
  ],
  coloring: [
    {
      type: 'venn',
      colors: {
        A: '#16a34a',
        B: '#ef4444',
        C: '#16a34a',
        AB: '#16a34a',
        BC: '#16a34a',
      },
    },
  ],
  sampleAlgorithms: [
    {
      name: 'Symmetric flip [z: [B: A]]',
      alg: 'm = [B: A]\n[z: m]',
      note: 'Flips central disk B, turns A 72°, restores B, then mirrors onto C via z',
    },
    {
      name: "Wing walk (A C A2' C2)",
      alg: "A C A2' C2",
      note: 'Independent 72° turns on the two outer green pentagonal wings',
    },
  ],
};

/**
 * 8. Cohan Circle / Arusloky (Hooshang Cohan 1986 — exact 29 pieces: 10 triangles + 19 petals, mirror=[x,y])
 */
export const COHAN_CIRCLE_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'cohan-circle',
  name: 'Cohan Circle / Arusloky (Venn)',
  category: 'Designer & Exotic',
  description:
    'Hooshang Cohan’s classic 1986 60° two-circle puzzle (Arusloky) in a 3-color Venn scheme (29 pieces: 10 triangles + 19 petals).',
  symmetryStepDeg: 180,
  axes: [
    { id: 'A', cx: -0.5, cy: 0, r: 1, stops: 6, color: '#ef4444' },
    { id: 'B', cx: 0.5, cy: 0, r: 1, stops: 6, color: '#2563eb' },
  ],
  cuts: [
    { op: 'sliceByAxes' },
    {
      op: 'closure',
      maxIters: 8,
      blocks: [
        { moves: ['A', 'B'], repeat: 8 },
        { moves: ["A'", "B'"], repeat: 8 },
        { moves: ['A', "B'"], repeat: 8 },
        { moves: ["A'", 'B'], repeat: 8 },
      ],
    },
  ],
  coloring: [
    {
      type: 'venn',
      colors: { A: '#ef4444', B: '#2563eb', AB: '#9333ea' },
    },
  ],
  sampleAlgorithms: [
    {
      name: '60° Commutator [A, B]',
      alg: '[A, B]',
      note: 'Classic 60° commutator across the Cohan Circle overlap',
    },
    {
      name: '180° Symmetry [z: [A, B]]',
      alg: 'c = [A, B]\n[z: c]',
      note: 'Mirrors the commutator via 180° whole-puzzle rotation z',
    },
  ],
};

/**
 * 9. Pocket Quatrium (James Li — 2 overlapping 90° circles, fully unbandaged, 35 pieces, mirror=[x,y])
 */
export const POCKET_QUATRIUM_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'pocket-quatrium',
  name: 'Pocket Quatrium',
  category: 'Designer & Exotic',
  description:
    'James Li’s 2-circle 90° Pocket Quatrium with fully unbandaged quarter-turn pieces and a contrasting overlap lens (35 pieces).',
  symmetryStepDeg: 180,
  axes: [
    { id: 'A', cx: '-29 / 50', cy: 0, r: 1, stops: 4, color: '#16a34a' },
    { id: 'B', cx: '29 / 50', cy: 0, r: 1, stops: 4, color: '#ef4444' },
  ],
  cuts: [
    { op: 'sliceByAxes' },
    {
      op: 'closure',
      maxIters: 8,
      blocks: [
        { moves: ['A', 'B'], repeat: 10 },
        { moves: ["A'", "B'"], repeat: 10 },
        { moves: ['A', "B'"], repeat: 10 },
        { moves: ["A'", 'B'], repeat: 10 },
      ],
    },
  ],
  coloring: [
    {
      type: 'venn',
      colors: { A: '#16a34a', B: '#ef4444', AB: '#38bdf8' },
    },
  ],
  sampleAlgorithms: [
    {
      name: '90° Commutator [A, B]',
      alg: '[A, B]',
      note: 'Clean quarter-turn commutator across the unbandaged Pocket Quatrium overlap',
    },
    {
      name: '180°/90° Commutator [A2, B]',
      alg: '[A2, B]',
      note: 'Half-turn A2 combined with quarter-turn exchanges on B',
    },
  ],
};

/**
 * 10. Arecibo (El Cubitero — deep-overlap 120° two-circle puzzle, 69 pieces, mirror=[x,y])
 */
export const ARECIBO_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'arecibo',
  name: 'Arecibo',
  category: 'Designer & Exotic',
  description:
    'El Cubitero’s Arecibo: two deeply overlapping 120° circles with dense dish-like curved cuts in Red, Light Blue, and Yellow (69 pieces).',
  symmetryStepDeg: 180,
  axes: [
    { id: 'A', cx: '-20.5 / 50', cy: 0, r: 1, stops: 3, color: '#ef4444' },
    { id: 'B', cx: '20.5 / 50', cy: 0, r: 1, stops: 3, color: '#38bdf8' },
  ],
  cuts: [
    { op: 'sliceByAxes' },
    {
      op: 'closure',
      maxIters: 8,
      blocks: [
        { moves: ['A', 'B'], repeat: 12 },
        { moves: ["A'", "B'"], repeat: 12 },
        { moves: ['A', "B'"], repeat: 12 },
        { moves: ["A'", 'B'], repeat: 12 },
      ],
    },
  ],
  coloring: [
    {
      type: 'venn',
      colors: { A: '#ef4444', B: '#38bdf8', AB: '#facc15' },
    },
  ],
  sampleAlgorithms: [
    {
      name: '120° Commutator [A, B]',
      alg: '[A, B]',
      note: '120° commutator across the deep-cut Arecibo dish',
    },
    {
      name: "120° Conjugate [A': B]",
      alg: "[A': B]",
      note: "CCW 120° setup A' paired with B for deep-dish piece exchanges",
    },
  ],
};

/**
 * 11. Curvystar / Mimosa (Dmitry Andreev & Andrey Yerashkevich — 72° + 180°, 73 pieces, mirror=[x])
 */
export const MIMOSA_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'mimosa',
  name: 'Curvystar (Mimosa)',
  category: 'Designer & Exotic',
  description:
    'Pluton’s Mimosa (Curvystar): a 72° red pentagonal disk paired with an overlapping 180° green disk (73 pieces).',
  params: {
    d: '37.9 / 50',
    c72: 'cos(rad(72))',
    r1: 'd * c72 + sqrt(d * d * c72 * c72 + 1 - d * d)',
    ox: '(-r1 + d + 1) / 2',
  },
  axes: [
    { id: 'A', cx: '-ox', cy: 0, r: 'r1', stops: 5, color: '#ef4444' },
    { id: 'B', cx: 'd - ox', cy: 0, r: 1, stops: 2, color: '#16a34a' },
  ],
  cuts: [
    { op: 'sliceByAxes' },
    {
      op: 'closure',
      maxIters: 8,
      blocks: [
        { moves: ['A', 'B'], repeat: 16 },
        { moves: ["A'", 'B'], repeat: 16 },
      ],
    },
  ],
  coloring: [
    {
      type: 'venn',
      colors: { A: '#ef4444', B: '#16a34a', AB: '#ef4444' },
    },
  ],
  sampleAlgorithms: [
    {
      name: "72°/180° Conjugate [A2': B]",
      alg: "[A2': B]",
      note: 'Turns pentagonal disk A 144° CCW, flips B 180°, then restores A',
    },
    {
      name: '72°/180° Commutator [A, B]',
      alg: '[A, B]',
      note: 'Commutes 72° turns on A with 180° flips on B',
    },
  ],
};

/**
 * 12. Eliac (Galen Ivanov / Del Rubikeo — 90° + 180° deep-overlap circles, 59 pieces, mirror=[x])
 */
export const ELIAC_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'eliac',
  name: 'Eliac',
  category: 'Designer & Exotic',
  description:
    'Galen Ivanov & Del Rubikeo’s Eliac: two deeply overlapping equal circles with 90° turns on A and 180° half-turns on B (59 pieces).',
  axes: [
    { id: 'A', cx: '-17.75 / 50', cy: 0, r: 1, stops: 4, color: '#f97316' },
    { id: 'B', cx: '17.75 / 50', cy: 0, r: 1, stops: 2, color: '#9333ea' },
  ],
  cuts: [
    { op: 'sliceByAxes' },
    {
      op: 'closure',
      maxIters: 8,
      blocks: [
        { moves: ['A', 'B'], repeat: 16 },
        { moves: ["A'", 'B'], repeat: 16 },
      ],
    },
  ],
  coloring: [
    {
      type: 'venn',
      colors: { A: '#f97316', B: '#9333ea', AB: '#14b8a6' },
    },
  ],
  sampleAlgorithms: [
    {
      name: "90°/180° Conjugate [A': B]",
      alg: "[A': B]",
      note: "Quarter-turn A' paired with a 180° flip on B",
    },
    {
      name: '90°/180° Commutator [A, B]',
      alg: '[A, B]',
      note: 'Commutes 90° turns on A with 180° flips on B',
    },
  ],
};

/**
 * 13. 3-Circle Clover / Tri-Venn (60° equilateral Reuleaux symmetry, 37 pieces, mirror=[y])
 */
export const THREE_CIRCLE_CLOVER_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'three-circle-clover',
  name: '3-Circle Clover (60°)',
  category: 'Classic Circles',
  description:
    '3 overlapping primary-color circles in equilateral Reuleaux symmetry (60° stops) with secondary-color overlap lenses and a bright central hub (37 pieces).',
  symmetryStepDeg: 120,
  axes: [
    {
      ring: {
        ids: 'ABC',
        centerRadius: '1 / sqrt3',
        r: 1,
        startAngleDeg: 90,
        stops: 6,
        colors: ['#ef4444', '#facc15', '#2563eb'],
      },
    },
  ],
  cuts: [
    { op: 'sliceByAxes' },
    {
      op: 'closure',
      maxIters: 8,
      blocks: [
        { moves: ['A', 'B', 'C'], repeat: 8 },
        { moves: ["A'", "B'", "C'"], repeat: 8 },
        { moves: ['A', "B'", 'C'], repeat: 8 },
        { moves: ["A'", 'B', "C'"], repeat: 8 },
      ],
    },
  ],
  coloring: [
    {
      type: 'venn',
      colors: {
        A: '#ef4444',
        B: '#facc15',
        C: '#2563eb',
        AB: '#f97316',
        BC: '#16a34a',
        AC: '#9333ea',
        ABC: '#f8fafc',
      },
    },
  ],
  sampleAlgorithms: [
    {
      name: '60° Commutator [A, B]',
      alg: '[A, B]',
      note: 'Clean 60° commutator across the Tri-Venn overlap',
    },
    {
      name: '3-fold symmetry [z: [A, B]]',
      alg: 'c = [A, B]\n[z: c]',
      note: 'Applies the commutator rotated 120° CW around the clover',
    },
  ],
};

/**
 * 14. 2-Circle Venn / Mandorla (120°, 21 pieces, mirror=[x,y])
 */
export const TWO_CIRCLE_VENN_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'two-circle',
  name: '2-Circle Venn (Mandorla 120°)',
  category: 'Classic Circles',
  description:
    'Fully unbandaged 21-piece 2-circle Venn puzzle (Mandorla) with 120° stops. Every turn aligns cleanly — ideal for learning commutators and conjugates.',
  symmetryStepDeg: 180,
  axes: [
    { id: 'A', cx: '-25.05 / 50', cy: 0, r: 1, stops: 3, color: '#38bdf8' },
    { id: 'B', cx: '25.05 / 50', cy: 0, r: 1, stops: 3, color: '#16a34a' },
  ],
  cuts: [
    { op: 'sliceByAxes' },
    {
      op: 'closure',
      maxIters: 8,
      blocks: [
        { moves: ['A', 'B'], repeat: 8 },
        { moves: ["A'", "B'"], repeat: 8 },
        { moves: ['A', "B'"], repeat: 8 },
        { moves: ["A'", 'B'], repeat: 8 },
      ],
    },
  ],
  coloring: [
    {
      type: 'venn',
      colors: { A: '#38bdf8', B: '#16a34a', AB: '#facc15' },
    },
  ],
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
 * 15. 4-Circle Clover (90° square symmetry, 16 pieces, mirror=[x,y])
 */
export const FOUR_CIRCLE_CLOVER_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'four-circle-clover',
  name: '4-Circle Clover (90°)',
  category: 'Classic Circles',
  description:
    '4 intersecting circles in square symmetry with 90° stops, distinct blended overlap lenses, and fully unbandaged quarter-turn moves.',
  symmetryStepDeg: 90,
  axes: [
    {
      ring: {
        ids: 'ABCD',
        centerRadius: '(38 / 50) * sqrt2',
        r: 1,
        startAngleDeg: 45,
        stops: 4,
        colors: ['#ef4444', '#facc15', '#16a34a', '#2563eb'],
      },
    },
  ],
  cuts: [
    { op: 'sliceByAxes' },
    {
      op: 'closure',
      maxIters: 6,
      blocks: [
        { moves: ['A', 'B', 'C', 'D'], repeat: 4 },
        { moves: ["A'", "B'", "C'", "D'"], repeat: 4 },
      ],
    },
  ],
  coloring: [
    {
      type: 'venn',
      colors: {
        A: '#ef4444',
        B: '#facc15',
        C: '#16a34a',
        D: '#2563eb',
        AB: '#f97316',
        BC: '#84cc16',
        CD: '#06b6d4',
        AD: '#a855f7',
      },
    },
  ],
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
 * 16. 6-Circle Hex Flower (60° hexagonal lattice, 66 pieces, mirror=[x,y])
 */
export const SIX_CIRCLE_HEX_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'six-circle-hex',
  name: '6-Circle Hex Flower (60°)',
  category: 'Classic Circles',
  description:
    '6 overlapping circles in hexagonal symmetry with 60° stops, unbandaged across the full hexagonal lattice.',
  symmetryStepDeg: 60,
  axes: [
    {
      ring: {
        ids: 'ABCDEF',
        centerRadius: 1,
        r: 1,
        startAngleDeg: 90,
        stops: 6,
        colors: ['#ef4444', '#f97316', '#facc15', '#16a34a', '#2563eb', '#9333ea'],
      },
    },
  ],
  cuts: [
    { op: 'sliceByAxes' },
    {
      op: 'closure',
      maxIters: 6,
      blocks: [
        { moves: ['A', 'B', 'C', 'D', 'E', 'F'], repeat: 6 },
        { moves: ["A'", "B'", "C'", "D'", "E'", "F'"], repeat: 6 },
      ],
    },
  ],
  coloring: [
    { type: 'fill', color: '#f8fafc' },
    {
      type: 'venn',
      colors: {
        A: '#ef4444',
        B: '#f97316',
        C: '#facc15',
        D: '#16a34a',
        E: '#2563eb',
        F: '#9333ea',
        AB: '#cbd5e1',
        BC: '#cbd5e1',
        CD: '#cbd5e1',
        DE: '#cbd5e1',
        EF: '#cbd5e1',
        AF: '#cbd5e1',
      },
    },
  ],
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
 * 17. 7-Circle Flower (1 central ring G + 6 outer rings A..F, 60°, 66 pieces, mirror=[x,y])
 */
export const SEVEN_CIRCLE_FLOWER_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'seven-circle-flower',
  name: '7-Circle Flower (60°)',
  category: 'Classic Circles',
  description:
    '6 hexagonal outer rings (A–F) surrounding a playable central ring (G) with 60° stops — spin the center flower to route pieces between all six arms.',
  symmetryStepDeg: 60,
  axes: [
    {
      ring: {
        ids: 'ABCDEF',
        centerRadius: 1,
        r: 1,
        startAngleDeg: 90,
        stops: 6,
        colors: ['#ef4444', '#f97316', '#facc15', '#16a34a', '#2563eb', '#9333ea'],
      },
    },
    { id: 'G', cx: 0, cy: 0, r: 1, stops: 6, color: '#14b8a6' },
  ],
  cuts: [
    { op: 'sliceByAxes' },
    {
      op: 'closure',
      maxIters: 6,
      blocks: [
        { moves: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], repeat: 6 },
        { moves: ["A'", "B'", "C'", "D'", "E'", "F'", "G'"], repeat: 6 },
      ],
    },
  ],
  coloring: [
    {
      type: 'venn',
      colors: {
        A: '#ef4444',
        B: '#f97316',
        C: '#facc15',
        D: '#16a34a',
        E: '#2563eb',
        F: '#9333ea',
        AB: '#cbd5e1',
        BC: '#cbd5e1',
        CD: '#cbd5e1',
        DE: '#cbd5e1',
        EF: '#cbd5e1',
        AF: '#cbd5e1',
        ABG: '#14b8a6',
        BCG: '#14b8a6',
        CDG: '#14b8a6',
        DEG: '#14b8a6',
        EFG: '#14b8a6',
        AFG: '#14b8a6',
        ABFG: '#ef4444',
        ABCG: '#f97316',
        BCDG: '#facc15',
        CDEG: '#16a34a',
        DEFG: '#2563eb',
        AEFG: '#9333ea',
      },
    },
  ],
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
 * 18. Pocket Quatrium Plus (James Li — 3 inline 90° circles, 49 pieces, mirror=[x,y])
 */
export const POCKET_QUATRIUM_PLUS_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'pocket-quatrium-plus',
  name: 'Pocket Quatrium Plus',
  category: 'Designer & Exotic',
  description:
    'James Li’s 3-circle inline 90° Pocket Quatrium Plus with pink, light-blue, and yellow circles plus blended overlap lenses.',
  symmetryStepDeg: 180,
  axes: [
    { id: 'A', cx: '-58 / 50', cy: 0, r: 1, stops: 4, color: '#f472b6' },
    { id: 'B', cx: 0, cy: 0, r: 1, stops: 4, color: '#38bdf8' },
    { id: 'C', cx: '58 / 50', cy: 0, r: 1, stops: 4, color: '#facc15' },
  ],
  cuts: [
    { op: 'sliceByAxes' },
    {
      op: 'closure',
      maxIters: 8,
      blocks: [
        { moves: ['A', 'B', 'C'], repeat: 8 },
        { moves: ["A'", "B'", "C'"], repeat: 8 },
        { moves: ['A', "B'", 'C'], repeat: 8 },
        { moves: ["A'", 'B', "C'"], repeat: 8 },
      ],
    },
  ],
  coloring: [
    {
      type: 'venn',
      colors: {
        A: '#f472b6',
        B: '#38bdf8',
        C: '#facc15',
        AB: '#9333ea',
        BC: '#f97316',
      },
    },
  ],
  sampleAlgorithms: [
    {
      name: "Inline walk (A B C2 B')",
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
 * 19. Starcopter / Fomalhaut (Dmitry Andreev / Pluton — 72° unequal circles, 90 pieces, mirror=[x])
 */
export const FOMALHAUT_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'fomalhaut',
  name: 'Starcopter (Fomalhaut)',
  category: 'Designer & Exotic',
  description:
    'Dmitry Andreev’s Fomalhaut (Starcopter): two unequal 72° pentagonal circles with intricate star-petal cuts (90 pieces).',
  axes: [
    { id: 'A', cx: '-36 / 50', cy: 0, r: 1, stops: 5, color: '#facc15' },
    { id: 'B', cx: '28 / 50', cy: 0, r: '58 / 50', stops: 5, color: '#2563eb' },
  ],
  cuts: [
    { op: 'sliceByAxes' },
    {
      op: 'closure',
      maxIters: 8,
      blocks: [
        { moves: ['A', "B'"], repeat: 20 },
        { moves: ["A'", 'B'], repeat: 20 },
      ],
    },
  ],
  coloring: [
    {
      type: 'venn',
      colors: { A: '#facc15', B: '#2563eb', AB: '#facc15' },
    },
  ],
  sampleAlgorithms: [
    {
      name: "72° Commutator [A, B']",
      alg: "[A, B']",
      note: '72° commutator across the unequal Fomalhaut overlap',
    },
  ],
};

/**
 * 20. Cube4you GigaHex (2 concentric 2-layer 60° circles, 105 pieces, mirror=[x,y])
 */
export const GIGAHEX_DOC: RingTwistPuzzleDoc = {
  format: 'ringtwist/v1',
  id: 'gigahex',
  name: 'GigaHex',
  category: 'Designer & Exotic',
  description:
    'Cube4you GigaHex: two overlapping 2-layer 60° circles (A/B inner disks, 2A/2B outer slices, a/b wide turns) with 105 pieces.',
  symmetryStepDeg: 180,
  axes: [
    {
      id: 'A',
      cx: '-31.5 / 50',
      cy: 0,
      r: 1,
      layers: [0.8, 1],
      stops: 6,
      color: '#16a34a',
    },
    {
      id: 'B',
      cx: '31.5 / 50',
      cy: 0,
      r: 1,
      layers: [0.8, 1],
      stops: 6,
      color: '#f97316',
    },
  ],
  cuts: [
    { op: 'sliceByAxes' },
    {
      op: 'closure',
      maxIters: 8,
      blocks: [
        { moves: ['a', 'b'], repeat: 10 },
        { moves: ["a'", "b'"], repeat: 10 },
      ],
    },
  ],
  coloring: [
    { type: 'fill', color: '#1e293b' },
    { type: 'region', inside: ['A', 'B'], color: '#facc15' },
    {
      type: 'region',
      inside: ['A', { axis: 'B', around: 'A', angleDeg: 120 }],
      color: '#16a34a',
    },
    {
      type: 'region',
      inside: ['A', { axis: 'B', around: 'A', angleDeg: -120 }],
      color: '#ef4444',
    },
    {
      type: 'region',
      inside: ['B', { axis: 'A', around: 'B', angleDeg: -120 }],
      color: '#f97316',
    },
    {
      type: 'region',
      inside: ['B', { axis: 'A', around: 'B', angleDeg: 120 }],
      color: '#2563eb',
    },
  ],
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

/** Starter templates shown in the Custom Puzzle JSON Studio. */
export const CUSTOM_PUZZLE_TEMPLATES: { label: string; doc: RingTwistPuzzleDoc }[] = [
  {
    label: '2-Circle Venn (Custom)',
    doc: {
      format: 'ringtwist/v1',
      id: 'custom-venn',
      name: 'My 2-Circle Puzzle',
      category: 'Custom',
      description: 'Two overlapping 60° circles with 3-color Venn shading.',
      symmetryStepDeg: 180,
      axes: [
        { id: 'A', cx: -0.6, cy: 0, r: 1, stops: 6, color: '#ef4444' },
        { id: 'B', cx: 0.6, cy: 0, r: 1, stops: 6, color: '#38bdf8' },
      ],
      cuts: [{ op: 'closure', moves: ['A', 'B'], maxIters: 8 }],
      coloring: [
        {
          type: 'venn',
          colors: { A: '#ef4444', B: '#38bdf8', AB: '#facc15' },
        },
      ],
    },
  },
  {
    label: '2-Layer Concentric',
    doc: {
      format: 'ringtwist/v1',
      id: 'custom-concentric',
      name: 'My Concentric Rings',
      category: 'Custom',
      description: 'Two 2-layer 90° circles supporting A (inner), 2A (slice), and a (wide).',
      symmetryStepDeg: 180,
      axes: [
        { id: 'A', cx: -0.65, cy: 0, r: 1, layers: [0.75, 1], stops: 4, color: '#16a34a' },
        { id: 'B', cx: 0.65, cy: 0, r: 1, layers: [0.75, 1], stops: 4, color: '#f97316' },
      ],
      cuts: [{ op: 'closure', moves: ['a', 'b'], maxIters: 8 }],
      coloring: [
        {
          type: 'venn',
          colors: { A: '#16a34a', B: '#f97316', AB: '#facc15' },
        },
      ],
    },
  },
  {
    label: '5-Circle Flower',
    doc: {
      format: 'ringtwist/v1',
      id: 'custom-flower',
      name: 'My 5-Circle Flower',
      category: 'Custom',
      description: 'Five 72° circles in a regular pentagon with swirling arm colors.',
      symmetryStepDeg: 72,
      axes: [
        {
          ring: {
            ids: 'ABCDE',
            centerRadius: 0.95,
            r: 1,
            startAngleDeg: 90,
            stops: 5,
            colors: ['#ef4444', '#facc15', '#22c55e', '#38bdf8', '#a855f7'],
          },
        },
      ],
      coloring: [
        {
          type: 'cyclicArm',
          axes: 'ABCDE',
          colors: ['#ef4444', '#facc15', '#22c55e', '#38bdf8', '#a855f7'],
        },
      ],
    },
  },
  {
    label: 'Exterior Turn (Moon-Style)',
    doc: {
      format: 'ringtwist/v1',
      id: 'custom-exterior',
      name: 'My Exterior Spinner',
      category: 'Custom',
      description: 'An active 180° disk A paired with a 90° exterior-turn frame B.',
      viewBounds: [-1.75, 1.75, -1.75, 1.75],
      axes: [
        { id: 'A', cx: -0.65, cy: 0, r: 1, stops: 2, color: '#38bdf8', labelPos: [-1.9, 0] },
        {
          id: 'B',
          cx: 0,
          cy: 0,
          r: 1,
          stops: 4,
          region: 'outside',
          color: '#facc15',
          labelPos: [1.9, 0],
        },
      ],
      silhouette: {
        parts: [
          {
            circles: [
              'B',
              { ring: { count: 4, centerRadius: 0.65, r: 1, startAngleDeg: 180 } },
            ],
            outside: ['B'],
          },
          { circles: ['B', 'A'], inside: ['B'] },
        ],
      },
      cuts: [
        {
          op: 'closure',
          maxIters: 8,
          blocks: [
            { moves: ['A', 'B'], repeat: 4 },
            { moves: ['A'], repeat: 1 },
          ],
        },
      ],
      coloring: [
        { type: 'fill', color: '#22c55e' },
        { type: 'region', outside: ['B', 'A'], minY: 0, color: '#f43f5e' },
        { type: 'region', outside: ['B'], inside: ['A'], color: '#f97316' },
        { type: 'region', inside: ['B', 'A'], color: '#38bdf8' },
        { type: 'region', inside: ['B'], outside: ['A'], color: '#facc15' },
      ],
    },
  },
];
