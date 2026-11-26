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
