# RingTwist Architecture & Contributor Guide

RingTwist is a pure client-side TypeScript application bundled with Vite, with **zero runtime dependencies**. All puzzle geometry is computed analytically using circular arcs rather than polygon approximations.

---

## Module Overview

```text
src/
├── geom/
│   ├── math.ts               # Angle normalization, circle-circle intersections, float snapping
│   ├── arcRegion.ts          # Immutable ArcRegion representation, Green's-theorem area,
│   │                         # bounding-circle + midpoint classification, SVG path generation
│   └── slicer.ts             # Planar DCEL circle slicer, region splitting, and bandaging merges
├── puzzle/
│   ├── types.ts              # PuzzleSpec, CircleDef, Piece, StickerWedge, PuzzleState
│   ├── engine.ts             # Move execution, blocking checks, state hashing, seeded scrambles
│   ├── geraniumsPotScript.ts # CSP-safe interpreter for GeraniumsPot .txt puzzle scripts
│   ├── geraniumBuilder.ts    # Exact 13-puzzle script definitions & custom builders
│   ├── builder.ts            # Declarative PuzzleSpec builder (dispatches to customBuilder or DCEL)
│   └── catalog.ts            # Exported PUZZLE_CATALOG, metadata, and verified sample algorithms
├── lang/
│   ├── ast.ts                # AST node and source-span types
│   ├── parser.ts             # Linear-time tokenizer and recursive-descent Twizzle-style parser
│   └── evaluator.ts          # Non-doctrinaire evaluator, permutation/cycle fast-forward, order analyzer
├── ui/
│   ├── svgRenderer.ts        # Interactive animated SVG stage & static thumbnail renderer
│   ├── editor.ts             # Transparent-textarea syntax-highlighted editor with span overlays
│   ├── moveCoalesce.ts       # Interactive click/scroll move merging (B + B -> B2) & cancellation (B + B')
│   ├── puzzlePicker.ts       # Visual category-filtered puzzle picker modal with cached thumbnails
│   ├── helpModal.ts          # Notation & controls guide modal
│   └── storage.ts            # localStorage macro persistence and UTF-8 base64url hash sharing
├── main.ts                   # RingTwistApp controller wiring state, playback, and DOM controls
└── style.css                 # Dark-theme layout and component styling
```

---

## Core Design Invariants

### 1. Analytical `ArcRegion` Geometry (`src/geom/`)
- Every puzzle piece is an immutable `ArcRegion` consisting of a closed counter-clockwise loop of exact circular arcs (`ArcEdge`: center `(cx, cy)`, radius `r`, `startAngle`, signed `sweep`).
- **Immutability enables caching:** `ArcRegion` lazily caches its rotation-invariant bounding circle (`_bounds`), default SVG path (`_svgPath`), and canonical silhouette key (`_silhouetteKey`). Rotated pieces return fresh objects, while unmoved pieces (~150+ of 196 on Super Geranium Plus) hit caches in $O(1)$.
- **Chromium/Skia SVG safety:** `regionToSvgPath()` and `stickerWedgeToSvgPath()` subdivide any circular arc $> 80^\circ$ into exact analytical sub-arcs so browser path engines never suffer near-semicircle/origin sagitta bulge bugs.
- **Zero-drift long solves:** Piece rotations preserve exact radii and sweeps; canonical hashing snaps coordinates on a $10^{-3}$ grid, giving exact round-trip identity even across 600+ move sequences.

### 2. Non-Doctrinaire Blocking & Orientation Stickers (`src/puzzle/engine.ts`)
- A circle is **blocked** if any piece straddles its boundary (`classifyRegionAgainstCircle === 'straddling'`).
- Multi-color oriented pieces (such as the central 5-color pentagon on Geranium / Super Geranium) carry `StickerWedge[]` that rotate rigidly with their parent piece and participate in `hashPuzzleState()` via `pieceStickerKey()`.
- `isPuzzleSolved()` checks membership in the solved state's rotational-symmetry orbit (cached in a `WeakMap<PuzzleState, Set<string>>`).

### 3. Group-Theory Fast-Forward & Order Analysis (`src/lang/evaluator.ts`)
- **Shape-preserving algorithms:** When a repeated sequence leaves the overall cut silhouette unchanged (and leaves any orientation-sticker pieces fixed), `extractShapePermutation()` extracts the exact piece permutation $\pi$ and evaluates $\pi^k$ in $O(n)$ via cycle decomposition.
- **`BigInt` prime-factor order reduction:** `analyzeAlgorithm()` computes the exact piece-permutation order as a `BigInt` LCM of cycle lengths, then greedily divides out prime factors in $O(\Omega(N))$ to find the exact smallest color-visible order without $O(\sqrt{N})$ trial division or 53-bit overflow.
- **Non-shape-preserving algorithms:** Falls back to compile-once AST execution with state-hash cycle detection.

---

## Adding a New Puzzle

1. **Define the construction script or builder** in [`src/puzzle/geraniumBuilder.ts`](../src/puzzle/geraniumBuilder.ts):
   - Most 2D twisty circle puzzles can be expressed directly as a `GeraniumsPot` script (`Param:`, `Ring:`, `CopyRing:`, `AutoCutParts:`, `CutCircles:`, `HideParts:`, `CopyParts:`, `AutoColorParts:`, `SetColorParts:`) executed via `buildFromGeraniumsPotScript()`.
   - Remember that `GeraniumsPot` scripts use native radii (typically `50` or `70`), normalized to RingTwist's unit scale via `coordScale` and `originOffset`.
2. **Register a `PuzzleSpec`** in [`src/puzzle/catalog.ts`](../src/puzzle/catalog.ts):
   - Set `id`, `name`, `category` (`'Geranium Family'` or `'Classic Circles'`), `description`, `circles` (with spatial IDs `A..Z`, stop angles `stopsDeg`, and home colors), `symmetryStepDeg` (`0` if asymmetric), `customBuilder`, and `sampleAlgorithms`.
   - Append the spec to `PUZZLE_CATALOG`.
3. **Verify automatically with `npm test`:**
   - [`src/puzzle/catalog.test.ts`](../src/puzzle/catalog.test.ts) automatically tests **every** entry in `PUZZLE_CATALOG` for:
     - Zero straddling pieces in the solved state,
     - Exact analytical area conservation against the union of circles,
     - Deterministic seeded scramble generation and legal execution,
     - Clean parsing and expected blocking/non-blocking behavior of every entry in `sampleAlgorithms`.
