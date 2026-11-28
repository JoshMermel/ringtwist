import './style.css';
import { Span } from './lang/ast.ts';
import {
  EvaluationResult,
  ExecutedStep,
  MacroLibraryEntry,
  analyzeAlgorithm,
  evaluateProgram,
} from './lang/evaluator.ts';
import { buildPuzzle } from './puzzle/builder.ts';
import { PUZZLE_CATALOG, getPuzzleSpec } from './puzzle/catalog.ts';
import {
  CircleStatus,
  MoveLayerSpec,
  MoveResult,
  flipWholePuzzle,
  formatMoveToken,
  generateScrambleWithState,
  getAllCircleStatuses,
  getCircleStatus,
  getSupportedMirrorAxes,
  isPuzzleSolved,
  rotateWholePuzzle,
  turnCircleBySteps,
} from './puzzle/engine.ts';
import { PuzzleSpec, PuzzleState } from './puzzle/types.ts';
import { AlgorithmEditor } from './ui/editor.ts';
import { createHelpModal } from './ui/helpModal.ts';
import { MacroLibraryPanel, copyTextToClipboard } from './ui/macroLibraryPanel.ts';
import { applyInteractiveMoveToText } from './ui/moveCoalesce.ts';
import { PlaybackController } from './ui/playbackController.ts';
import { PuzzlePickerController, createPuzzlePickerModal } from './ui/puzzlePicker.ts';
import { ScramblePopoverController, rollRandomSeed } from './ui/scramblePopover.ts';
import {
  SharedPayload,
  decodeShareHash,
  encodeShareHash,
  loadLastPuzzleId,
  loadMacros,
  loadSession,
  saveLastPuzzleId,
  saveMacros,
  saveSession,
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

class RingTwistApp {
  private puzzleCache = new Map<string, PuzzleState>();
  private currentSpec: PuzzleSpec;
  private solvedState: PuzzleState;

  // Optional active scramble (Twizzle-style: starts solved unless scrambled)
  private scrambleSeed: string | null = null;
  private scrambleMoves = 20;
  private initialState: PuzzleState;

  // Active evaluation & macros
  private alg = '';
  private macros: MacroLibraryEntry[] = [];
  private evalResult: EvaluationResult;
  private allSteps: ExecutedStep[] = [];
  private evalDebounceId: number | null = null;
  private isUntouchedSharedSession = false;
  private hasUnsavedSharedMacros = false;
  private solvedPeekVisible = false;
  private solvedPeekExpanded = false;

  // Sub-controllers & UI elements
  private renderer!: PuzzleSvgRenderer;
  private editor!: AlgorithmEditor;
  private playback!: PlaybackController;
  private scramblePopover!: ScramblePopoverController;
  private macroPanel!: MacroLibraryPanel;
  private helpModal!: { open: () => void; close: () => void; isOpen: () => boolean };
  private puzzlePicker!: PuzzlePickerController;

  private puzzleBtnEl!: HTMLButtonElement;
  private rotCwBtnEl!: HTMLButtonElement;
  private rotCcwBtnEl!: HTMLButtonElement;
  private flipXBtnEl!: HTMLButtonElement;
  private flipYBtnEl!: HTMLButtonElement;
  private solvedPeekBtnEl!: HTMLButtonElement;
  private solvedRefCardEl!: HTMLElement;
  private solvedRefStageEl!: HTMLElement;
  private statusStripEl!: HTMLElement;
  private statusPillsEl!: HTMLElement;
  private diagBannerEl!: HTMLElement;
  private analysisBannerEl!: HTMLElement;
  private samplesRowEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private toastTimer: number | null = null;

  constructor(root: HTMLElement) {
    const shared = decodeShareHash(window.location.hash);
    const initialSpec = getPuzzleSpec(
      shared?.puzzleId ?? loadLastPuzzleId() ?? 'geranium-plus',
    );
    this.currentSpec = initialSpec;
    saveLastPuzzleId(initialSpec.id);
    if (!shared) {
      window.history.replaceState(null, '', `#p=${encodeURIComponent(initialSpec.id)}`);
    }

    this.solvedState = this.getOrBuildPuzzle(initialSpec);
    this.initialState = this.solvedState;
    this.macros = shared?.macros ?? loadMacros(initialSpec.id);
    this.hasUnsavedSharedMacros = shared?.macros !== undefined;
    this.loadPuzzleSession(initialSpec.id, shared ?? undefined);

    this.evalResult = evaluateProgram(this.initialState, '', this.macros, {
      solvedReference: this.solvedState,
      disallowMacroDefs: true,
    });

    this.mountDOM(root);
    this.helpModal = createHelpModal();
    this.puzzlePicker = createPuzzlePickerModal({
      getPuzzles: () => PUZZLE_CATALOG,
      getOrBuildPuzzle: (spec) => this.getOrBuildPuzzle(spec),
      getCurrentPuzzleId: () => this.currentSpec.id,
      onSelect: (puzzleId) => this.activatePuzzle(puzzleId, { syncHash: true }),
    });

    this.editor.setValue(this.alg);
    this.syncPuzzleChrome();
    this.scramblePopover.sync(this.scrambleSeed, this.scrambleMoves);
    this.renderSamples();
    this.macroPanel.render(true);
    const hasSharedPayload = Boolean(
      shared && (shared.hasSharedAlg || shared.scrambleSeed || shared.macros !== undefined),
    );
    this.isUntouchedSharedSession = hasSharedPayload;
    this.reevaluate(true, { skipPersist: hasSharedPayload });
    this.bindGlobalShortcuts();

    window.addEventListener('hashchange', () => {
      const nextShared = decodeShareHash(window.location.hash);
      if (!nextShared) return;
      this.activatePuzzle(nextShared.puzzleId, { shared: nextShared, syncHash: false });
    });
    window.addEventListener('beforeunload', () => this.persistCurrentSession());
  }

  private getOrBuildPuzzle(spec: PuzzleSpec): PuzzleState {
    let cached = this.puzzleCache.get(spec.id);
    if (!cached) {
      cached = buildPuzzle(spec);
      this.puzzleCache.set(spec.id, cached);
    }
    return cached;
  }

  private computeScrambleState(solved: PuzzleState, seed: string, moves: number): PuzzleState {
    const clean = seed.trim() || rollRandomSeed();
    const clamped = Math.max(1, Math.min(1000, Math.round(moves) || 20));
    return generateScrambleWithState(solved, clamped, clean).finalState;
  }

  private loadPuzzleSession(puzzleId: string, shared?: SharedPayload): void {
    const saved = loadSession(puzzleId);

    if (shared && (shared.hasSharedAlg || shared.scrambleSeed || shared.macros !== undefined)) {
      this.alg = shared.alg;
      this.scrambleSeed = shared.scrambleSeed ?? null;
      this.scrambleMoves = shared.scrambleMoves ?? 20;
    } else if (saved) {
      this.alg = saved.alg;
      this.scrambleSeed = saved.scrambleSeed ?? null;
      this.scrambleMoves = saved.scrambleMoves ?? 20;
    } else {
      this.alg = '';
      this.scrambleSeed = null;
      this.scrambleMoves = 20;
    }

    this.initialState = this.scrambleSeed
      ? this.computeScrambleState(this.solvedState, this.scrambleSeed, this.scrambleMoves)
      : this.solvedState;
    this.macroPanel?.clearCache();
  }

  private persistCurrentSession(): void {
    if (this.isUntouchedSharedSession) return;
    if (this.editor) {
      this.alg = this.editor.getValue();
    }
    if (this.hasUnsavedSharedMacros) {
      saveMacros(this.currentSpec.id, this.macros);
      this.hasUnsavedSharedMacros = false;
    }
    saveSession(this.currentSpec.id, {
      alg: this.alg,
      ...(this.scrambleSeed
        ? { scrambleSeed: this.scrambleSeed, scrambleMoves: this.scrambleMoves }
        : {}),
    });
  }

  private syncCleanPuzzleHash(): void {
    const clean = `#p=${encodeURIComponent(this.currentSpec.id)}`;
    if (window.location.hash !== clean) {
      window.history.replaceState(null, '', clean);
    }
  }

  /** Unified lifecycle transition for both puzzle picker switches and shared URL loads. */
  private activatePuzzle(
    puzzleId: string,
    opts: { shared?: SharedPayload; syncHash: boolean },
  ): void {
    this.flushPendingEval();
    this.cancelPendingEval();
    this.playback.stopPlayback();
    this.hideAnalysisBanner();
    this.scramblePopover.close();
    this.macroPanel.resetForPuzzleSwitch();
    this.persistCurrentSession();

    this.currentSpec = getPuzzleSpec(puzzleId);
    saveLastPuzzleId(this.currentSpec.id);
    if (opts.syncHash) this.syncCleanPuzzleHash();

    this.solvedState = this.getOrBuildPuzzle(this.currentSpec);
    this.macros = opts.shared?.macros ?? loadMacros(this.currentSpec.id);
    this.hasUnsavedSharedMacros = opts.shared?.macros !== undefined;
    this.loadPuzzleSession(this.currentSpec.id, opts.shared);

    this.editor.setValue(this.alg);
    this.syncPuzzleChrome();
    if (this.solvedPeekVisible) this.syncSolvedRefCard();
    this.scramblePopover.sync(this.scrambleSeed, this.scrambleMoves);
    this.renderSamples();
    this.macroPanel.render(true);

    const hasSharedPayload = Boolean(
      opts.shared &&
        (opts.shared.scrambleSeed || opts.shared.hasSharedAlg || opts.shared.macros !== undefined),
    );
    this.isUntouchedSharedSession = hasSharedPayload;
    this.reevaluate(true, { skipPersist: hasSharedPayload });

    if (opts.shared) {
      this.showToast(
        hasSharedPayload
          ? `Loaded shared ${this.currentSpec.name} state`
          : `Switched to ${this.currentSpec.name}`,
      );
    }
  }

  // ---- DOM Mounting ----

  private mountDOM(root: HTMLElement): void {
    root.innerHTML = `
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark"></div>
          <div>
            <h1>RingTwist</h1>
            <div class="subtitle">2D twisty circle puzzle simulator</div>
          </div>
        </div>
        <div class="topbar-controls">
          <button type="button" class="book-btn" id="puzzle-picker-btn" title="Choose a puzzle">
            <span class="book-btn-dot"></span>
            <span class="book-btn-name" id="puzzle-picker-name"></span>
          </button>
          <div class="scramble-wrap">
            <button type="button" class="btn" id="btn-scramble-toggle" title="Apply or clear a deterministic seeded scramble">Scramble</button>
            <div class="scramble-popover" id="scramble-popover" hidden>
              <div class="sp-title">Seeded Scramble</div>
              <form id="scramble-form">
                <div class="sp-row">
                  <label for="sp-seed">Seed</label>
                  <div class="sp-seed-group">
                    <input type="text" id="sp-seed" autocomplete="off" spellcheck="false" placeholder="random seed" />
                    <button type="button" class="btn btn-sm" id="btn-sp-rand" title="Roll a random seed">🎲</button>
                  </div>
                </div>
                <div class="sp-row">
                  <label for="sp-moves">Moves (1–1000)</label>
                  <input type="number" id="sp-moves" min="1" max="1000" value="20" />
                </div>
                <div class="sp-actions">
                  <button type="button" class="btn btn-sm" id="btn-sp-clear" hidden>Reset Solved</button>
                  <button type="submit" class="btn btn-primary btn-sm">Scramble</button>
                </div>
              </form>
            </div>
          </div>
          <button class="btn" id="btn-share" title="Copy shareable link">Share</button>
          <button class="btn btn-primary" id="btn-help" title="Notation and controls guide">? Help</button>
        </div>
      </header>

      <main class="workspace" id="workspace">
        <section class="card puzzle-pane">
          <div class="status-strip" id="status-strip">
            <div class="status-pills" id="status-pills"></div>
          </div>

          <div class="diagnostic-banner error" id="diag-banner"></div>
          <div class="diagnostic-banner analysis" id="analysis-banner"></div>

          <div class="stage-wrap" id="stage-wrap">
            <div class="stage-overlay-tl">
              <button class="btn btn-sm" id="btn-rot-ccw" title="Whole-puzzle rotation CCW (z')">↺ z'</button>
              <button class="btn btn-sm" id="btn-rot-cw" title="Whole-puzzle rotation CW (z)">↻ z</button>
              <button class="btn btn-sm" id="btn-flip-x" title="Flip puzzle top↔bottom (x)">⇅ x</button>
              <button class="btn btn-sm" id="btn-flip-y" title="Flip puzzle left↔right (y)">⇄ y</button>
            </div>
            <div class="stage-overlay-tr">
              <button type="button" class="btn btn-sm solved-peek-btn" id="btn-solved-peek" title="Toggle a reference preview of the solved puzzle">👁 Solved</button>
            </div>
            <div class="cycle-preview-pill" id="cycle-preview-pill" hidden></div>
            <div class="focus-pick-bar" id="focus-pick-bar" hidden></div>
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
          </div>

          <div class="playback-bar">
            <div class="playback-row">
              <button class="btn btn-icon" id="btn-start" title="Jump to start">|◀</button>
              <button class="btn btn-icon" id="btn-prev" title="Step back (Alt+←)">◀</button>
              <button class="btn btn-primary btn-icon" id="btn-play" title="Play / Pause (Alt+Space)">▶</button>
              <button class="btn btn-icon" id="btn-next" title="Step forward (Alt+→)">▶</button>
              <button class="btn btn-icon" id="btn-end" title="Fast-forward to end">▶|</button>
              <input type="range" class="scrubber" id="scrubber" min="0" max="0" step="0.01" value="0" aria-label="Move scrubber" />
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
              <h2 class="section-title">Algorithm</h2>
              <div class="editor-actions">
                <button class="btn btn-sm" id="btn-analyze" title="Compute exact order and cycle structure from solved state">Analyze Order</button>
                <button class="btn btn-sm" id="btn-save-sel" title="Save selected text (or whole sequence) to Macro Library">+ Save Macro</button>
              </div>
            </div>

            <div id="editor-mount"></div>
            <div class="samples-row" id="samples-row"></div>
          </section>

          <section class="card macros-card">
            <div class="section-header">
              <h2 class="section-title">Macro Library</h2>
              <div class="editor-actions">
                <div class="preview-mode-toggle" id="macro-view-toggle" role="group" aria-label="Macro library view" title="Switch between interactive macro List and plain-text macro sheet">
                  <button type="button" class="preview-mode-btn active" data-view="list">List</button>
                  <button type="button" class="preview-mode-btn" data-view="text">Text</button>
                </div>
                <button class="btn btn-sm" id="btn-copy-macros" title="Copy Macro Library as a shareable plain-text sheet">Copy</button>
              </div>
            </div>

            <div class="macro-list-panel" id="macro-list-panel">
              <form class="save-macro-bar" id="save-macro-bar" hidden>
                <input type="text" id="save-macro-name" placeholder="name (e.g. tri3)" required pattern="[a-zA-Z_][a-zA-Z0-9_]*" autocomplete="off" />
                <input type="text" id="save-macro-body" placeholder="moves" required autocomplete="off" />
                <button type="submit" class="btn btn-primary btn-sm">Save</button>
                <button type="button" class="btn btn-sm" id="btn-save-macro-cancel">✕</button>
              </form>
              <div class="macro-list" id="macro-list"></div>
            </div>

            <div class="macro-text-panel" id="macro-text-panel" hidden>
              <textarea
                class="macro-text-area"
                id="macro-text-area"
                spellcheck="false"
                autocomplete="off"
                placeholder="// Paste or edit macros here (// === Section ===, // @hide, // @show, // @focus):&#10;// @focus big_pent&#10;big3 = [A3, C3']  // 4t: BigPent(3)"
              ></textarea>
              <div class="macro-text-error" id="macro-text-error" hidden></div>
              <div class="macro-text-actions">
                <span class="macro-text-hint"><code>// === Section ===</code> · <code>// @hide</code> · <code>// @focus</code> · JSON</span>
                <div class="macro-text-btns">
                  <button type="button" class="btn btn-sm" id="btn-macro-text-cancel">Cancel</button>
                  <button type="button" class="btn btn-primary btn-sm" id="btn-macro-text-apply">Apply</button>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </main>

      <div class="toast" id="toast"></div>
    `;

    this.puzzleBtnEl = root.querySelector('#puzzle-picker-btn')!;
    this.rotCwBtnEl = root.querySelector('#btn-rot-cw')!;
    this.rotCcwBtnEl = root.querySelector('#btn-rot-ccw')!;
    this.flipXBtnEl = root.querySelector('#btn-flip-x')!;
    this.flipYBtnEl = root.querySelector('#btn-flip-y')!;
    this.solvedPeekBtnEl = root.querySelector('#btn-solved-peek')!;
    this.solvedRefCardEl = root.querySelector('#solved-ref-card')!;
    this.solvedRefStageEl = root.querySelector('#solved-ref-stage')!;
    this.statusStripEl = root.querySelector('#status-strip')!;
    this.statusPillsEl = root.querySelector('#status-pills')!;
    this.diagBannerEl = root.querySelector('#diag-banner')!;
    this.analysisBannerEl = root.querySelector('#analysis-banner')!;
    this.samplesRowEl = root.querySelector('#samples-row')!;
    this.toastEl = root.querySelector('#toast')!;

    // Mount SVG renderer & sub-controllers
    const stageWrap = root.querySelector<HTMLElement>('#stage-wrap')!;
    this.renderer = new PuzzleSvgRenderer(stageWrap, {
      onCircleClick: (cid, dir, layerOpt) => this.handleCircleClick(cid, dir, layerOpt),
    });

    const editorMount = root.querySelector<HTMLElement>('#editor-mount')!;
    this.editor = new AlgorithmEditor(editorMount, {
      onChange: () => this.scheduleReevaluate(),
      onCursorMove: (pos) => {
        if (this.evalDebounceId === null) this.playback.syncCursor(pos);
      },
    });

    this.playback = new PlaybackController(root, this.renderer, {
      getSteps: () => this.allSteps,
      getStateAtIntegerStep: (idx) => this.getStateAtIntegerStep(idx),
      getHighlightForStep: (idx) => this.getHighlightForStep(idx),
      flushPendingEval: () => this.flushPendingEval(),
      onNavigate: () => {
        this.macroPanel.exitFocusPickMode();
        this.macroPanel.clearCyclePreview();
      },
      onChromeUpdate: (state, statuses) => this.updateChrome(state, statuses),
      onMovePillText: (text) => {
        const movePill = this.statusPillsEl.querySelector<HTMLElement>('#status-move-pill');
        if (movePill) movePill.textContent = text;
      },
    });

    this.scramblePopover = new ScramblePopoverController(root, {
      onApply: (seed, moves) => this.applyScramble(seed, moves),
      onClear: () => this.clearScramble(),
    });

    this.macroPanel = new MacroLibraryPanel(root, this.renderer, {
      getSpec: () => this.currentSpec,
      getSolvedState: () => this.solvedState,
      getDisplayedState: () => this.playback.getDisplayedState(),
      getMacros: () => this.macros,
      setMacros: (next) => {
        this.macros = next;
        this.hasUnsavedSharedMacros = false;
      },
      getEditorSelectionOrAll: () => {
        const sel = this.editor.getSelection();
        return sel.text.trim() || this.editor.getValue().trim();
      },
      getEditorValue: () => this.editor.getValue(),
      setEditorValue: (text) => {
        this.alg = text;
        this.editor.setValue(text);
      },
      insertMacroToken: (token) => this.appendInteractiveMove(token, { allowCoalesce: false }),
      prepareForFocusPick: () => {
        this.playback.stopPlayback();
        if (!this.playback.isAtIntegerPos()) {
          this.playback.jumpToStep(Math.round(this.playback.getPosition()));
        }
      },
      onMacrosChanged: (jumpToEnd) => {
        this.isUntouchedSharedSession = false;
        this.syncCleanPuzzleHash();
        this.reevaluate(jumpToEnd);
      },
      onFocusTypesChanged: () => {
        this.isUntouchedSharedSession = false;
        this.syncCleanPuzzleHash();
      },
      showToast: (msg) => this.showToast(msg),
    });

    // Topbar controls
    this.puzzleBtnEl.addEventListener('click', () => this.puzzlePicker.open());
    root.querySelector('#btn-share')!.addEventListener('click', () => this.shareCurrentState());
    root.querySelector('#btn-help')!.addEventListener('click', () => this.helpModal.open());

    // Event delegation for dynamic buttons inside status pills & diagnostic/analysis banners
    this.statusPillsEl.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('#btn-pill-clear-scramble')) {
        this.clearScramble();
      }
    });
    this.diagBannerEl.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest('#btn-move-macros-to-lib')) {
        this.macroPanel.moveEditorMacrosToLibrary();
      } else if (target.closest('#btn-jump-block')) {
        this.playback.stopPlayback();
        this.playback.jumpToStep(this.allSteps.length);
      }
    });
    this.analysisBannerEl.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('#btn-dismiss-analysis')) {
        this.hideAnalysisBanner();
      }
    });

    // Solved reference peek controls
    this.solvedPeekBtnEl.addEventListener('click', () =>
      this.setSolvedPeekVisible(!this.solvedPeekVisible),
    );
    root.querySelector('#btn-solved-close')!.addEventListener('click', () =>
      this.setSolvedPeekVisible(false),
    );
    root.querySelector('#btn-solved-expand')!.addEventListener('click', () => {
      this.solvedPeekExpanded = !this.solvedPeekExpanded;
      this.solvedRefCardEl.classList.toggle('expanded', this.solvedPeekExpanded);
    });

    // Whole-puzzle rotation & mirror-flip quick buttons
    this.rotCwBtnEl.addEventListener('click', () => {
      this.appendInteractiveMove('z', {
        allowCoalesce: true,
        appendAtEnd: true,
        incrementalMove: (st) => rotateWholePuzzle(st, 1),
      });
    });
    this.rotCcwBtnEl.addEventListener('click', () => {
      this.appendInteractiveMove("z'", {
        allowCoalesce: true,
        appendAtEnd: true,
        incrementalMove: (st) => rotateWholePuzzle(st, -1),
      });
    });
    this.flipXBtnEl.addEventListener('click', () => {
      this.appendInteractiveMove('x', {
        allowCoalesce: true,
        appendAtEnd: true,
        incrementalMove: (st) => flipWholePuzzle(st, 'x'),
      });
    });
    this.flipYBtnEl.addEventListener('click', () => {
      this.appendInteractiveMove('y', {
        allowCoalesce: true,
        appendAtEnd: true,
        incrementalMove: (st) => flipWholePuzzle(st, 'y'),
      });
    });

    // Analyze Order button
    root.querySelector('#btn-analyze')!.addEventListener('click', () => {
      this.flushPendingEval();
      const sel = this.editor.getSelection();
      const target = sel.text.trim() || this.editor.getValue().trim();
      if (!target) {
        this.showToast('Type or select an algorithm to analyze');
        return;
      }
      this.runAnalysis(target, this.solvedState, sel.text.trim() ? 'Selection' : 'Algorithm');
    });
  }

  private bindGlobalShortcuts(): void {
    window.addEventListener('keydown', (ev) => {
      if (ev.defaultPrevented || this.helpModal.isOpen() || this.puzzlePicker.isOpen()) return;

      if (ev.key === 'Escape') {
        if (this.scramblePopover.isOpen()) {
          ev.preventDefault();
          this.scramblePopover.close();
          return;
        }
        if (this.macroPanel.isEditingFocus()) {
          ev.preventDefault();
          this.macroPanel.exitFocusPickMode();
          return;
        }
        if (this.macroPanel.isSaveBarOpen()) {
          ev.preventDefault();
          this.macroPanel.closeSaveBar();
          return;
        }
      }

      // Never hijack Alt+Arrows (macOS word navigation) or Alt+Space in other inputs/textareas
      const activeEl = document.activeElement;
      const activeTag = (activeEl?.tagName ?? '').toUpperCase();
      if (activeTag === 'INPUT' || (activeTag === 'TEXTAREA' && activeEl !== this.editor.textarea)) {
        return;
      }

      if (ev.altKey && ev.code === 'ArrowRight') {
        ev.preventDefault();
        this.playback.stopPlayback(true);
        this.playback.stepForward();
      } else if (ev.altKey && ev.code === 'ArrowLeft') {
        ev.preventDefault();
        this.playback.stopPlayback(true);
        this.playback.stepBackward();
      } else if (ev.altKey && ev.code === 'Space') {
        ev.preventDefault();
        if (this.playback.getPlaying()) this.playback.stopPlayback();
        else this.playback.startPlayback();
      }
    });
  }

  // ---- Seeded Scramble ----

  private applyScramble(seed: string, moves: number): void {
    const cleanSeed = seed.trim() || rollRandomSeed();
    const clampedMoves = Math.max(1, Math.min(1000, Math.round(moves) || 20));
    this.isUntouchedSharedSession = false;
    this.playback.stopPlayback();
    this.hideAnalysisBanner();
    this.macroPanel.exitFocusPickMode();
    this.macroPanel.clearCyclePreview();
    this.scramblePopover.close();

    this.scrambleSeed = cleanSeed;
    this.scrambleMoves = clampedMoves;
    this.initialState = this.computeScrambleState(this.solvedState, cleanSeed, clampedMoves);
    this.macroPanel.clearCache();
    this.alg = '';
    this.editor.setValue('');
    this.syncCleanPuzzleHash();
    this.scramblePopover.sync(this.scrambleSeed, this.scrambleMoves);
    this.reevaluate(true);
    this.showToast(`Scrambled with seed "${cleanSeed}" (${clampedMoves} moves)`);
  }

  private clearScramble(): void {
    if (!this.scrambleSeed) return;
    this.isUntouchedSharedSession = false;
    this.playback.stopPlayback();
    this.hideAnalysisBanner();
    this.macroPanel.exitFocusPickMode();
    this.macroPanel.clearCyclePreview();
    this.scramblePopover.close();

    this.scrambleSeed = null;
    this.initialState = this.solvedState;
    this.macroPanel.clearCache();
    this.syncCleanPuzzleHash();
    this.scramblePopover.sync(this.scrambleSeed, this.scrambleMoves);
    this.reevaluate(true);
    this.showToast('Reset starting state to solved');
  }

  // ---- Puzzle Chrome & Samples ----

  private setSolvedPeekVisible(visible: boolean): void {
    this.solvedPeekVisible = visible;
    this.solvedRefCardEl.hidden = !visible;
    this.solvedPeekBtnEl.classList.toggle('active', visible);
    if (visible) this.syncSolvedRefCard();
  }

  private syncSolvedRefCard(): void {
    this.solvedRefStageEl.innerHTML = '';
    this.solvedRefStageEl.appendChild(
      renderStaticPuzzleSvg(this.solvedState, {
        showLabels: true,
        compact: true,
        className: 'solved-ref-svg',
      }),
    );
  }

  private syncPuzzleChrome(): void {
    const nameEl = this.puzzleBtnEl.querySelector('#puzzle-picker-name')!;
    nameEl.textContent = this.currentSpec.name;
    this.puzzleBtnEl.setAttribute('aria-label', `Puzzle: ${this.currentSpec.name}. Choose a puzzle`);

    const hasSym = this.currentSpec.symmetryStepDeg > 0;
    this.rotCwBtnEl.hidden = !hasSym;
    this.rotCcwBtnEl.hidden = !hasSym;
    if (hasSym) {
      this.rotCwBtnEl.title = `Rotate whole puzzle CW by ${this.currentSpec.symmetryStepDeg}° (z)`;
      this.rotCcwBtnEl.title = `Rotate whole puzzle CCW by ${this.currentSpec.symmetryStepDeg}° (z')`;
    }

    const mirrorAxes = getSupportedMirrorAxes(this.solvedState);
    this.flipXBtnEl.hidden = !mirrorAxes.includes('x');
    this.flipYBtnEl.hidden = !mirrorAxes.includes('y');
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
        this.isUntouchedSharedSession = false;
        this.playback.stopPlayback();
        this.hideAnalysisBanner();
        this.macroPanel.exitFocusPickMode();
        this.editor.setValue(sample.alg);
        this.syncCleanPuzzleHash();
        this.reevaluate(true);
      });
      this.samplesRowEl.appendChild(btn);
    }
  }

  // ---- Evaluation & Chrome ----

  private cancelPendingEval(): void {
    if (this.evalDebounceId !== null) {
      clearTimeout(this.evalDebounceId);
      this.evalDebounceId = null;
    }
  }

  private flushPendingEval(): void {
    if (this.evalDebounceId !== null) {
      this.cancelPendingEval();
      this.reevaluate(true);
    }
  }

  private scheduleReevaluate(): void {
    this.isUntouchedSharedSession = false;
    this.cancelPendingEval();
    this.syncCleanPuzzleHash();
    this.evalDebounceId = window.setTimeout(() => {
      this.evalDebounceId = null;
      this.reevaluate(true);
    }, 60);
  }

  private reevaluate(jumpToEnd: boolean, opts: { skipPersist?: boolean } = {}): void {
    this.cancelPendingEval();
    this.playback.stopPlayback();
    this.macroPanel.exitFocusPickMode();
    this.macroPanel.clearCyclePreview();

    this.alg = this.editor.getValue();
    this.evalResult = evaluateProgram(this.initialState, this.alg, this.macros, {
      solvedReference: this.solvedState,
      disallowMacroDefs: true,
    });
    this.allSteps = this.evalResult.steps;

    this.playback.syncTimelineAfterEval(this.allSteps.length, jumpToEnd);
    this.playback.renderCurrentStep();
    if (!opts.skipPersist) {
      this.persistCurrentSession();
    }
  }

  private getStateAtIntegerStep(stepIdx: number): PuzzleState {
    if (this.evalResult.blocked && stepIdx === this.allSteps.length) {
      return this.evalResult.blocked.stateBefore;
    }
    if (stepIdx <= 0 || this.allSteps.length === 0) return this.initialState;
    return this.allSteps[Math.min(stepIdx, this.allSteps.length) - 1].stateAfter;
  }

  private getHighlightForStep(stepIndex: number): RenderHighlight {
    const blocked = this.evalResult.blocked;
    if (blocked && stepIndex === this.allSteps.length) {
      return {
        blockedCircleId: blocked.circleId,
        blockingPieceIds: blocked.blockingPieceIds,
      };
    }
    return {};
  }

  private updateChrome(
    state: PuzzleState,
    statuses: Record<string, CircleStatus>,
  ): void {
    const total = this.allSteps.length;
    const pos = this.playback.getPosition();
    const isMid = total > 0 && !this.playback.isAtIntegerPos(pos);
    const intPos = Math.round(pos);

    this.playback.syncScrubberReadout(pos, total);

    // Minimal, meaningful status pills only
    const pills: string[] = [];
    const solvedNow = !isMid && isPuzzleSolved(state, this.solvedState);
    if (solvedNow) {
      pills.push('<span class="pill pill-solved">✓ Solved</span>');
    }
    if (this.scrambleSeed) {
      pills.push(
        `<span class="pill pill-scramble">Scrambled · ${escapeHtml(this.scrambleSeed)} <button type="button" class="pill-clear-btn" id="btn-pill-clear-scramble" title="Reset starting state to solved">×</button></span>`,
      );
    }

    if (isMid) {
      const idx = Math.min(total - 1, Math.floor(pos));
      const pct = Math.round((pos - idx) * 100);
      const st = this.allSteps[idx];
      const macroTag = st.macroStack.length > 0 ? ` (${st.macroStack.join(' › ')})` : '';
      pills.push(
        `<span class="pill pill-info" id="status-move-pill">Move: ${escapeHtml(st.moveLabel)} (${pct}%)${escapeHtml(macroTag)}</span>`,
      );
    } else if (intPos > 0 && intPos <= total) {
      const st = this.allSteps[intPos - 1];
      const macroTag = st.macroStack.length > 0 ? ` (${st.macroStack.join(' › ')})` : '';
      pills.push(
        `<span class="pill pill-info" id="status-move-pill">Move: ${escapeHtml(st.moveLabel)}${escapeHtml(macroTag)}</span>`,
      );
    }
    if (this.evalResult.usedFastForward) {
      pills.push('<span class="pill pill-info">⚡ Group fast-forward</span>');
    }
    if (this.evalResult.blocked) {
      pills.push(
        `<span class="pill pill-blocked">⛔ Blocked at ${escapeHtml(this.evalResult.blocked.moveLabel)}</span>`,
      );
    }
    const unlockedDiscovered = this.currentSpec.circles
      .filter((c) => c.discovered && !statuses[c.id]?.blocked)
      .map((c) => c.id);
    if (unlockedDiscovered.length > 0) {
      pills.push(
        `<span class="pill pill-discovered" title="Emergent internal circle(s) aligned and ready to turn">✦ Discovered: ${escapeHtml(unlockedDiscovered.join(', '))}</span>`,
      );
    }

    this.statusPillsEl.innerHTML = pills.join('');
    this.statusStripEl.hidden = pills.length === 0;

    // Diagnostic banner
    const errorSpans: Span[] = [];
    if (this.evalResult.parseErrors.length > 0) {
      const err = this.evalResult.parseErrors[0];
      errorSpans.push(...this.evalResult.parseErrors.map((e) => e.span));
      const isMacroDefErr = err.message.includes('belongs in the Macro Library');
      this.diagBannerEl.className = 'diagnostic-banner error visible';
      this.diagBannerEl.innerHTML = isMacroDefErr
        ? `<span><b>Macros belong in the Macro Library:</b> ${escapeHtml(err.message)}</span>
           <button type="button" class="btn btn-primary btn-sm" id="btn-move-macros-to-lib">Move macros to Library →</button>`
        : `<span><b>Syntax error:</b> ${escapeHtml(err.message)}</span>`;
    } else if (this.evalResult.runtimeError) {
      errorSpans.push(this.evalResult.runtimeError.span);
      this.diagBannerEl.className = 'diagnostic-banner error visible';
      this.diagBannerEl.innerHTML = `<span><b>Error:</b> ${escapeHtml(this.evalResult.runtimeError.message)}</span>`;
    } else if (this.evalResult.blocked) {
      const b = this.evalResult.blocked;
      errorSpans.push(b.topSpan);
      const via =
        b.macroStack.length > 0 ? ` inside <code>${escapeHtml(b.macroStack.join(' › '))}</code>` : '';
      this.diagBannerEl.className = 'diagnostic-banner error visible';
      this.diagBannerEl.innerHTML = `
        <span>
          <b>Blocked at step ${b.stepIndex + 1} (<code>${escapeHtml(b.moveLabel)}</code>${via}):</b>
          ${escapeHtml(b.reason)} — straddling pieces highlighted on puzzle.
        </span>
        ${
          intPos !== total || isMid
            ? '<button class="btn btn-sm" id="btn-jump-block">Inspect block</button>'
            : ''
        }
      `;
    } else {
      this.diagBannerEl.className = 'diagnostic-banner error';
      this.diagBannerEl.innerHTML = '';
    }

    // Active span highlight in editor
    const activeStepNum = isMid ? Math.floor(pos) + 1 : intPos;
    const activeSpan =
      activeStepNum > 0 && activeStepNum <= this.allSteps.length
        ? this.allSteps[activeStepNum - 1].topSpan
        : undefined;
    this.editor.setHighlights({ activeSpan, errorSpans });
  }

  // ---- Interactive Moves ----

  private handleCircleClick(
    circleId: string,
    direction: 1 | -1,
    layerOpt?: MoveLayerSpec,
  ): void {
    this.flushPendingEval();
    this.playback.stopPlayback();
    const curState = this.evalResult.finalState;
    const status = getCircleStatus(curState, circleId, layerOpt);

    if (status.blocked) {
      // Always render `curState` before flashing so cancelling an in-flight turn animation
      // never leaves `renderer.currentState` stuck 1 move behind on the pre-turn state.
      if (Math.abs(this.playback.getPosition() - this.allSteps.length) > 1e-4) {
        this.playback.jumpToStep(this.allSteps.length);
      } else {
        this.playback.renderCurrentStep();
      }
      this.renderer.flashBlocked(circleId, status.blockingPieceIds);
      const label = formatMoveToken(circleId, 1, layerOpt);
      this.showToast(`Circle ${label} is blocked by ${status.blockingPieceIds.length} piece(s)`);
      return;
    }

    const token = formatMoveToken(circleId, direction, layerOpt);
    this.appendInteractiveMove(token, {
      allowCoalesce: true,
      appendAtEnd: true,
      incrementalMove: (st) =>
        turnCircleBySteps(st, circleId, direction, layerOpt, status.insidePieceIds),
    });
  }

  private appendInteractiveMove(
    token: string,
    options: {
      allowCoalesce?: boolean;
      appendAtEnd?: boolean;
      incrementalMove?: (state: PuzzleState) => MoveResult;
    } = {},
  ): void {
    this.isUntouchedSharedSession = false;
    this.flushPendingEval();
    this.playback.stopPlayback();
    this.macroPanel.exitFocusPickMode();
    const prevCount = this.allSteps.length;
    const prevHadError =
      this.evalResult.parseErrors.length > 0 ||
      Boolean(this.evalResult.runtimeError) ||
      Boolean(this.evalResult.blocked);

    const ta = this.editor.textarea;
    if (options.appendAtEnd) {
      const len = ta.value.length;
      ta.selectionStart = len;
      ta.selectionEnd = len;
      this.editor.syncCursorTracking(len);
    }

    const curText = ta.value;
    const hasSelection = ta.selectionStart !== ta.selectionEnd;
    const caretAtEnd = !hasSelection && ta.selectionStart >= curText.length;
    const prevFinalState = this.evalResult.finalState;
    const deltaAnim =
      !prevHadError && caretAtEnd ? options.incrementalMove?.(prevFinalState) : undefined;

    this.macroPanel.clearCyclePreview();
    let coalescedAction: 'appended' | 'merged' | 'cancelled' | null = null;
    let appendedSpan: Span | null = null;
    let replacedStart: number | undefined;
    let mergedToken: string | undefined;
    let mergedEnd = 0;
    if (hasSelection) {
      this.editor.insertAtCursor(token);
    } else {
      const res = applyInteractiveMoveToText(
        curText,
        ta.selectionStart,
        token,
        this.currentSpec,
        options.allowCoalesce !== false,
      );
      coalescedAction = res.action;
      replacedStart = res.replacedStart;
      mergedToken = res.mergedToken;
      mergedEnd = res.nextCursor;
      if (res.action === 'appended') {
        appendedSpan = { start: res.nextCursor - token.length, end: res.nextCursor };
      }
      this.editor.setValue(res.nextText);
      ta.selectionStart = res.nextCursor;
      ta.selectionEnd = res.nextCursor;
      this.editor.syncCursorTracking(res.nextCursor);
    }

    this.alg = this.editor.getValue();
    this.syncCleanPuzzleHash();

    // O(1) incremental fast-path: when appending, merging (`A` -> `A2`), or cancelling (`A` + `A'`)
    // a single valid interactive turn at the end of an error-free algorithm, update `allSteps`
    // directly instead of re-evaluating 500–1,000 moves from step 0!
    const lastStep = this.allSteps.length > 0 ? this.allSteps[this.allSteps.length - 1] : null;
    const matchesLastStandaloneStep =
      lastStep !== null &&
      lastStep.macroStack.length === 0 &&
      replacedStart !== undefined &&
      lastStep.span.start === replacedStart;

    if (
      !prevHadError &&
      caretAtEnd &&
      coalescedAction === 'appended' &&
      deltaAnim &&
      deltaAnim.ok &&
      appendedSpan &&
      this.allSteps.length < 1500
    ) {
      const newStep: ExecutedStep = {
        index: this.allSteps.length,
        moveLabel: token,
        span: appendedSpan,
        topSpan: appendedSpan,
        macroStack: [],
        angleDeg: deltaAnim.angleDeg,
        pivot: deltaAnim.pivot,
        ...(deltaAnim.flipAxis ? { flipAxis: deltaAnim.flipAxis } : {}),
        movedPieceIds: deltaAnim.movedPieceIds,
        stateAfter: deltaAnim.nextState,
      };
      const nextSteps = [...this.allSteps, newStep];
      this.allSteps = nextSteps;
      this.evalResult = {
        ...this.evalResult,
        steps: nextSteps,
        finalState: deltaAnim.nextState,
        solved: isPuzzleSolved(deltaAnim.nextState, this.solvedState),
      };
    } else if (
      !prevHadError &&
      caretAtEnd &&
      coalescedAction === 'merged' &&
      deltaAnim &&
      deltaAnim.ok &&
      mergedToken &&
      matchesLastStandaloneStep &&
      this.allSteps.length < 1500
    ) {
      let mergedDeg = ((((lastStep!.angleDeg + deltaAnim.angleDeg) % 360) + 540) % 360) - 180;
      if (mergedDeg <= -180 + 1e-6) mergedDeg = 180;
      const mergedSpan: Span = { start: mergedEnd - mergedToken.length, end: mergedEnd };
      const updatedStep: ExecutedStep = {
        ...lastStep!,
        moveLabel: mergedToken,
        span: mergedSpan,
        topSpan: mergedSpan,
        angleDeg: mergedDeg,
        pivot: deltaAnim.pivot,
        movedPieceIds: deltaAnim.movedPieceIds,
        stateAfter: deltaAnim.nextState,
      };
      const nextSteps = [...this.allSteps.slice(0, -1), updatedStep];
      this.allSteps = nextSteps;
      this.evalResult = {
        ...this.evalResult,
        steps: nextSteps,
        finalState: deltaAnim.nextState,
        solved: isPuzzleSolved(deltaAnim.nextState, this.solvedState),
      };
    } else if (
      !prevHadError &&
      caretAtEnd &&
      coalescedAction === 'cancelled' &&
      deltaAnim &&
      deltaAnim.ok &&
      matchesLastStandaloneStep &&
      this.allSteps.length < 1500
    ) {
      const nextSteps = this.allSteps.slice(0, -1);
      const nextFinal =
        nextSteps.length > 0 ? nextSteps[nextSteps.length - 1].stateAfter : this.initialState;
      this.allSteps = nextSteps;
      this.evalResult = {
        ...this.evalResult,
        steps: nextSteps,
        finalState: nextFinal,
        solved: isPuzzleSolved(nextFinal, this.solvedState),
      };
    } else {
      this.evalResult = evaluateProgram(this.initialState, this.alg, this.macros, {
        solvedReference: this.solvedState,
        disallowMacroDefs: true,
      });
      this.allSteps = this.evalResult.steps;
    }

    const newTotal = this.allSteps.length;
    this.playback.syncTimelineAfterEval(newTotal, true);
    this.persistCurrentSession();

    const finalAfter = this.evalResult.finalState;
    const highlightAfter = this.getHighlightForStep(newTotal);
    const hasPostError =
      this.evalResult.parseErrors.length > 0 ||
      Boolean(this.evalResult.runtimeError) ||
      Boolean(this.evalResult.blocked);

    if (deltaAnim && deltaAnim.ok && !hasPostError) {
      const statusesAfter = getAllCircleStatuses(finalAfter);
      this.updateChrome(finalAfter, statusesAfter);
      this.renderer.animateTurn(
        {
          fromState: prevFinalState,
          toState: finalAfter,
          angleDeg: deltaAnim.angleDeg,
          pivot: deltaAnim.pivot,
          movedPieceIds: deltaAnim.movedPieceIds,
          durationMs: this.playback.turnDurationMs(deltaAnim.angleDeg, false, 260),
          ...(deltaAnim.flipAxis ? { flipAxis: deltaAnim.flipAxis } : {}),
        },
        highlightAfter,
        undefined,
        statusesAfter,
      );
    } else if (!prevHadError && caretAtEnd && !hasPostError && newTotal === prevCount + 1) {
      const step = this.allSteps[newTotal - 1];
      const statusesAfter = getAllCircleStatuses(step.stateAfter);
      this.updateChrome(step.stateAfter, statusesAfter);
      this.renderer.animateTurn(
        {
          fromState: prevFinalState,
          toState: step.stateAfter,
          angleDeg: step.angleDeg,
          pivot: step.pivot,
          movedPieceIds: step.movedPieceIds,
          durationMs: this.playback.turnDurationMs(step.angleDeg, step.fastForwarded, 280),
          ...(step.flipAxis ? { flipAxis: step.flipAxis } : {}),
        },
        highlightAfter,
        undefined,
        statusesAfter,
      );
    } else {
      this.playback.renderCurrentStep();
    }
  }

  // ---- Order Analysis & Sharing ----

  private runAnalysis(algSource: string, baseState: PuzzleState, label: string): void {
    const res = analyzeAlgorithm(baseState, algSource, this.macros, 200, {
      disallowMacroDefs: true,
    });
    this.analysisBannerEl.className = 'diagnostic-banner analysis visible';
    this.analysisBannerEl.innerHTML = `
      <span><b>${escapeHtml(label)} analysis:</b> ${escapeHtml(res.message)}</span>
      <button class="btn btn-sm" id="btn-dismiss-analysis">Dismiss</button>
    `;
  }

  private hideAnalysisBanner(): void {
    this.analysisBannerEl.className = 'diagnostic-banner analysis';
    this.analysisBannerEl.innerHTML = '';
  }

  private shareCurrentState(): void {
    this.flushPendingEval();
    const hash = encodeShareHash({
      puzzleId: this.currentSpec.id,
      alg: this.editor.getValue(),
      macros: this.macros,
      ...(this.scrambleSeed
        ? { scrambleSeed: this.scrambleSeed, scrambleMoves: this.scrambleMoves }
        : {}),
    });
    window.history.replaceState(null, '', hash);
    const fullUrl = window.location.href;
    copyTextToClipboard(fullUrl).then((ok) => {
      this.showToast(
        ok
          ? 'Shareable URL copied to clipboard!'
          : 'URL updated in address bar — copy to share!',
      );
    });
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
  new RingTwistApp(appRoot);
}
