# RingTwist Puzzle Format (`ringtwist/v1`)

RingTwist includes a declarative, **index-free**, pure-JSON format (`"format": "ringtwist/v1"`) for defining 2D twisty circle puzzles. You can use it both for built-in puzzles in [`src/puzzle/definitions.ts`](../src/puzzle/definitions.ts) and directly in the browser via **Choose a Puzzle → `+ Custom JSON`** (or by clicking **`{ }`** on any puzzle card to inspect or fork it).

Unlike legacy line-script formats that address pieces by fragile creation indices (`HideParts: 17`, `SetColorParts: 4 9 12`), `ringtwist/v1` describes **geometry, cuts, bandaging, and coloring semantically** — so tweaking a radius or adding a layer never scrambles part numbers.

---

## Top-Level Schema

```json
{
  "format": "ringtwist/v1",
  "id": "my-puzzle",
  "name": "My Puzzle",
  "category": "Custom",
  "description": "Short description shown in the picker.",
  "symmetryStepDeg": 180,
  "symmetryCenter": [0, 0],
  "viewBounds": [-2.2, 2.2, -1.6, 1.6],
  "params": { ... },
  "axes": [ ... ],
  "silhouette": { ... },
  "cuts": [ ... ],
  "coloring": [ ... ],
  "stickers": [ ... ],
  "sampleAlgorithms": [
    { "name": "Commutator", "alg": "[A, B]", "note": "Optional tooltip" }
  ]
}
```

- `id`: lowercase slug (`^[a-z0-9][a-z0-9_-]{0,48}$`).
- `symmetryStepDeg`: rotational symmetry step in degrees for `z` / `z'` (`0` if asymmetric). Mirror symmetry (`x` / `y` flips) is detected automatically from the solved geometry!

---

## Math Expressions & `params`

Any numeric geometry field (`NumExpr`) accepts either a JSON number or a **CSP-safe math expression string** evaluated by a built-in recursive-descent parser (no `eval`):

- **Built-in constants:** `pi`, `tau` ($2\pi$), `phi` ($\frac{1+\sqrt{5}}{2}$), `sqrt2`, `sqrt3`.
- **Operators:** `+`, `-`, `*`, `/`, `^`, unary `-`, parentheses.
- **Functions (radians for trig, with `rad()`/`deg()` helpers):** `sin(x)`, `cos(x)`, `tan(x)`, `asin(x)`, `acos(x)`, `atan(x)`, `atan2(y, x)`, `rad(deg)`, `deg(rad)`, `sqrt(x)`, `abs(x)`, `min(...)`, `max(...)`.
- **Derived `params`:** Defined in order; later parameters can reference earlier ones (e.g. `"d": "2 * r * sin(rad(36))"`).

---

## `axes` (Single Source of Truth)

Every entry in `axes` defines playable turn axes (IDs `A`–`W`; `X`, `Y`, `Z` are reserved for flips and whole-puzzle rotations):

### Explicit Axis
```json
{
  "id": "A",
  "cx": -0.6,
  "cy": 0,
  "r": 1,
  "layers": [0.68, 1],
  "stops": 6,
  "region": "inside",
  "discovered": false,
  "color": "#ef4444",
  "labelPos": [-1.2, 0]
}
```
- `layers` (optional): inner-to-outer concentric radii (enables `A` inner cap, `2A` outer ring slice, and `a` wide full circle).
- `stops`:
  - integer `n` → `n` even CW stops (`6` → `0°, 60°, ..., 300°`),
  - array of explicit CW stop angles in degrees (`[0, 36, 108, ...]`), or
  - `{ "steps": [36, 72, ...] }` (cumulative CW increments summing to 360°).
