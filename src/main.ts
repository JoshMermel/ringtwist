import './style.css';
import { Span } from './lang/ast.ts';
import {
  EvaluationResult,
  MacroLibraryEntry,
  analyzeAlgorithm,
  evaluateProgram,
} from './lang/evaluator.ts';
import { buildPuzzle } from './puzzle/builder.ts';
import { getPuzzleSpec } from './puzzle/catalog.ts';
import {
  MoveResult,
  generateScramble,
  getAllCircleStatuses,
  getCircleStatus,
  isPuzzleSolved,
  rotateWholePuzzle,
  turnCircleBySteps,
  turnCircleNextUnblocked,
} from './puzzle/engine.ts';
import { PuzzleSpec, PuzzleState } from './puzzle/types.ts';
import { AlgorithmEditor } from './ui/editor.ts';
import { createHelpModal } from './ui/helpModal.ts';
import { applyInteractiveMoveToText } from './ui/moveCoalesce.ts';
import { PuzzlePickerController, createPuzzlePickerModal } from './ui/puzzlePicker.ts';
import {
  decodeShareHash,
  encodeShareHash,
  loadMacros,
  saveMacros,
} from './ui/storage.ts';
import {
  PuzzleSvgRenderer,
  RenderHighlight,
  renderStaticPuzzleSvg,
} from './ui/svgRenderer.ts';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class CircleSimApp {
  private puzzleCache = new Map<string, PuzzleState>();
  private currentSpec: PuzzleSpec;
  private solvedState: PuzzleState;
  private macros: MacroLibraryEntry[] = [];
  private evalResult: EvaluationResult;
  private currentStepIndex = 0; // 0 = initial state, k = after steps[k-1]
  private isPlaying = false;
  private playTimerId: number | null = null;
  private evalDebounceId: number | null = null;
  private cursorSyncEnabled = true;
  private clickUsesNextUnblocked = false;
  private speedMultiplier = 1.0;
  private solvedPeekVisible = false;
  private solvedPeekExpanded = false;

  // UI elements
  private renderer!: PuzzleSvgRenderer;
  private editor!: AlgorithmEditor;
  private helpModal!: { open: () => void; close: () => void };
  private puzzlePicker!: PuzzlePickerController;
  private puzzleBtnEl!: HTMLButtonElement;
  private rotCwBtnEl!: HTMLButtonElement;
  private rotCcwBtnEl!: HTMLButtonElement;
  private solvedPeekBtnEl!: HTMLButtonElement;
  private solvedRefCardEl!: HTMLElement;
  private solvedRefStageEl!: HTMLElement;
  private scramblePopoverEl!: HTMLElement;
  private scrambleSeedInput!: HTMLInputElement;
  private scrambleMovesInput!: HTMLInputElement;
  private statusPillsEl!: HTMLElement;
  private circleChipsEl!: HTMLElement;
  private diagBannerEl!: HTMLElement;
  private analysisBannerEl!: HTMLElement;
  private scrubberEl!: HTMLInputElement;
  private stepCounterEl!: HTMLElement;
  private playBtnEl!: HTMLButtonElement;
  private samplesRowEl!: HTMLElement;
  private macroListEl!: HTMLElement;
  private macroNameInput!: HTMLInputElement;
  private macroBodyInput!: HTMLInputElement;
  private toastEl!: HTMLElement;
  private toastTimer: number | null = null;

  constructor(root: HTMLElement) {
    const shared = decodeShareHash(window.location.hash);
    const initialSpec = getPuzzleSpec(shared?.puzzleId ?? 'geranium-plus');
    this.currentSpec = initialSpec;
    this.solvedState = this.getOrBuildPuzzle(initialSpec);
    this.macros = shared?.macros ?? loadMacros(initialSpec.id);
    this.evalResult = evaluateProgram(this.solvedState, '', this.macros);

    this.mountDOM(root);
    this.helpModal = createHelpModal();
    this.puzzlePicker = createPuzzlePickerModal({
      getOrBuildPuzzle: (spec) => this.getOrBuildPuzzle(spec),
      getCurrentPuzzleId: () => this.currentSpec.id,
      onSelect: (puzzleId) => this.switchPuzzle(puzzleId),
    });

    const initialAlg = shared?.alg ?? '';
    this.editor.setValue(initialAlg);
    this.syncPuzzleButton();
    this.syncSolvedRefCard();
    this.renderSamples();
    this.renderMacroList();
    this.reevaluate(true);
    this.bindGlobalShortcuts();
  }

  private getOrBuildPuzzle(spec: PuzzleSpec): PuzzleState {
    let cached = this.puzzleCache.get(spec.id);
    if (!cached) {
      cached = buildPuzzle(spec);
      this.puzzleCache.set(spec.id, cached);
    }
    return cached;
  }

  private mountDOM(root: HTMLElement): void {
    root.innerHTML = `
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark"></div>
          <div>
            <h1>CircleSim</h1>
            <div class="subtitle">Text-first 2D twisty circle puzzle simulator</div>
          </div>
        </div>
        <div class="topbar-controls">
          <button type="button" class="book-btn" id="puzzle-picker-btn" title="Choose a puzzle">
            <span class="book-btn-dot"></span>
            <span class="book-btn-name" id="puzzle-picker-name"></span>
            <span class="book-btn-meta" id="puzzle-picker-meta"></span>
          </button>
          <div class="scramble-wrap">
            <button type="button" class="btn" id="btn-scramble" aria-haspopup="true" aria-expanded="false" title="Generate a repeatable seeded scramble">Scramble ▾</button>
            <form class="scramble-popover" id="scramble-popover" hidden>
              <div class="sp-title">Seeded Scramble</div>
              <div class="sp-row">
                <label for="scramble-seed">Seed</label>
                <div class="sp-seed-group">
                  <input type="text" id="scramble-seed" autocomplete="off" spellcheck="false" placeholder="any word or number" />
                  <button type="button" class="btn btn-sm" id="btn-rand-seed" title="Roll a random seed">🎲</button>
                </div>
              </div>
              <div class="sp-row">
                <label for="scramble-moves">Moves</label>
                <input type="number" id="scramble-moves" min="4" max="60" value="20" />
              </div>
              <div class="sp-actions">
                <button type="submit" class="btn btn-primary btn-sm">Generate Scramble</button>
              </div>
            </form>
          </div>
          <button class="btn" id="btn-reset" title="Clear sequence and reset to solved">Reset</button>
          <button class="btn" id="btn-share" title="Copy shareable link with puzzle, moves, and macros">Share</button>
          <button class="btn btn-primary" id="btn-help" title="Notation and controls guide">? Help</button>
        </div>
      </header>

      <main class="workspace">
        <section class="card puzzle-pane">
          <div class="status-strip">
            <div class="status-pills" id="status-pills"></div>
            <div class="circle-chips" id="circle-chips" title="Click a free circle chip to append a CW turn (Shift-click for CCW)"></div>
          </div>

          <div class="diagnostic-banner error" id="diag-banner"></div>
          <div class="diagnostic-banner analysis" id="analysis-banner"></div>

          <div class="stage-wrap" id="stage-wrap">
            <div class="stage-overlay-tl">
              <button class="btn btn-sm" id="btn-rot-ccw" title="Whole-puzzle rotation CCW (r')">↺ r'</button>
              <button class="btn btn-sm" id="btn-rot-cw" title="Whole-puzzle rotation CW (r)">↻ r</button>
            </div>
            <div class="stage-overlay-tr">
              <button type="button" class="btn btn-sm solved-peek-btn" id="btn-solved-peek" title="Toggle a reference preview of the solved puzzle">👁 Solved</button>
              <label class="click-mode-label" title="When checked, clicking a circle inserts A> / A< (next unblocked alignment) instead of 1 stop">
                <input type="checkbox" id="chk-click-next" />
                Click uses &gt;/&lt;
              </label>
            </div>
            <div class="solved-ref-card" id="solved-ref-card" hidden>
              <div class="solved-ref-head">
                <span>Solved Reference</span>
                <div class="solved-ref-btns">
                  <button type="button" class="solved-ref-icon" id="btn-solved-expand" title="Expand / shrink reference">⤢</button>
                  <button type="button" class="solved-ref-icon" id="btn-solved-close" title="Hide solved reference">✕</button>
                </div>
              </div>
              <div class="solved-ref-stage" id="solved-ref-stage"></div>
            </div>
            <div class="stage-hint">Click circle: CW · Shift/Right-click: CCW · Scroll: turn</div>
          </div>

          <div class="playback-bar">
            <div class="playback-row">
              <button class="btn btn-icon" id="btn-start" title="Jump to start">|◀</button>
              <button class="btn btn-icon" id="btn-prev" title="Step back (Alt+←)">◀</button>
              <button class="btn btn-primary btn-icon" id="btn-play" title="Play / Pause (Alt+Space)">▶</button>
              <button class="btn btn-icon" id="btn-next" title="Step forward (Alt+→)">▶</button>
              <button class="btn btn-icon" id="btn-end" title="Fast-forward to end">▶|</button>
              <input type="range" class="scrubber" id="scrubber" min="0" max="0" value="0" aria-label="Move scrubber" />
              <span class="step-counter" id="step-counter">0 / 0</span>
              <div class="speed-wrap">
                <span>Speed</span>
                <input type="range" id="speed-slider" min="-2" max="2" step="0.1" value="0" aria-label="Playback speed" />
                <span class="speed-readout" id="speed-readout">1.0×</span>
              </div>
            </div>
          </div>
        </section>

        <aside class="side-pane">
          <section class="card editor-card">
            <div class="section-header">
              <h2 class="section-title">Algorithm &amp; Script</h2>
              <div class="editor-actions">
                <label class="click-mode-label" title="Moving your text cursor previews the puzzle at that step">
                  <input type="checkbox" id="chk-cursor-sync" checked />
                  Cursor sync
                </label>
                <button class="btn btn-sm" id="btn-analyze" title="Compute exact order and cycle structure from solved state">Analyze Order</button>
                <button class="btn btn-sm" id="btn-save-sel" title="Save selected text (or whole sequence) as a macro">+ Save Macro</button>
              </div>
            </div>

            <div id="editor-mount"></div>

            <div class="samples-row" id="samples-row"></div>
          </section>

          <section class="card macros-card">
            <div class="section-header">
              <h2 class="section-title">Macro Library</h2>
              <div class="editor-actions">
                <button class="btn btn-sm" id="btn-export-macros">Export JSON</button>
                <button class="btn btn-sm" id="btn-import-macros">Import JSON</button>
              </div>
            </div>

            <form class="macro-form" id="macro-form">
              <input type="text" id="macro-name" placeholder="name (tri)" required pattern="[a-zA-Z_][a-zA-Z0-9_]*" />
              <input type="text" id="macro-body" placeholder="moves (e.g. [A3: E3])" required />
              <button type="submit" class="btn btn-primary btn-sm">Save</button>
            </form>

            <div class="macro-list" id="macro-list"></div>
          </section>
        </aside>
      </main>

      <div class="toast" id="toast"></div>
    `;

    this.puzzleBtnEl = root.querySelector('#puzzle-picker-btn')!;
    this.rotCwBtnEl = root.querySelector('#btn-rot-cw')!;
    this.rotCcwBtnEl = root.querySelector('#btn-rot-ccw')!;
    this.solvedPeekBtnEl = root.querySelector('#btn-solved-peek')!;
    this.solvedRefCardEl = root.querySelector('#solved-ref-card')!;
    this.solvedRefStageEl = root.querySelector('#solved-ref-stage')!;
    this.scramblePopoverEl = root.querySelector('#scramble-popover')!;
    this.scrambleSeedInput = root.querySelector('#scramble-seed')!;
    this.scrambleMovesInput = root.querySelector('#scramble-moves')!;
    this.statusPillsEl = root.querySelector('#status-pills')!;
    this.circleChipsEl = root.querySelector('#circle-chips')!;
    this.diagBannerEl = root.querySelector('#diag-banner')!;
    this.analysisBannerEl = root.querySelector('#analysis-banner')!;
    this.scrubberEl = root.querySelector('#scrubber')!;
    this.stepCounterEl = root.querySelector('#step-counter')!;
    this.playBtnEl = root.querySelector('#btn-play')!;
    this.samplesRowEl = root.querySelector('#samples-row')!;
    this.macroListEl = root.querySelector('#macro-list')!;
    this.macroNameInput = root.querySelector('#macro-name')!;
    this.macroBodyInput = root.querySelector('#macro-body')!;
    this.toastEl = root.querySelector('#toast')!;

    // Mount SVG renderer
    const stageWrap = root.querySelector<HTMLElement>('#stage-wrap')!;
    this.renderer = new PuzzleSvgRenderer(stageWrap, {
      onCircleClick: (cid, dir) => this.handleCircleClick(cid, dir),
    });

    // Mount editor
    const editorMount = root.querySelector<HTMLElement>('#editor-mount')!;
    this.editor = new AlgorithmEditor(editorMount, {
      onChange: () => this.scheduleReevaluate(),
      onCursorMove: (pos) => this.handleCursorMove(pos),
    });

    // Wire header controls
    this.puzzleBtnEl.addEventListener('click', () => {
      this.closeScramblePopover();
      this.puzzlePicker.open();
    });

    const rollSeed = () => String(Math.floor(10000 + Math.random() * 90000));
    this.scrambleSeedInput.value = rollSeed();

    const scrambleBtn = root.querySelector<HTMLButtonElement>('#btn-scramble')!;
    const openScramblePopover = () => {
      this.scramblePopoverEl.hidden = false;
      scrambleBtn.setAttribute('aria-expanded', 'true');
      this.scrambleSeedInput.focus();
      this.scrambleSeedInput.select();
    };
    const closeScramblePopover = () => {
      this.scramblePopoverEl.hidden = true;
      scrambleBtn.setAttribute('aria-expanded', 'false');
    };
    this.closeScramblePopover = closeScramblePopover;

    scrambleBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (this.scramblePopoverEl.hidden) openScramblePopover();
      else closeScramblePopover();
    });

    root.querySelector('#btn-rand-seed')!.addEventListener('click', () => {
      this.scrambleSeedInput.value = rollSeed();
      this.scrambleSeedInput.focus();
    });

    this.scramblePopoverEl.addEventListener('submit', (ev) => {
      ev.preventDefault();
      this.stopPlayback();
      const rawSeed = this.scrambleSeedInput.value.trim() || rollSeed();
      this.scrambleSeedInput.value = rawSeed;
      const moveCount = Math.max(
        4,
        Math.min(60, parseInt(this.scrambleMovesInput.value, 10) || 20),
      );
      this.scrambleMovesInput.value = String(moveCount);

      const scramble = generateScramble(this.solvedState, moveCount, rawSeed);
      const script = `// Scramble (seed: ${rawSeed}, ${moveCount} moves)\n${scramble}\n\n// Solve below:\n`;
      this.editor.setValue(script);
      this.reevaluate(true);
      closeScramblePopover();
      this.editor.textarea.focus();
      this.editor.textarea.selectionStart = script.length;
      this.editor.textarea.selectionEnd = script.length;
      this.showToast(`Generated ${moveCount}-move scramble (seed: ${rawSeed})`);
    });

    document.addEventListener('click', (ev) => {
      if (
        !this.scramblePopoverEl.hidden &&
        !this.scramblePopoverEl.contains(ev.target as Node) &&
        ev.target !== scrambleBtn
      ) {
        closeScramblePopover();
      }
    });

    // Solved reference peek controls
    this.solvedPeekBtnEl.addEventListener('click', () => {
      this.setSolvedPeekVisible(!this.solvedPeekVisible);
    });
    root.querySelector('#btn-solved-close')!.addEventListener('click', () => {
      this.setSolvedPeekVisible(false);
    });
    root.querySelector('#btn-solved-expand')!.addEventListener('click', () => {
      this.solvedPeekExpanded = !this.solvedPeekExpanded;
      this.solvedRefCardEl.classList.toggle('expanded', this.solvedPeekExpanded);
    });

    root.querySelector('#btn-reset')!.addEventListener('click', () => {
      this.stopPlayback();
      this.editor.setValue('');
      this.hideAnalysisBanner();
      this.reevaluate(true);
    });

    root.querySelector('#btn-share')!.addEventListener('click', () => {
      this.shareCurrentState();
    });

    root.querySelector('#btn-help')!.addEventListener('click', () => {
      this.helpModal.open();
    });

    // Whole-puzzle rotation quick buttons
    root.querySelector('#btn-rot-cw')!.addEventListener('click', () => {
      this.appendInteractiveMove('r', {
        allowCoalesce: true,
        incrementalMove: (st) => rotateWholePuzzle(st, 1),
      });
    });
    root.querySelector('#btn-rot-ccw')!.addEventListener('click', () => {
      this.appendInteractiveMove("r'", {
        allowCoalesce: true,
        incrementalMove: (st) => rotateWholePuzzle(st, -1),
      });
    });

    // Checkboxes
    root.querySelector<HTMLInputElement>('#chk-click-next')!.addEventListener('change', (ev) => {
      this.clickUsesNextUnblocked = (ev.target as HTMLInputElement).checked;
    });
    root.querySelector<HTMLInputElement>('#chk-cursor-sync')!.addEventListener('change', (ev) => {
      this.cursorSyncEnabled = (ev.target as HTMLInputElement).checked;
    });

    // Playback bar
    root.querySelector('#btn-start')!.addEventListener('click', () => {
      this.stopPlayback();
      this.jumpToStep(0);
    });
    root.querySelector('#btn-prev')!.addEventListener('click', () => {
      this.stopPlayback();
      this.stepBackward();
    });
    this.playBtnEl.addEventListener('click', () => {
      if (this.isPlaying) this.stopPlayback();
      else this.startPlayback();
    });
    root.querySelector('#btn-next')!.addEventListener('click', () => {
      this.stopPlayback();
      this.stepForward();
    });
    root.querySelector('#btn-end')!.addEventListener('click', () => {
      this.stopPlayback();
      this.jumpToStep(this.evalResult.steps.length);
    });
    this.scrubberEl.addEventListener('input', () => {
      this.stopPlayback();
      this.jumpToStep(parseInt(this.scrubberEl.value, 10));
    });
    const speedReadout = root.querySelector<HTMLElement>('#speed-readout')!;
    root.querySelector<HTMLInputElement>('#speed-slider')!.addEventListener('input', (ev) => {
      const exp = parseFloat((ev.target as HTMLInputElement).value);
      this.speedMultiplier = Math.pow(2, exp);
      speedReadout.textContent =
        this.speedMultiplier < 1
          ? `${this.speedMultiplier.toFixed(2)}×`
          : `${this.speedMultiplier.toFixed(1)}×`;
    });

    // Analyze Order button
    root.querySelector('#btn-analyze')!.addEventListener('click', () => {
      const sel = this.editor.getSelection();
      const target = sel.text.trim() || this.editor.getValue().trim();
      if (!target) {
        this.showToast('Type or select an algorithm to analyze');
        return;
      }
      this.runAnalysis(target, this.solvedState, sel.text.trim() ? 'Selection' : 'Algorithm');
    });

    // Save Selection as Macro
    root.querySelector('#btn-save-sel')!.addEventListener('click', () => {
      const sel = this.editor.getSelection();
      const body = sel.text.trim() || this.editor.getValue().trim();
      if (!body) {
        this.showToast('Select or type moves first');
        return;
      }
      this.macroBodyInput.value = body.replace(/\s+/g, ' ');
      this.macroNameInput.focus();
      this.showToast('Filled macro body — enter a name and click Save');
    });

    // Macro form submit
    root.querySelector<HTMLFormElement>('#macro-form')!.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = this.macroNameInput.value.trim();
      const body = this.macroBodyInput.value.trim();
      if (!name || !body) return;

      const reserved = new Set([...this.currentSpec.circles.map((c) => c.id), 'r']);
      if (reserved.has(name)) {
        this.showToast(`"${name}" is a reserved move name`);
        return;
      }

      const existingIdx = this.macros.findIndex((m) => m.name === name);
      if (existingIdx >= 0) {
        this.macros[existingIdx] = { ...this.macros[existingIdx], body };
      } else {
        this.macros.push({ name, body });
      }
      saveMacros(this.currentSpec.id, this.macros);
      this.macroNameInput.value = '';
      this.macroBodyInput.value = '';
      this.renderMacroList();
      this.reevaluate(false);
      this.showToast(`Saved macro "${name}"`);
    });

    // Export / Import macros JSON
    root.querySelector('#btn-export-macros')!.addEventListener('click', () => {
      const json = JSON.stringify(this.macros, null, 2);
      navigator.clipboard?.writeText(json).then(
        () => this.showToast('Copied macro library JSON to clipboard'),
        () => window.prompt('Copy macro library JSON:', json),
      );
    });

    root.querySelector('#btn-import-macros')!.addEventListener('click', () => {
      const raw = window.prompt('Paste macro library JSON array ([{"name":"...","body":"..."}]):');
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('Expected JSON array');
        const valid = parsed.filter(
          (m): m is MacroLibraryEntry =>
            typeof m?.name === 'string' && typeof m?.body === 'string',
        );
        if (valid.length === 0) throw new Error('No valid macros found');
        // Merge by name
        for (const entry of valid) {
          const idx = this.macros.findIndex((m) => m.name === entry.name);
          if (idx >= 0) this.macros[idx] = entry;
          else this.macros.push(entry);
        }
        saveMacros(this.currentSpec.id, this.macros);
        this.renderMacroList();
        this.reevaluate(false);
        this.showToast(`Imported ${valid.length} macro(s)`);
      } catch (err) {
        this.showToast(`Import failed: ${(err as Error).message}`);
      }
    });
  }

  private bindGlobalShortcuts(): void {
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !this.scramblePopoverEl.hidden) {
        this.closeScramblePopover();
        return;
      }
      if (ev.altKey && ev.code === 'ArrowRight') {
        ev.preventDefault();
        this.stopPlayback();
        this.stepForward();
      } else if (ev.altKey && ev.code === 'ArrowLeft') {
        ev.preventDefault();
        this.stopPlayback();
        this.stepBackward();
      } else if (ev.altKey && ev.code === 'Space') {
        ev.preventDefault();
        if (this.isPlaying) this.stopPlayback();
        else this.startPlayback();
      }
    });
  }

  private closeScramblePopover: () => void = () => {};

  private setSolvedPeekVisible(visible: boolean): void {
    this.solvedPeekVisible = visible;
    this.solvedRefCardEl.hidden = !visible;
    this.solvedPeekBtnEl.classList.toggle('active', visible);
    if (visible) {
      this.syncSolvedRefCard();
    }
  }

  private syncSolvedRefCard(): void {
    this.solvedRefStageEl.innerHTML = '';
    const svg = renderStaticPuzzleSvg(this.solvedState, {
      showLabels: true,
      compact: true,
      className: 'solved-ref-svg',
    });
    this.solvedRefStageEl.appendChild(svg);
  }

  private syncPuzzleButton(): void {
    const nameEl = this.puzzleBtnEl.querySelector('#puzzle-picker-name')!;
    const metaEl = this.puzzleBtnEl.querySelector('#puzzle-picker-meta')!;
    nameEl.textContent = this.currentSpec.name;
    metaEl.textContent = `${this.currentSpec.circles.length}c · ${this.solvedState.pieces.length}p`;
    this.puzzleBtnEl.setAttribute(
      'aria-label',
      `Puzzle: ${this.currentSpec.name} (${this.solvedState.pieces.length} pieces). Choose a puzzle`,
    );

    const hasSym = this.currentSpec.symmetryStepDeg > 0;
    this.rotCwBtnEl.disabled = !hasSym;
    this.rotCcwBtnEl.disabled = !hasSym;
    this.rotCwBtnEl.title = hasSym
      ? `Whole-puzzle rotation CW by ${this.currentSpec.symmetryStepDeg}° (r)`
      : `${this.currentSpec.name} has no rotational symmetry`;
    this.rotCcwBtnEl.title = hasSym
      ? `Whole-puzzle rotation CCW by ${this.currentSpec.symmetryStepDeg}° (r')`
      : `${this.currentSpec.name} has no rotational symmetry`;
  }

  private renderSamples(): void {
    this.samplesRowEl.innerHTML = '';
    const samples = this.currentSpec.sampleAlgorithms ?? [];
    if (samples.length === 0) return;

    const lbl = document.createElement('span');
    lbl.className = 'samples-label';
    lbl.textContent = 'Examples:';
    this.samplesRowEl.appendChild(lbl);

    for (const sample of samples) {
      const btn = document.createElement('button');
      btn.className = 'sample-chip';
      btn.textContent = sample.name;
      btn.title = sample.note ?? sample.alg;
      btn.addEventListener('click', () => {
        this.stopPlayback();
        this.hideAnalysisBanner();
        this.editor.setValue(sample.alg);
        this.reevaluate(true);
      });
      this.samplesRowEl.appendChild(btn);
    }
  }

  private renderMacroList(): void {
    this.macroListEl.innerHTML = '';

    const inlineEntries = Object.entries(this.evalResult.inlineMacros);
    if (this.macros.length === 0 && inlineEntries.length === 0) {
      this.macroListEl.innerHTML =
        '<div class="empty-state">No macros yet. Save useful commutators or conjugates here, or define them inline with <code>name = ...</code>.</div>';
      return;
    }

    const addRow = (
      entry: MacroLibraryEntry,
      isInline: boolean,
    ) => {
      const row = document.createElement('div');
      row.className = isInline ? 'macro-item inline' : 'macro-item';
      row.innerHTML = `
        <div class="macro-meta">
          <div class="macro-name-row">
            <span class="macro-name">${escapeHtml(entry.name)}</span>
            ${isInline ? '<span class="macro-badge">inline</span>' : ''}
          </div>
          <div class="macro-body" title="${escapeHtml(entry.body)}">${escapeHtml(entry.body)}</div>
        </div>
        <div class="macro-btns">
          <button class="btn btn-sm" data-act="insert" title="Insert ${escapeHtml(entry.name)} at cursor">Insert</button>
          <button class="btn btn-sm" data-act="inv" title="Insert inverse ${escapeHtml(entry.name)}' at cursor">Inv '</button>
          <button class="btn btn-sm" data-act="order" title="Analyze order from current puzzle state">Order</button>
          ${isInline ? '' : '<button class="btn btn-sm btn-danger" data-act="del" title="Delete macro">×</button>'}
        </div>
      `;

      row.querySelector('[data-act="insert"]')?.addEventListener('click', () => {
        this.appendInteractiveMove(entry.name, { allowCoalesce: false });
      });
      row.querySelector('[data-act="inv"]')?.addEventListener('click', () => {
        this.appendInteractiveMove(`${entry.name}'`, { allowCoalesce: false });
      });
      row.querySelector('[data-act="order"]')?.addEventListener('click', () => {
        const curState = this.getDisplayedState();
        this.runAnalysis(entry.body, curState, `Macro "${entry.name}"`);
      });
      row.querySelector('[data-act="del"]')?.addEventListener('click', () => {
        this.macros = this.macros.filter((m) => m.name !== entry.name);
        saveMacros(this.currentSpec.id, this.macros);
        this.renderMacroList();
        this.reevaluate(false);
      });

      this.macroListEl.appendChild(row);
    };

    for (const m of this.macros) addRow(m, false);
    for (const [name, body] of inlineEntries) {
      if (!this.macros.some((m) => m.name === name)) {
        addRow({ name, body }, true);
      }
    }
  }

  private switchPuzzle(puzzleId: string): void {
    this.stopPlayback();
    this.hideAnalysisBanner();
    this.currentSpec = getPuzzleSpec(puzzleId);
    this.solvedState = this.getOrBuildPuzzle(this.currentSpec);
    this.macros = loadMacros(this.currentSpec.id);
    this.editor.setValue('');
    this.syncPuzzleButton();
    this.syncSolvedRefCard();
    this.renderSamples();
    this.renderMacroList();
    this.reevaluate(true);
  }

  private scheduleReevaluate(): void {
    if (this.evalDebounceId !== null) clearTimeout(this.evalDebounceId);
    this.evalDebounceId = window.setTimeout(() => {
      this.evalDebounceId = null;
      this.reevaluate(true);
    }, 60);
  }

  private reevaluate(jumpToEnd: boolean): void {
    this.stopPlayback();
    const src = this.editor.getValue();
    this.evalResult = evaluateProgram(this.solvedState, src, this.macros, {
      solvedReference: this.solvedState,
    });
    this.renderMacroList();

    const maxStep = this.evalResult.steps.length;
    this.scrubberEl.max = String(maxStep);

    if (jumpToEnd) {
      this.currentStepIndex = maxStep;
    } else {
      this.currentStepIndex = Math.min(this.currentStepIndex, maxStep);
    }
    this.renderCurrentStep();
  }

  private getDisplayedState(): PuzzleState {
    if (this.currentStepIndex <= 0 || this.evalResult.steps.length === 0) {
      return this.evalResult.initialState;
    }
    const idx = Math.min(this.currentStepIndex, this.evalResult.steps.length) - 1;
    return this.evalResult.steps[idx].stateAfter;
  }

  private getHighlightForStep(stepIndex: number): RenderHighlight {
    const blocked = this.evalResult.blocked;
    if (blocked && stepIndex === this.evalResult.steps.length) {
      return {
        blockedCircleId: blocked.circleId,
        blockingPieceIds: blocked.blockingPieceIds,
      };
    }
    return {};
  }

  private renderCurrentStep(): void {
    const state = this.getDisplayedState();
    const highlight = this.getHighlightForStep(this.currentStepIndex);
    const statuses = getAllCircleStatuses(state);

    this.renderer.render(state, highlight, statuses);
    this.updateChrome(state, statuses);
  }

  private updateChrome(
    state: PuzzleState,
    statuses: ReturnType<typeof getAllCircleStatuses>,
  ): void {
    const total = this.evalResult.steps.length;
    this.scrubberEl.value = String(this.currentStepIndex);
    this.stepCounterEl.textContent = `${this.currentStepIndex} / ${total}`;
    this.playBtnEl.textContent = this.isPlaying ? '⏸' : '▶';

    // Status pills
    const pills: string[] = [];
    const solvedNow = isPuzzleSolved(state, this.solvedState);
    if (solvedNow) {
      pills.push('<span class="pill pill-solved">✓ Solved</span>');
    }
    pills.push(`<span class="pill">${state.pieces.length} pieces</span>`);

    if (this.currentStepIndex > 0 && this.currentStepIndex <= total) {
      const st = this.evalResult.steps[this.currentStepIndex - 1];
      const macroTag = st.macroStack.length > 0 ? ` (${st.macroStack.join(' › ')})` : '';
      pills.push(
        `<span class="pill pill-info">Move: ${escapeHtml(st.moveLabel)}${escapeHtml(macroTag)}</span>`,
      );
    }
    if (this.evalResult.usedFastForward) {
      pills.push('<span class="pill pill-info">⚡ Group fast-forward</span>');
    }
    if (this.evalResult.blocked) {
      pills.push(`<span class="pill pill-blocked">⛔ Blocked at ${escapeHtml(this.evalResult.blocked.moveLabel)}</span>`);
    }
    this.statusPillsEl.innerHTML = pills.join('');

    // Circle free/blocked chips
    this.circleChipsEl.innerHTML = '';
    for (const c of this.currentSpec.circles) {
      const st = statuses[c.id];
      const chip = document.createElement('button');
      chip.className = `circle-chip ${st.blocked ? 'blocked' : 'free'}`;
      chip.textContent = `${c.id} ${st.blocked ? '✕' : '✓'}`;
      chip.style.borderLeft = `3px solid ${c.color}`;
      chip.title = st.blocked
        ? `Circle ${c.id} blocked by ${st.blockingPieceIds.length} piece(s)`
        : `Circle ${c.id} free — click for CW, shift-click for CCW`;
      chip.addEventListener('click', (ev) => {
        this.handleCircleClick(c.id, ev.shiftKey ? -1 : 1);
      });
      this.circleChipsEl.appendChild(chip);
    }

    // Diagnostic banner (blocked / parseError / runtimeError)
    const errorSpans: Span[] = [];
    if (this.evalResult.parseErrors.length > 0) {
      const err = this.evalResult.parseErrors[0];
      errorSpans.push(...this.evalResult.parseErrors.map((e) => e.span));
      this.diagBannerEl.className = 'diagnostic-banner error visible';
      this.diagBannerEl.innerHTML = `<span><b>Syntax error:</b> ${escapeHtml(err.message)}</span>`;
    } else if (this.evalResult.runtimeError) {
      errorSpans.push(this.evalResult.runtimeError.span);
      this.diagBannerEl.className = 'diagnostic-banner error visible';
      this.diagBannerEl.innerHTML = `<span><b>Error:</b> ${escapeHtml(this.evalResult.runtimeError.message)}</span>`;
    } else if (this.evalResult.blocked) {
      const b = this.evalResult.blocked;
      errorSpans.push(b.topSpan);
      const via = b.macroStack.length > 0 ? ` inside <code>${escapeHtml(b.macroStack.join(' › '))}</code>` : '';
      this.diagBannerEl.className = 'diagnostic-banner error visible';
      this.diagBannerEl.innerHTML = `
        <span>
          <b>Blocked at step ${b.stepIndex + 1} (<code>${escapeHtml(b.moveLabel)}</code>${via}):</b>
          ${escapeHtml(b.reason)} — straddling pieces highlighted on puzzle.
        </span>
        ${
          this.currentStepIndex !== total
            ? '<button class="btn btn-sm" id="btn-jump-block">Inspect block</button>'
            : ''
        }
      `;
      this.diagBannerEl.querySelector('#btn-jump-block')?.addEventListener('click', () => {
        this.stopPlayback();
        this.jumpToStep(total);
      });
    } else {
      this.diagBannerEl.className = 'diagnostic-banner error';
      this.diagBannerEl.innerHTML = '';
    }

    // Update editor active-move & error highlights
    const activeSpan =
      this.currentStepIndex > 0 && this.currentStepIndex <= total
        ? this.evalResult.steps[this.currentStepIndex - 1].topSpan
        : undefined;
    this.editor.setHighlights({ activeSpan, errorSpans });
  }

  private jumpToStep(stepIdx: number): void {
    const clamped = Math.max(0, Math.min(this.evalResult.steps.length, stepIdx));
    this.currentStepIndex = clamped;
    this.renderCurrentStep();
  }

  private turnDurationMs(angleDeg: number, fastForwarded?: boolean, baseMs = 550): number {
    if (fastForwarded) return 0;
    // Gently scale duration with turn angle so 108°/180° turns feel naturally paced vs 36° turns
    const angleFactor = 0.75 + 0.25 * (Math.min(Math.abs(angleDeg), 180) / 72);
    return Math.round((baseMs * angleFactor) / this.speedMultiplier);
  }

  private stepForward(onDone?: () => void): void {
    const total = this.evalResult.steps.length;
    if (this.currentStepIndex >= total) {
      onDone?.();
      return;
    }
    const fromState = this.getDisplayedState();
    const step = this.evalResult.steps[this.currentStepIndex];
    this.currentStepIndex++;

    const highlightAfter = this.getHighlightForStep(this.currentStepIndex);
    const statusesAfter = getAllCircleStatuses(step.stateAfter);
    this.updateChrome(step.stateAfter, statusesAfter);

    const durationMs = this.turnDurationMs(step.angleDeg, step.fastForwarded, 550);
    this.renderer.animateTurn(
      {
        fromState,
        toState: step.stateAfter,
        angleDeg: step.angleDeg,
        pivot: step.pivot,
        movedPieceIds: step.movedPieceIds,
        durationMs,
      },
      highlightAfter,
      onDone,
    );
  }

  private stepBackward(): void {
    if (this.currentStepIndex <= 0) return;
    const step = this.evalResult.steps[this.currentStepIndex - 1];
    const fromState = step.stateAfter;
    this.currentStepIndex--;
    const toState = this.getDisplayedState();

    const highlightAfter = this.getHighlightForStep(this.currentStepIndex);
    const statusesAfter = getAllCircleStatuses(toState);
    this.updateChrome(toState, statusesAfter);

    const durationMs = this.turnDurationMs(step.angleDeg, step.fastForwarded, 480);
    this.renderer.animateTurn(
      {
        fromState,
        toState,
        angleDeg: -step.angleDeg,
        pivot: step.pivot,
        movedPieceIds: step.movedPieceIds,
        durationMs,
      },
      highlightAfter,
    );
  }

  private startPlayback(): void {
    if (this.evalResult.steps.length === 0) return;
    if (this.currentStepIndex >= this.evalResult.steps.length) {
      this.jumpToStep(0);
    }
    this.isPlaying = true;
    this.playBtnEl.textContent = '⏸';

    const playNext = () => {
      if (!this.isPlaying) return;
      if (this.currentStepIndex >= this.evalResult.steps.length) {
        this.stopPlayback();
        return;
      }
      this.stepForward(() => {
        if (!this.isPlaying) return;
        const pauseMs = Math.round(300 / this.speedMultiplier);
        this.playTimerId = window.setTimeout(playNext, pauseMs);
      });
    };

    playNext();
  }

  private stopPlayback(): void {
    this.isPlaying = false;
    if (this.playTimerId !== null) {
      clearTimeout(this.playTimerId);
      this.playTimerId = null;
    }
    this.renderer?.cancelAnimation();
    if (this.playBtnEl) this.playBtnEl.textContent = '▶';
  }

  private handleCursorMove(cursorPos: number): void {
    if (!this.cursorSyncEnabled || this.isPlaying) return;
    const steps = this.evalResult.steps;
    if (steps.length === 0) return;

    // Find last step whose topSpan.start < cursorPos (or containing cursorPos)
    let target = 0;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].topSpan.start < cursorPos) {
        target = i + 1;
      } else {
        break;
      }
    }
    if (target !== this.currentStepIndex) {
      this.jumpToStep(target);
    }
  }

  private handleCircleClick(circleId: string, direction: 1 | -1): void {
    this.stopPlayback();
    // Interactive moves always append/coalesce at the end of the sequence, so validate
    // against `finalState` (and jump scrubber to end first if user had scrubbed earlier).
    if (this.currentStepIndex !== this.evalResult.steps.length) {
      this.jumpToStep(this.evalResult.steps.length);
    }
    const curState = this.evalResult.finalState;
    const status = getCircleStatus(curState, circleId);

    if (status.blocked) {
      this.renderer.flashBlocked(circleId, status.blockingPieceIds);
      this.showToast(
        `Circle ${circleId} is blocked by ${status.blockingPieceIds.length} piece(s)`,
      );
      return;
    }

    const useNext = this.clickUsesNextUnblocked;
    const token = useNext
      ? `${circleId}${direction === 1 ? '>' : '<'}`
      : `${circleId}${direction === 1 ? '' : "'"}`;

    this.appendInteractiveMove(token, {
      allowCoalesce: true,
      incrementalMove: (st) =>
        useNext
          ? turnCircleNextUnblocked(st, circleId, direction, 1)
          : turnCircleBySteps(st, circleId, direction),
    });
  }

  private appendInteractiveMove(
    token: string,
    options: {
      allowCoalesce?: boolean;
      incrementalMove?: (state: PuzzleState) => MoveResult;
    } = {},
  ): void {
    const prevCount = this.evalResult.steps.length;
    const wasAtEnd = this.currentStepIndex === prevCount;

    // If not at end of sequence, jump cursor to end before appending
    if (!wasAtEnd) {
      const len = this.editor.getValue().length;
      this.editor.textarea.selectionStart = len;
      this.editor.textarea.selectionEnd = len;
    }

    const prevFinalState = this.evalResult.finalState;
    const deltaAnim = options.incrementalMove?.(prevFinalState);

    const ta = this.editor.textarea;
    const curText = ta.value;
    const hasSelection = ta.selectionStart !== ta.selectionEnd;
    if (hasSelection || options.allowCoalesce === false) {
      this.editor.insertAtCursor(token);
    } else {
      const res = applyInteractiveMoveToText(
        curText,
        ta.selectionStart,
        token,
        this.currentSpec,
        true,
      );
      this.editor.setValue(res.nextText);
      ta.selectionStart = res.nextCursor;
      ta.selectionEnd = res.nextCursor;
    }

    this.evalResult = evaluateProgram(
      this.solvedState,
      this.editor.getValue(),
      this.macros,
      { solvedReference: this.solvedState },
    );
    this.renderMacroList();

    const newTotal = this.evalResult.steps.length;
    this.scrubberEl.max = String(newTotal);
    this.currentStepIndex = newTotal;

    const finalAfter = this.evalResult.finalState;
    const highlightAfter = this.getHighlightForStep(this.currentStepIndex);

    if (deltaAnim && deltaAnim.ok && !this.evalResult.blocked) {
      // Smoothly animate the incremental turn (works cleanly for append, merge B->B2, AND cancel B+B'!)
      this.updateChrome(finalAfter, getAllCircleStatuses(finalAfter));
      this.renderer.animateTurn(
        {
          fromState: prevFinalState,
          toState: finalAfter,
          angleDeg: deltaAnim.angleDeg,
          pivot: deltaAnim.pivot,
          movedPieceIds: deltaAnim.movedPieceIds,
          durationMs: this.turnDurationMs(deltaAnim.angleDeg, false, 360),
        },
        highlightAfter,
      );
    } else if (newTotal === prevCount + 1) {
      const step = this.evalResult.steps[newTotal - 1];
      this.updateChrome(step.stateAfter, getAllCircleStatuses(step.stateAfter));
      this.renderer.animateTurn(
        {
          fromState: prevFinalState,
          toState: step.stateAfter,
          angleDeg: step.angleDeg,
          pivot: step.pivot,
          movedPieceIds: step.movedPieceIds,
          durationMs: this.turnDurationMs(step.angleDeg, step.fastForwarded, 400),
        },
        highlightAfter,
      );
    } else {
      this.renderCurrentStep();
    }
  }

  private runAnalysis(algSource: string, baseState: PuzzleState, label: string): void {
    const res = analyzeAlgorithm(baseState, algSource, this.macros);
    this.analysisBannerEl.className = 'diagnostic-banner analysis visible';
    this.analysisBannerEl.innerHTML = `
      <span><b>${escapeHtml(label)} analysis:</b> ${escapeHtml(res.message)}</span>
      <button class="btn btn-sm" id="btn-dismiss-analysis">Dismiss</button>
    `;
    this.analysisBannerEl
      .querySelector('#btn-dismiss-analysis')
      ?.addEventListener('click', () => this.hideAnalysisBanner());
  }

  private hideAnalysisBanner(): void {
    this.analysisBannerEl.className = 'diagnostic-banner analysis';
    this.analysisBannerEl.innerHTML = '';
  }

  private shareCurrentState(): void {
    const hash = encodeShareHash({
      puzzleId: this.currentSpec.id,
      alg: this.editor.getValue(),
      macros: this.macros,
    });
    window.history.replaceState(null, '', hash);
    const fullUrl = window.location.href;
    navigator.clipboard?.writeText(fullUrl).then(
      () => this.showToast('Shareable URL copied to clipboard!'),
      () => this.showToast('URL updated in address bar — copy to share!'),
    );
  }

  private showToast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('visible');
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('visible');
    }, 2400);
  }
}

const appRoot = document.querySelector<HTMLElement>('#app');
if (appRoot) {
  new CircleSimApp(appRoot);
}
