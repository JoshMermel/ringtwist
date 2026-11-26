export function createHelpModal(): { open: () => void; close: () => void } {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="help-modal-title">
      <div class="modal-header">
        <h2 id="help-modal-title">Notation &amp; Controls Guide</h2>
        <button class="btn btn-sm" id="help-close-btn">Close (Esc)</button>
      </div>
      <div class="modal-body">
        <h3>Circle Moves (Fixed Stops)</h3>
        <table class="help-table">
          <tr><td>A, B, C, D, E</td><td>Turn the named circle <b>1 stop clockwise</b> (e.g. 36° on Geranium Plus, 120° on 2-Circle Venn, 90° on Clover/Twin Rings, 60° on Hex).</td></tr>
          <tr><td>A2, A3, A4</td><td>Turn <b>N stops clockwise</b> (e.g. <code>A3</code> = 108° on Geranium Plus).</td></tr>
          <tr><td>A', A2', A3'</td><td>Turn <b>counter-clockwise</b> (prime <code>'</code> inverts direction).</td></tr>
        </table>

        <h3>Next-Unblocked Alignment (&gt; / &lt;)</h3>
        <table class="help-table">
          <tr><td>A&gt;, A&lt;</td><td>Turn circle <code>A</code> clockwise (<code>&gt;</code>) or counter-clockwise (<code>&lt;</code>) to the <b>next stop where at least one overlapping neighboring circle becomes unblocked</b>.</td></tr>
          <tr><td>A&gt;2, A&lt;2</td><td>Advance to the <b>2nd</b> unblocked alignment stop in that direction.</td></tr>
        </table>

        <h3>Multi-Layer Concentric Circles (Twizzle Convention)</h3>
        <table class="help-table">
          <tr><td>A</td><td>On concentric 2-layer puzzles (like GigaHex / Crazy Lekki), turns the <b>innermost disk</b> ("outer" cap of the infinite sphere).</td></tr>
          <tr><td>a, a2, a'</td><td><b>Wide turn</b>: turns the inner disk + outer ring together as one full circle.</td></tr>
          <tr><td>2A, 2A2, 2A'</td><td><b>Slice turn</b>: turns only the outer annulus ring (layer 2 underneath cap <code>A</code>).</td></tr>
        </table>

        <h3>Whole-Puzzle Rotations</h3>
        <table class="help-table">
          <tr><td>z, z', z2</td><td>Rotate the entire puzzle clockwise/CCW by <b>1 symmetry step</b> (matching Twizzle's in-plane <code>z</code> axis: 72° on 5-fold Geranium &amp; Super Geranium, 60° on Hex/Flower, 90° on Clover, 120° on 3-Circle Clover, 180° on 2-Circle Venn &amp; Twin Rings). Spatial labels <code>A, B, C, ...</code> stay fixed on screen, so macros work symmetrically via <code>[z: myMacro]</code>!</td></tr>
        </table>

        <h3>Combinators, Commutators &amp; Conjugates</h3>
        <table class="help-table">
          <tr><td>(A3 E3)2</td><td>Repeat a grouped sequence N times.</td></tr>
          <tr><td>(A3 E3)'</td><td>Algebraic inverse: reverses order and inverts each move (<code>E3' A3'</code>).</td></tr>
          <tr><td>[X, Y]</td><td><b>Commutator</b>: expands to <code>X Y X' Y'</code>. Supports suffixes like <code>[X, Y]2</code> or <code>[X, Y]'</code>.</td></tr>
          <tr><td>[X: Y]</td><td><b>Conjugate</b>: expands to <code>X Y X'</code> (great for setup moves and symmetry: <code>[z: myAlg]</code>).</td></tr>
        </table>

        <h3>Macros &amp; Comments</h3>
        <table class="help-table">
          <tr><td>name = expr</td><td>Define an inline macro right in the editor, then invoke it as <code>name</code>, <code>name'</code>, or <code>name3</code>.</td></tr>
          <tr><td>// or #</td><td>Line comments for annotating phases of a full solve.</td></tr>
          <tr><td>Macro Sidebar</td><td>Save reusable macros per puzzle (persisted in <code>localStorage</code> with JSON export/import &amp; URL sharing).</td></tr>
        </table>

        <h3>Blocking &amp; Group-Theory Fast-Forward</h3>
        <p>
          Circle puzzles are <b>non-doctrinaire</b>: if a piece straddles a circle's boundary, that circle cannot turn.
          Execution stops right before a blocked move, underlines it in red in the editor, and highlights the target
          circle plus every straddling piece on the canvas.
        </p>
        <p>
          For huge repeat counts (e.g. <code>(A3 B3)1000</code>), the evaluator automatically detects
          <b>shape-preserving permutations</b> (jumping in <i>O(n)</i> via permutation cycle powers) or
          <b>state-hash cycles</b> so fast-forwarding is instantaneous. Use <b>Analyze Order</b> to inspect any algorithm's cycle structure.
        </p>

        <h3>Mouse, Reference &amp; Keyboard Shortcuts</h3>
        <table class="help-table">
          <tr><td>Scramble ▾</td><td>Generate a deterministic legal scramble from any word or numeric <b>seed</b> and move count so you can replay or share the exact same scramble.</td></tr>
          <tr><td>👁 Solved</td><td>Toggle a floating <b>Solved Reference</b> preview card in the bottom-right corner of the canvas (click <code>⤢</code> to expand).</td></tr>
          <tr><td>Click circle</td><td>Appends a CW move (or <code>&gt;</code> when "Click uses &gt;/&lt;" is enabled) at the editor cursor. Adjacent turns on the same circle automatically coalesce (<code>B</code> + <code>B</code> → <code>B2</code>) and inverses cancel (<code>B</code> + <code>B'</code>).</td></tr>
          <tr><td>Shift/Right-click</td><td>Appends a CCW move (or <code>&lt;</code>). Mouse wheel over a circle turns CW/CCW too.</td></tr>
          <tr><td>Cursor Sync</td><td>Clicking or moving your cursor inside the algorithm text immediately previews the puzzle at that step.</td></tr>
          <tr><td>Alt + ← / →</td><td>Step backward / forward 1 move. <code>Alt + Space</code> toggles play/pause.</td></tr>
        </table>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const open = () => backdrop.classList.add('open');
  const close = () => backdrop.classList.remove('open');

  backdrop.querySelector('#help-close-btn')?.addEventListener('click', close);
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) close();
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && backdrop.classList.contains('open')) close();
  });

  return { open, close };
}
