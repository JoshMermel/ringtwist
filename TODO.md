# RingTwist TODO

## Puzzle Catalog Research
- [ ] Browse the Twisty Puzzles Museum **2D Circle Puzzles** catalog ([mechanism=221](https://twistypuzzles.com/app/museum/museum_search.php?function=show_puzzles&disp_style=standard&numpuzzles=20&page=1&mechanism=221)) and shortlist common & rare puzzles worth adding to RingTwist in `ringtwist/v1`:
  - Check interesting mechanical archetypes we don't cover yet (e.g. non-circular outer frames, gear/coupled rings, hidden/internal bandaging, asymmetric multi-layer rings, sliding/transferring center caps, multi-color variants).
  - Gather reference photos, stop angles, and cut/bandaging behavior for each chosen puzzle.
  - Prototype new puzzles directly in the **Puzzle JSON Studio (`ringtwist/v1`)** and promote favorites into [`src/puzzle/definitions.ts`](src/puzzle/definitions.ts).

## Interactive Solving Experience (Goal #3)
- [ ] Design & implement opaque `Scramble(seed, count)` (and/or `setup` blocks) so solves start cleanly from a scrambled state without cluttering the move script or spoiling the scramble.
- [ ] Evaluate solve-focused UX upgrades (e.g. auto-save in-progress solve per puzzle, solve timer / move counter excluding scramble, Undo / Redo hotkeys, bookmarkable checkpoints, and a dedicated "Solve Mode" vs "Explorer Mode" toggle).
