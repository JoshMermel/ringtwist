# RingTwist TODO

## Puzzle Catalog Research
- [ ] Browse the Twisty Puzzles Museum **2D Circle Puzzles** catalog ([mechanism=221](https://twistypuzzles.com/app/museum/museum_search.php?function=show_puzzles&disp_style=standard&numpuzzles=20&page=1&mechanism=221)) and shortlist common & rare puzzles worth adding to RingTwist in `ringtwist/v1`:
  - Check interesting mechanical archetypes we don't cover yet (e.g. non-circular outer frames, gear/coupled rings, hidden/internal bandaging, asymmetric multi-layer rings, sliding/transferring center caps, multi-color variants).
  - Gather reference photos, stop angles, and cut/bandaging behavior for each chosen puzzle.
  - Prototype new puzzles directly in the **Puzzle JSON Studio (`ringtwist/v1`)** and promote favorites into [`src/puzzle/definitions.ts`](src/puzzle/definitions.ts).

## Interactive Solving Experience (Goal #3)
- [x] Separate opaque Scramble Seed & Move Count bar (shared cleanly via `#p=...&s=...&n=...` without cluttering or spoiling the transcript).
- [x] Solve Mode vs Explorer Mode toggle, auto-save session per puzzle (`localStorage`), solve timer, move counter, Undo button, `// @milestone` checkpoints with jump/revert, and solve completion banner.
- [x] Multi-layer outer-ring wide default (`a`, with `Alt+Click`/`Alt+Scroll` for outer slice `2A`) and live macro hover piece-cycle arrows.
