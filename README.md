# RingTwist

A **text-first 2D twisty circle puzzle simulator** built for exploring and solving **non-doctrinaire (blocking / bandaged)** circle puzzles like the VeryPuzzle Geranium Plus.

**Live demo:** [joshmermelstein.com/ringtwist](https://joshmermelstein.com/ringtwist/) · **License:** [MIT](LICENSE)

![RingTwist running Geranium Plus with a symmetry macro](docs/screenshot.png)

Inspired by [Twizzle](https://alpha.twizzle.net/explore/?puzzle=3x3x3) for algorithm notation/playback and [GeraniumsPot](https://github.com/grigorusha/GeraniumsPot/) for exact 2D circle-puzzle geometry — running 100% client-side in the browser with **zero runtime dependencies**.

---

## Features

- **Analytical 2D Arc-Region Geometry**: Exact circular-arc piece representation (`ArcRegion`), planar DCEL circle slicing, analytical Green's-theorem areas, and zero-drift canonical snapping across 600+ move round-trips.
- **Twizzle-Style Notation & Non-Doctrinaire Execution**:
  - Fixed stop turns (`A`, `A2`, `A'`), concentric multi-layer turns using inverted-sphere Twizzle notation (`A` = innermost cap, `a` = wide full circle, `2A` = outer annulus slice), next-unblocked alignment (`A>`, `A<`), whole-puzzle symmetry rotations (`z`, `z'`), and mirror flips (`x` top↔bottom, `y` left↔right) that keep spatial labels `A..W` fixed on screen so one macro handles both chiralities via `[x: m]` / `[y: m]`.
  - Commutators `[X, Y]`, conjugates `[X: Y]`, grouping & repeats `(X)3`, algebraic inverses `(...)'`, and line comments (`//`, `#`).
  - Stops immediately before a blocked move, underlines the offending token in the editor, and highlights the target circle and every straddling piece on the canvas.
  - Supports **discovered grips** (`discovered: true`, e.g. OctoCrystal's emergent internal grips `I–P`) that stay hidden while blocked and appear automatically in amber-gold whenever pieces align to unlock them.
- **Explore & Solve Modes**: Switch between **Explore** (start solved, build & analyze sequences) and **Solve** (deterministic seeded scrambles up to 1,000 moves, **Solve Stack** milestone checkpoints, timer, move counter, Undo, and a toggleable **👁 Solved** reference overlay).
- **Group-Theory Fast-Forward & Order Analyzer**: Detects shape-preserving permutations (jumping huge repeats in $O(n)$ via cycle powers with exact `BigInt` prime-factor order reduction) and state-hash cycles, plus one-click **Analyze Order** for any algorithm, selection, or macro.
- **Macro Library (`List | Text`), Named Piece-Type Hover Previews & URL Sharing**: Define and share entire puzzle macro toolkits as plain-text macro sheets (`name = expr`, `// === Section ===`, `// @hide`/`// @show` for helpers, `// @focus big_pent, kite` for hover filters, and trailing notes) shared across both Explore and Solve modes. Hover any macro (or `Inv '`) for live piece-cycle arrows and directional rotation-in-place angle badges (`↻ 72°`, shown for every slot of an oriented piece type), click `🎯` to toggle focused piece shapes (`Alt`-hover peeks at all), copy/paste macro sheets directly in **Text** view, and share puzzles + algorithms + macros via live URL hashes (`#p=...`).
- **Declarative `ringtwist/v1` Format & Puzzle JSON Studio**: Design new 2D circle puzzles or inspect/fork any built-in puzzle directly in the browser via **Choose a Puzzle → `+ Custom JSON`** (or `{ }` on any card) with live validation, starter templates, SVG preview, `localStorage` persistence, and shareable URLs. See [`docs/PUZZLE_FORMAT.md`](docs/PUZZLE_FORMAT.md).
- **Twizzle-Style Continuous Scrubbing & Mouse Input**: Drag the timeline scrubber smoothly through turns (stays parked mid-turn on release; Play and Step smoothly continue or rewind from any angle), logarithmic `0.25×–4.0×` speed control, cursor-synced preview, and click/scroll input with automatic move coalescing and cancellation (`B` + `B'` cancels, `B` + `B` → `B2`).

---

## Included Puzzles (41 Built-In)

### Geranium Family
| Puzzle | Circles | Pieces | Stops |
| --- | :---: | :---: | --- |
| **Geranium Plus** | 5 | 86 | 36° (10 stops) |
| **Geranium (Standard)** | 5 | 71 | Uneven `(36°, 72°, ...)` |
| **Super Geranium Plus** | 10 | 196 | Inner 36° / Outer uneven |
| **Super Geranium** | 10 | 156 | Uneven `(36°, 72°, ...)` |
| **Pocket Geranium** | 3 (in a line) | 60 | Uneven `(108°, 36°, ...)` |
| **Mini Geranium Plus** | 2 | 56 | Uneven `(108°, 36°, ...)` |
| **Mini Geranium** | 2 | 46 | Uneven `(108°, 36°, ...)` |

### Designer & Exotic
| Puzzle | Circles | Pieces | Stops |
| --- | :---: | :---: | --- |
| **ThinkFun Moonspinner** | 2 (1 inner + 1 exterior) | 27 | 180° lens / 72° exterior (`turnRegion: 'outside'`) |
| **Crazy Lekki** | 2 (1× 2-layer + 1) | 43 | 120° (`A`/`2A`/`a`) / 90° (`B`, bandages `2A`) |
| **Crazy Lotica** | 2 (1× 2-layer + 1) | 24 | 90° (`A`/`2A`/`a`) / 180° (`B`) |
| **Lotica (Turn’Push)** | 2 | 13 | 90° / 180° (`⟨U, R²⟩` group) |
| **Trilotica** | 2 | 11 | 120° / 180° |
| **GigaHex** | 2 (2-layer) | 105 | 60° (`A`/`2A`/`a`, `B`/`2B`/`b`) |
| **GigaHex Plus** | 3 (2-layer) | 139 | 60° (7-color RGB/CMY/White Venn) |
| **Cube4you OctoCrystal** | 8 (+8 discovered) | 64 | 45° (8 rainbow arms, 135° jumbling, emergent grips `I–P`) |
| **Cube4you 2D – XO (Galen Ivanov’s Eight)** | 2 | 33 | 90° / 180° |
| **Cube4you UFO 2D (10 Stars)** | 10 | 100 | Uneven `(36°, 108°, ...)` |
| **Roto 36** | 4 (3 outer + 1 central) | 58 | 60° outer / 120° central transfer ring |
| **Roto 44** | 5 (4 corner + 1 central) | 73 | 90° |
| **Gripple** | 5 (4 corner + 1 central) | 21 | 90° (16 movable pieces + 5 hubs) |
| **Bicycle Puzzler** | 2 (unequal) | 51 | 90° large / 45° small |
| **Rotascope** | 3 | 13 | 60° (heavily bandaged, 502 shape configs) |
| **Rashkey** | 2 | 33 | 90° (Rashkey 3 colorway) |
| **Turnstile (Twinspin)** | 2 | 23 | 60° (3-piece overlap lens) |
| **Bauhinium** | 2 | 28 | 180° / 72° |
| **Bauhinium Plus** | 3 | 34 | 72° / 180° / 72° |
| **Pocket Quatrium** | 2 | 35 | 90° |
| **Pocket Quatrium Plus** | 3 | 49 | 90° |
| **Starcopter (Fomalhaut)** | 2 | 90 | 72° |
| **Curvystar (Mimosa)** | 2 | 73 | 72° / 180° |
| **Cohan Circle / Arusloky (Venn)** | 2 | 29 | 60° (3-color Venn) |
| **Arecibo** | 2 | 69 | 120° |
| **Eliac** | 2 | 59 | 90° / 180° |
| **Fragmentation Ring** | 2 | 45 | 72° (jumbling) |

### Classic Circles
| Puzzle | Circles | Pieces | Stops |
| --- | :---: | :---: | --- |
| **2-Circle Venn (Mandorla)** | 2 | 21 | 120° (3 stops) |
| **Twin Rings** | 2 | 69 | 90° (4 stops + inner rings) |
| **3-Circle Clover** | 3 | 37 | 60° (6 stops) |
| **4-Circle Clover** | 4 | 16 | 90° (4 stops) |
| **6-Circle Hex Flower** | 6 | 66 | 60° (6 stops) |
| **7-Circle Flower** | 7 (1 center + 6 outer) | 66 | 60° (6 stops) |
| **3×3 Circle Grid (Whirligig)** | 9 (3×3 lattice) | 33 | 90° (4 stops) |

---

## Notation Quick Reference

```text
// Algorithm box — moves, macro calls, and comments:
[z: conj]               // Conjugate saved macro by 1 whole-puzzle rotation CW (72° on Geranium)
[A3, E3]2               // Commutator repeated twice: (A3 E3 A3' E3')2
(A> D3 A')'             // Next-unblocked move (>) and algebraic inverse (')

// Macro Library → Text view — shareable plain-text macro sheet:
// === Core Generators ===
// @hide
g4 = [A3, C3']
// @show
// === Phase 3: Big Pentagons ===
// @focus big_pent
big3 = g4               // 4t: fast BigPent(3)
```

- `A`, `B`, `C`, … — Turn the circle (or innermost cap on multi-layer puzzles) **1 stop clockwise** (`A2` = 2 stops, `A'` = 1 stop CCW).
- `a`, `2A` — On concentric multi-layer circles, lowercase `a` is a **wide** turn (inner + outer layers together) and `2A` turns only the **outer annulus slice**.
- `A>`, `A<` — Turn CW (`>`) or CCW (`<`) to the **next stop where an overlapping neighbor becomes unblocked**.
- `z`, `z'` — Rotate the entire puzzle by 1 symmetry step CW/CCW (spatial labels stay fixed).
- `x`, `y` — Flip the entire puzzle 180° across the horizontal (`x`, top↔bottom) or vertical (`y`, left↔right) mirror axis on mirror-symmetric puzzles (use `[x: m]` / `[y: m]` to apply one macro to both chiralities).
- `[X, Y]` = `X Y X' Y'` (commutator); `[X: Y]` = `X Y X'` (conjugate).

---

## Development

```bash
npm install
npm run dev      # Start local Vite dev server (http://localhost:5173/)
npm test         # Run geometry, catalog, notation, and coalescing tests (Vitest)
npm run build    # Type-check and build static bundle into dist/
```

## Deploying to GitHub Pages

A GitHub Actions workflow is included at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

1. Create the repository on GitHub and push `main`:
   ```bash
   git remote add origin git@github.com:JoshMermel/ringtwist.git
   git push -u origin main
   ```
2. In your repository **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Every push to `main` automatically runs tests, builds `./dist` (with relative `./` asset paths), and publishes to `https://joshmermelstein.com/ringtwist/`.

---

## Architecture & Adding Puzzles

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for module responsibilities and core invariants, and [`docs/PUZZLE_FORMAT.md`](docs/PUZZLE_FORMAT.md) for the `ringtwist/v1` declarative JSON puzzle format.

- `src/geom/` — Analytical circular-arc geometry (`math.ts`, `arcRegion.ts`) and DCEL planar circle slicer (`slicer.ts`).
- `src/puzzle/` — Non-doctrinaire move/blocking engine (`engine.ts`), `ringtwist/v1` format schema/compiler/definitions (`format.ts`, `formatBuilder.ts`, `definitions.ts`), legacy `GeraniumsPot` script runner (`geraniumsPotScript.ts`, `geraniumBuilder.ts`), and catalog (`catalog.ts`).
- `src/lang/` — Recursive-descent algorithm parser (`parser.ts`), AST (`ast.ts`), and non-doctrinaire evaluator with group-theory fast-forward (`evaluator.ts`).
- `src/ui/` — Animated SVG renderer & static thumbnails (`svgRenderer.ts`), syntax-highlighted editor (`editor.ts`), visual puzzle picker (`puzzlePicker.ts`), live Puzzle JSON Studio (`customPuzzleModal.ts`), interactive move coalescing (`moveCoalesce.ts`), help modal (`helpModal.ts`), and `localStorage`/URL-hash storage (`storage.ts`).

---

## Acknowledgments

- **[Twizzle](https://alpha.twizzle.net/)** for pioneering clean web-based twisty puzzle notation and playback UX.
- **[VeryPuzzle](https://www.verypuzzle.com/)** for designing the physical Geranium, Geranium Plus, Super Geranium, Pocket Geranium, and Mini Geranium puzzles.
- **[GeraniumsPot](https://github.com/grigorusha/GeraniumsPot/)** and **[twisty-puzzles-2d](https://github.com/gloomyswan/twisty-puzzles-2d)** for the `.txt` puzzle construction scripts and geometric reference.

## License

MIT © 2026 Josh Mermelstein — see [`LICENSE`](LICENSE).
