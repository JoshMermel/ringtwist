import { buildPuzzle } from '../puzzle/builder.ts';
import { CUSTOM_PUZZLE_TEMPLATES } from '../puzzle/definitions.ts';
import { getAllCircleStatuses, getSupportedMirrorAxes } from '../puzzle/engine.ts';
import { RingTwistPuzzleDoc, validateRingTwistDoc } from '../puzzle/format.ts';
import { compileRingTwistDoc } from '../puzzle/formatBuilder.ts';
import { renderStaticPuzzleSvg } from './svgRenderer.ts';

export interface CustomPuzzleModalOptions {
  isBuiltInId: (id: string) => boolean;
  onSave: (doc: RingTwistPuzzleDoc) => void;
  onToast: (msg: string) => void;
}

export interface CustomPuzzleModalController {
  open: (initialDoc?: RingTwistPuzzleDoc, readOnlyHint?: string) => void;
  close: () => void;
}

export function createCustomPuzzleModal(
  options: CustomPuzzleModalOptions,
): CustomPuzzleModalController {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'custom-puzzle-modal';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'studio-modal-title');

  backdrop.innerHTML = `
    <div class="modal studio-modal">
      <div class="modal-header">
        <div>
          <h2 id="studio-modal-title">Puzzle JSON Studio <span class="studio-badge">ringtwist/v1</span></h2>
          <div class="bp-subtitle" id="studio-subtitle">Design, inspect, or fork any 2D circle puzzle declaratively in JSON</div>
        </div>
        <button class="btn btn-sm" id="studio-close" aria-label="Close JSON studio">✕ Close</button>
      </div>
      <div class="studio-templates" id="studio-templates"></div>
      <div class="studio-grid">
        <div class="studio-editor-col">
          <textarea class="studio-textarea" id="studio-textarea" spellcheck="false" autocomplete="off"></textarea>
          <div class="studio-status" id="studio-status"></div>
          <div class="studio-actions">
            <button type="button" class="btn btn-sm" id="studio-btn-preview">Preview</button>
            <button type="button" class="btn btn-sm" id="studio-btn-copy">Copy JSON</button>
            <button type="button" class="btn btn-primary btn-sm" id="studio-btn-load">Load &amp; Save Puzzle</button>
          </div>
        </div>
        <div class="studio-preview-col">
          <div class="studio-preview-stage" id="studio-preview-stage"></div>
          <div class="studio-preview-meta" id="studio-preview-meta"></div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const subtitleEl = backdrop.querySelector<HTMLElement>('#studio-subtitle')!;
  const templatesEl = backdrop.querySelector<HTMLElement>('#studio-templates')!;
  const textareaEl = backdrop.querySelector<HTMLTextAreaElement>('#studio-textarea')!;
  const statusEl = backdrop.querySelector<HTMLElement>('#studio-status')!;
  const previewStageEl = backdrop.querySelector<HTMLElement>('#studio-preview-stage')!;
  const previewMetaEl = backdrop.querySelector<HTMLElement>('#studio-preview-meta')!;
  const loadBtn = backdrop.querySelector<HTMLButtonElement>('#studio-btn-load')!;
  const closeBtn = backdrop.querySelector<HTMLButtonElement>('#studio-close')!;

  let lastValidDoc: RingTwistPuzzleDoc | null = null;
  let debounceId: number | null = null;

  const renderTemplates = () => {
    templatesEl.innerHTML = '<span class="samples-label">Templates:</span>';
    for (const tpl of CUSTOM_PUZZLE_TEMPLATES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sample-chip';
      btn.textContent = tpl.label;
      btn.addEventListener('click', () => {
        textareaEl.value = JSON.stringify(tpl.doc, null, 2);
        runPreview();
      });
      templatesEl.appendChild(btn);
    }
  };
  renderTemplates();

  const runPreview = (): RingTwistPuzzleDoc | null => {
    lastValidDoc = null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(textareaEl.value);
    } catch (err) {
      statusEl.className = 'studio-status error';
      statusEl.textContent = `JSON syntax error: ${err instanceof Error ? err.message : String(err)}`;
      loadBtn.disabled = true;
      return null;
    }

    const check = validateRingTwistDoc(parsed);
    if (!check.ok) {
      statusEl.className = 'studio-status error';
      statusEl.textContent = check.errors.join(' · ');
      loadBtn.disabled = true;
      return null;
    }

    try {
      const spec = compileRingTwistDoc(check.doc);
      const state = buildPuzzle(spec);
      const statuses = getAllCircleStatuses(state);
      const blocked = spec.circles.filter((c) => statuses[c.id]?.blocked).map((c) => c.id);
      const mirrorAxes = getSupportedMirrorAxes(state);

      previewStageEl.innerHTML = '';
      previewStageEl.appendChild(
        renderStaticPuzzleSvg(state, { showLabels: true, compact: false, className: 'studio-svg' }),
      );

      const mirrorText = mirrorAxes.length > 0 ? `mirror: ${mirrorAxes.join(', ')}` : 'chiral';
      const symText = spec.symmetryStepDeg > 0 ? `z: ${spec.symmetryStepDeg}°` : 'no z-sym';
      previewMetaEl.textContent = `${spec.circles.length} axes · ${state.pieces.length} pieces · ${symText} · ${mirrorText}`;

      if (blocked.length > 0) {
        statusEl.className = 'studio-status warn';
        statusEl.textContent = `Built ${state.pieces.length} pieces, but axis ${blocked.join(', ')} has straddling pieces at solved (add a closure cut op).`;
      } else {
        statusEl.className = 'studio-status ok';
        statusEl.textContent = `✓ Valid ringtwist/v1 puzzle (${state.pieces.length} pieces, 0 straddlers)`;
      }

      lastValidDoc = check.doc;
      loadBtn.disabled = false;
      return check.doc;
    } catch (err) {
      statusEl.className = 'studio-status error';
      statusEl.textContent = `Build error: ${err instanceof Error ? err.message : String(err)}`;
      loadBtn.disabled = true;
      return null;
    }
  };

  textareaEl.addEventListener('input', () => {
    if (debounceId !== null) clearTimeout(debounceId);
    debounceId = window.setTimeout(() => {
      debounceId = null;
      runPreview();
    }, 280);
  });

  backdrop.querySelector('#studio-btn-preview')!.addEventListener('click', () => {
    runPreview();
  });

  backdrop.querySelector('#studio-btn-copy')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(textareaEl.value);
      options.onToast('Copied RingTwist JSON to clipboard');
    } catch {
      options.onToast('Could not copy automatically — select and copy from the editor');
    }
  });

  loadBtn.addEventListener('click', () => {
    const doc = lastValidDoc ?? runPreview();
    if (!doc) return;
    // If the user edited a built-in puzzle without changing its ID, auto-fork the ID so built-ins aren't shadowed
    const finalDoc: RingTwistPuzzleDoc = options.isBuiltInId(doc.id)
      ? {
          ...doc,
          id: `${doc.id}-custom`,
          name: doc.name.endsWith('(Custom)') ? doc.name : `${doc.name} (Custom)`,
          category: 'Custom',
        }
      : { ...doc, category: 'Custom' };
    close();
    options.onSave(finalDoc);
  });

  const open = (initialDoc?: RingTwistPuzzleDoc, hint?: string) => {
    const doc = initialDoc ?? CUSTOM_PUZZLE_TEMPLATES[0].doc;
    subtitleEl.textContent =
      hint ?? 'Design, inspect, or fork any 2D circle puzzle declaratively in JSON';
    textareaEl.value = JSON.stringify(doc, null, 2);
    backdrop.classList.add('open');
    runPreview();
    textareaEl.focus();
  };

  const close = () => {
    if (debounceId !== null) {
      clearTimeout(debounceId);
      debounceId = null;
    }
    backdrop.classList.remove('open');
  };

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) close();
  });

  return { open, close };
}
