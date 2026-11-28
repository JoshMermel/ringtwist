export function createHelpModal(): { open: () => void; close: () => void } {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="help-modal-title">
      <div class="modal-header">
        <h2 id="help-modal-title">Quick Reference</h2>
        <button class="btn btn-sm" id="help-close-btn">Close (Esc)</button>
      </div>
      <div class="modal-body">
        <h3>Notation</h3>
        <table class="help-table">
          <tr><td>A, A2, A'</td><td>Turn circle <b>A</b> CW / 2 stops / CCW.</td></tr>
          <tr><td>A&gt;, A&lt;</td><td>Turn to next stop that unblocks a neighbor (<code>A&gt;2</code> for 2nd).</td></tr>
          <tr><td>A, a, 2A</td><td>Multi-layer circles: inner cap / wide (both) / outer slice only.</td></tr>
          <tr><td>z, z' / x, y</td><td>Whole-puzzle rotation / mirror flip (labels stay fixed on screen).</td></tr>
          <tr><td>(X)2, (X)'</td><td>Repeat sequence / algebraic inverse.</td></tr>
          <tr><td>[X, Y] / [X: Y]</td><td>Commutator (<code>X Y X' Y'</code>) / Conjugate (<code>X Y X'</code>).</td></tr>
          <tr><td>//, #</td><td>Line comments.</td></tr>
        </table>

        <h3>Controls &amp; Shortcuts</h3>
        <table class="help-table">
          <tr><td>Click / Scroll</td><td>Turn circle CW; <b>Shift+Click</b> or right-click for CCW.</td></tr>
          <tr><td>Alt+Click / Scroll</td><td>Outer ring on multi-layer puzzles: turn slice <code>2A</code> (default is wide <code>a</code>).</td></tr>
          <tr><td>Scrubber</td><td>Drag smoothly mid-turn (stays parked on release); <code>Alt + ← / → / Space</code> to step/play.</td></tr>
          <tr><td>Hover macro / 🎯</td><td>Preview live piece-cycle arrows &amp; spins; click <code>🎯</code> to filter by piece type (hold <code>Alt</code> to peek all).</td></tr>
        </table>

        <h3>Macro Library &amp; Sharing</h3>
        <table class="help-table">
          <tr><td>List / Text</td><td>Switch Macro Library to <b>Text</b> to edit, copy, or paste a whole macro sheet (supports <code>// === Section ===</code>, section &amp; macro comments, <code>// @hide</code> / <code>// @show</code>, and <code>// @focus</code>).</td></tr>
          <tr><td>Scramble &amp; Share</td><td>Use <b>Scramble</b> for deterministic seeded scrambles (1–1000 moves); <b>Share</b> copies a URL containing puzzle, scramble, algorithm, and macros.</td></tr>
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