- `region` (optional): `"inside"` (default) or `"outside"` (rotates everything *outside* the circle, as in ThinkFun Moonspinner).
- `discovered` (optional, supported on both explicit axes and `ring` generators): marks an emergent internal grip (like **Cube4you OctoCrystal**'s `I–P`) that is excluded from the initial silhouette/cuts, stays hidden while blocked, and highlights in amber-gold whenever pieces align to unlock it.

### Ring Generator
Generates $N$ evenly spaced axes around a center:
```json
{
  "ring": {
    "ids": "ABCDEFGH",
    "centerRadius": "rc",
    "center": [0, 0],
    "r": 1,
    "startAngleDeg": 90,
    "stops": 8,
    "colors": ["#e11d48", "#f97316", "#facc15", "#22c55e", "#14b8a6", "#3b82f6", "#6366f1", "#a855f7"]
  }
}
```

---

## `silhouette` (Optional)

By default, the starting shape is the union of all outer axis circles (`sliceCircles` of all axes). Provide `silhouette` when the puzzle body differs from the union of turn circles (for example, an exterior-turn puzzle like Moonspinner or a custom outer frame):

```json
"silhouette": {
  "parts": [
    { "circles": ["A", { "ring": { "count": 5, "centerRadius": "d", "r": 1, "startAngleDeg": 90 } }] }
  ]
}
```

Each part supports optional `inside` / `outside` circle filters to keep only matching regions.

---

## `cuts` Pipeline

An ordered list of geometric cut and bandaging operations executed after the initial silhouette:

1. **`sliceByAxes`**: Slices all pieces against all axis circles (and optionally specific `axes` like `["A:1", "B"]` where `:1` selects layer 1).
2. **`closure`**: Iteratively applies RingTwist moves (`"A"`, `"B'"`, `"B2"`, `"a"`, `"2A"`, …), slices straddling pieces, and converges (up to `maxIters`).
   - Supports simple `moves` arrays or structured `blocks: [{ "moves": [...], "repeat": 2 }]`.
   - Individual move steps can specify `{ "move": "B", "cutBy": ["A:1", "B"], "only": RegionFilter, "skip": RegionFilter }` to selectively cut by specific layers or mask out protected regions (index-free equivalent of `HideParts`).
3. **`cutCircles`**: Slices against explicit auxiliary circles or ring generators, with optional `repeatSymmetry`, `only`, and `skip` `RegionFilter` masks.
4. **`orbitSlice`**: Rotates pieces around a pivot (`axis` or `[cx, cy]`) by `anglesDeg`, slicing at each stop and rotating back.
5. **`bandage`**: Index-free merging of pieces into a single piece, with optional `symmetric: true | N` rotational replication:
   - `where`: array of **`RegionFilter`** predicates (`inside`, `outside`, `memberCount`, `ofAxes`, `minArea`, `maxArea`, `angleDeg`, `minX..maxY`) — each filter fuses all matching pieces.
   - `groups`: optional explicit `[x, y]` probe point groups.

---

## `coloring` Rules

Evaluated sequentially — later rules override earlier ones:

- **`{ "type": "default" }`**: Nearest axis home color.
- **`{ "type": "fill", "color": "#..." }`**: Sets all pieces to one color.
- **`{ "type": "venn", "colors": { "A": "#...", "AB": "#...", ... } }`**: Sorted axis-membership coloring.
- **`{ "type": "cyclicArm", "axes": "ABCDE", "direction": "cw", "colors": [...] }`**: Colors pieces by cyclic arm (`inside[k] && !inside[k+1]`).
- **`{ "type": "region", ...RegionFilter, "color": "#...", "repeatSymmetry": { "count": 10, "colors": [...] } }`**: Geometric set predicate supporting `inside`, `outside` (including rotated circle refs `{ "axis": "A", "around": "B", "angleDeg": 120 }`), `memberCount`, `ofAxes`, `minArea`/`maxArea`, `angleDeg`, `minX..maxY`, and optional `repeatSymmetry` to stamp a single region rule around all $N$ symmetry arms with a color palette.
- **`{ "type": "points", "probes": [{ "x": 0.2, "y": -0.3, "color": "#..." }] }`**: Index-free point-in-piece probes.

---

## `stickers` (Optional)

Attach oriented multi-color wedge stickers to a piece (which rotate with the piece and are checked by `isPuzzleSolved()`):

```json
"stickers": [
  {
    "type": "centerWedges",
    "point": [0, 0],
    "colors": ["#ef4444", "#facc15", "#22c55e", "#3b82f6", "#a855f7"],
    "startAngleDeg": 90
  }
]
```

---

## Complete Example: 2-Layer Concentric Rings

```json
{
  "format": "ringtwist/v1",
  "id": "custom-2layer-rings",
  "name": "2-Layer Concentric (Custom)",
  "category": "Custom",
  "description": "Two overlapping 2-layer concentric circles with 60° turns.",
  "symmetryStepDeg": 180,
  "params": { "d": 0.62, "rIn": 0.68 },
  "axes": [
    { "id": "A", "cx": "-d", "cy": 0, "r": 1, "layers": ["rIn", 1], "stops": 6, "color": "#ef4444" },
    { "id": "B", "cx": "d",  "cy": 0, "r": 1, "layers": ["rIn", 1], "stops": 6, "color": "#38bdf8" }
  ],
  "cuts": [
    { "op": "sliceByAxes" },
    { "op": "closure", "moves": ["a", "b"], "maxIters": 10 }
  ],
  "coloring": [
    {
      "type": "venn",
      "colors": { "A": "#ef4444", "B": "#38bdf8", "AB": "#facc15" }
    }
  ],
  "sampleAlgorithms": [
    { "name": "Inner commutator", "alg": "[A, B]" },
    { "name": "Outer ring swap", "alg": "[2A, b]" }
  ]
}
```
