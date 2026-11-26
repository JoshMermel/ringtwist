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
  - Commutators `[X, Y]`, conjugates `[X: Y]`, grouping & repeats `(X)3`, algebraic inverses `(...)'`, inline macros `name = expr`, and line comments (`//`, `#`).
  - Stops immediately before a blocked move, underlines the offending token in the editor, and highlights the target circle and every straddling piece on the canvas.
- **Group-Theory Fast-Forward & Order Analyzer**: Detects shape-preserving permutations (jumping huge repeats in $O(n)$ via cycle powers with exact `BigInt` prime-factor order reduction) and state-hash cycles, plus one-click **Analyze Order** for any algorithm, selection, or macro.
- **Macro Library & URL Sharing**: Save reusable macros per puzzle (`localStorage`), import/export JSON, and share puzzles + algorithms + macros via live URL hashes (`#p=...`).
- **Seeded Scrambles & Solved Reference**: Deterministic seeded scramble generator (numeric or word seeds) and a toggleable **👁 Solved** reference overlay.
- **Playback & Auxiliary Mouse Input**: Scrubber, step/play/pause, logarithmic `0.25×–4.0×` speed control, cursor-synced preview, and optional click/trackpad-smoothed wheel input with automatic move coalescing and cancellation (`B` + `B'` cancels, `B` + `B` → `B2`).

---

## Included Puzzles

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
| **GigaHex** | 2 (2-layer) | 105 | 60° (`A`/`2A`/`a`, `B`/`2B`/`b`) |
| **GigaHex Plus** | 3 (2-layer) | 139 | 60° (7-color RGB/CMY/White Venn) |
| **Cube4you OctoCrystal** | 8 | 64 | 45° (8 rainbow arms, 135° jumbling) |
| **Cube4you 2D – XO** | 2 | 33 | 90° / 180° |
| **Cube4you UFO 2D (10 Stars)** | 10 | 100 | Uneven `(36°, 108°, ...)` |
| **Bauhinium** | 2 | 25 | 180° / 72° |
| **Bauhinium Plus** | 3 | 28 | 72° / 180° / 72° |
| **Pocket Quatrium** | 2 | 34 | 90° |
| **Pocket Quatrium Plus** | 3 | 49 | 90° |
| **Starcopter (Fomalhaut)** | 2 | 90 | 72° |
| **Curvystar (Mimosa)** | 2 | 71 | 72° / 180° |
| **Cohan Circle / Arusloky (Venn)** | 2 | 28 | 60° (3-color Venn) |
| **Arecibo** | 2 | 67 | 120° |
| **Eliac** | 2 | 55 | 90° / 180° |
| **Fragmentation Ring** | 2 | 45 | 72° (jumbling) |

### Classic Circles
| Puzzle | Circles | Pieces | Stops |
| --- | :---: | :---: | --- |
| **2-Circle Venn (Mandorla)** | 2 | 21 | 120° (3 stops) |
| **Twin Rings** | 2 | 67 | 90° (4 stops + inner rings) |
| **3-Circle Clover** | 3 | 31 | 60° (6 stops) |
| **4-Circle Clover** | 4 | 16 | 90° (4 stops) |
| **6-Circle Hex Flower** | 6 | 66 | 60° (6 stops) |
| **7-Circle Flower** | 7 (1 center + 6 outer) | 66 | 60° (6 stops) |

---

## Notation Quick Reference

```text
// Comments start with // or #
conj = [A: D3]          // Inline macro: A D3 A'
[z: conj]               // Conjugate by 1 whole-puzzle rotation CW (72° on Geranium)
[A3, E3]2               // Commutator repeated twice: (A3 E3 A3' E3')2
(A> D3 A')'             // Next-unblocked move (>) and algebraic inverse (')
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

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for module responsibilities, core geometric/evaluator invariants, and a step-by-step guide to adding new puzzles.

- `src/geom/` — Analytical circular-arc geometry (`math.ts`, `arcRegion.ts`) and DCEL planar circle slicer (`slicer.ts`).
- `src/puzzle/` — Non-doctrinaire move/blocking engine (`engine.ts`), `GeraniumsPot` script runner (`geraniumsPotScript.ts`), exact puzzle builders (`geraniumBuilder.ts`), and catalog (`catalog.ts`).
- `src/lang/` — Recursive-descent algorithm parser (`parser.ts`), AST (`ast.ts`), and non-doctrinaire evaluator with group-theory fast-forward (`evaluator.ts`).
- `src/ui/` — Animated SVG renderer & static thumbnails (`svgRenderer.ts`), syntax-highlighted editor (`editor.ts`), visual puzzle picker (`puzzlePicker.ts`), interactive move coalescing (`moveCoalesce.ts`), help modal (`helpModal.ts`), and `localStorage`/URL-hash storage (`storage.ts`).

---

## Acknowledgments

- **[Twizzle](https://alpha.twizzle.net/)** for pioneering clean web-based twisty puzzle notation and playback UX.
- **[VeryPuzzle](https://www.verypuzzle.com/)** for designing the physical Geranium, Geranium Plus, Super Geranium, Pocket Geranium, and Mini Geranium puzzles.
- **[GeraniumsPot](https://github.com/grigorusha/GeraniumsPot/)** and **[twisty-puzzles-2d](https://github.com/gloomyswan/twisty-puzzles-2d)** for the `.txt` puzzle construction scripts and geometric reference.

## License

MIT © 2026 Josh Mermelstein — see [`LICENSE`](LICENSE).
