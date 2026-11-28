import './style.css';
import { Span } from './lang/ast.ts';
import {
  EvaluationResult,
  ExecutedStep,
  MacroLibraryEntry,
  analyzeAlgorithm,
  evaluateProgram,
} from './lang/evaluator.ts';
import {
  parseMacroLibraryText,
  serializeMacroLibraryToText,
} from './lang/focusDirectives.ts';
import { buildPuzzle } from './puzzle/builder.ts';
import { PUZZLE_CATALOG, getPuzzleSpec } from './puzzle/catalog.ts';
import {
  CyclePreviewResult,
  computeMacroCyclePreview,
  resolveFocusTypeSet,
  toggleFocusType,
  toggleFocusTypeAtPoint,
} from './puzzle/cyclePreview.ts';
import {
  MoveLayerSpec,
  MoveResult,
  flipWholePuzzle,
  formatMoveToken,
  generateScramble,
  getAllCircleStatuses,
  getCircleStatus,
  getSupportedMirrorAxes,
  hashPuzzleState,
  isPuzzleSolved,
  rotateWholePuzzle,
  turnCircleBySteps,
} from './puzzle/engine.ts';
import { PuzzleSpec, PuzzleState } from './puzzle/types.ts';
import { AlgorithmEditor } from './ui/editor.ts';
import { createHelpModal } from './ui/helpModal.ts';
import { applyInteractiveMoveToText } from './ui/moveCoalesce.ts';
import { PuzzlePickerController, createPuzzlePickerModal } from './ui/puzzlePicker.ts';
import {
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
  renderPieceSilhouetteSvg,
  renderStaticPuzzleSvg,
} from './ui/svgRenderer.ts';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rollRandomSeed(): string {
  return String(Math.floor(10000 + Math.random() * 90000));
}

class RingTwistApp {
  private puzzleCache = new Map<string, PuzzleState>();
  private currentSpec: PuzzleSpec;
  private solvedState: PuzzleState;

  // Optional active scramble (Twizzle-style: starts solved unless scrambled)
  private scrambleSeed: string | null = null;
  private scrambleMoves = 20;
  private initialState: PuzzleState;

  // Active evaluation, macros & continuous playback state
  private alg = '';
  private macros: MacroLibraryEntry[] = [];
  private evalResult: EvaluationResult;
  private allSteps: ExecutedStep[] = [];
  private currentTimelinePos = 0; // fractional [0, allSteps.length]; integers rest, fractions park mid-turn
  private animTargetPos: number | null = null;
  private lastScrubBaseStep = -1;
  private isPlaying = false;
  private playTimerId: number | null = null;
  private evalDebounceId: number | null = null;
  private speedMultiplier = 1.0;
  private solvedPeekVisible = false;
  private solvedPeekExpanded = false;
  private macroLibraryView: 'list' | 'text' = 'list';
  private showHiddenMacros = false;
  private editingFocusMacroName: string | null = null;
  private cyclePreviewCache = new Map<string, CyclePreviewResult>();
  private lastMacroListKey = '';

  // UI elements
  private renderer!: PuzzleSvgRenderer;
  private editor!: AlgorithmEditor;
  private helpModal!: { open: () => void; close: () => void };
  private puzzlePicker!: PuzzlePickerController;
  private puzzleBtnEl!: HTMLButtonElement;
  private scrambleBtnEl!: HTMLButtonElement;
  private scramblePopoverEl!: HTMLElement;
  private scrambleSeedInput!: HTMLInputElement;
  private scrambleMovesInput!: HTMLInputElement;
  private scrambleClearBtn!: HTMLButtonElement;
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
  private cyclePreviewPillEl!: HTMLElement;
  private focusPickBarEl!: HTMLElement;
  private scrubberEl!: HTMLInputElement;
  private stepCounterEl!: HTMLElement;
  private playBtnEl!: HTMLButtonElement;
  private samplesRowEl!: HTMLElement;
  private saveMacroBarEl!: HTMLFormElement;
  private saveMacroNameInput!: HTMLInputElement;
  private saveMacroBodyInput!: HTMLInputElement;
  private macroListPanelEl!: HTMLElement;
  private macroTextPanelEl!: HTMLElement;
  private macroTextAreaEl!: HTMLTextAreaElement;
  private macroTextErrorEl!: HTMLElement;
  private macroListEl!: HTMLElement;
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
      onSelect: (puzzleId) => this.switchPuzzle(puzzleId),
    });

    this.editor.setValue(this.alg);
    this.syncPuzzleChrome();
    this.syncSolvedRefCard();
    this.syncScramblePopoverFields();
    this.renderSamples();
    this.renderMacroList();
    this.reevaluate(true);
    this.bindGlobalShortcuts();

    window.addEventListener('hashchange', () => this.applySharedHash());
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
    const seq = generateScramble(solved, clamped, clean);
    return evaluateProgram(solved, seq).finalState;
  }

  private loadPuzzleSession(
    puzzleId: string,
    shared?: { alg: string; hasSharedAlg?: boolean; scrambleSeed?: string; scrambleMoves?: number },
  ): void {
    const saved = loadSession(puzzleId);

    if (shared && (shared.hasSharedAlg || shared.scrambleSeed)) {
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
    this.cyclePreviewCache.clear();
  }

  private persistCurrentSession(): void {
    if (this.editor) {
      this.alg = this.editor.getValue();
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

  private applySharedHash(): void {
    const shared = decodeShareHash(window.location.hash);
    if (!shared) return;
    this.cancelPendingEval();
    this.stopPlayback();
    this.hideAnalysisBanner();
    this.exitFocusPickMode();
    this.clearCyclePreview();
    this.closeScramblePopover();

    this.currentSpec = getPuzzleSpec(shared.puzzleId);
    saveLastPuzzleId(this.currentSpec.id);
    this.solvedState = this.getOrBuildPuzzle(this.currentSpec);
    this.macros = shared.macros ?? loadMacros(this.currentSpec.id);
    this.showHiddenMacros = false;
    this.setMacroLibraryView('list');
    this.loadPuzzleSession(this.currentSpec.id, shared);
    this.lastMacroListKey = '';

    this.editor.setValue(this.alg);
    this.syncPuzzleChrome();
    this.syncSolvedRefCard();
    this.syncScramblePopoverFields();
    this.renderSamples();
    this.renderMacroList();
    this.reevaluate(true);
    const hasPayload = Boolean(shared.scrambleSeed || shared.hasSharedAlg || shared.macros);
    this.showToast(
      hasPayload
        ? `Loaded shared ${this.currentSpec.name} state`
        : `Switched to ${this.currentSpec.name}`,
    );
  }

  private switchPuzzle(puzzleId: string): void {
    this.flushPendingEval();
    this.cancelPendingEval();
    this.stopPlayback();
    this.hideAnalysisBanner();
    this.exitFocusPickMode();
    this.clearCyclePreview();
    this.closeScramblePopover();
    this.persistCurrentSession();

    this.currentSpec = getPuzzleSpec(puzzleId);
    saveLastPuzzleId(this.currentSpec.id);
    this.syncCleanPuzzleHash();
    this.solvedState = this.getOrBuildPuzzle(this.currentSpec);
    this.macros = loadMacros(this.currentSpec.id);
    this.showHiddenMacros = false;
    this.setMacroLibraryView('list');
    this.loadPuzzleSession(this.currentSpec.id);
    this.lastMacroListKey = '';

    this.editor.setValue(this.alg);
    this.syncPuzzleChrome();
    this.syncSolvedRefCard();
    this.syncScramblePopoverFields();
    this.renderSamples();
    this.renderMacroList();
    this.reevaluate(true);
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
              <h2 class="section-title" id="editor-section-title">Algorithm</h2>
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
    this.scrambleBtnEl = root.querySelector('#btn-scramble-toggle')!;
    this.scramblePopoverEl = root.querySelector('#scramble-popover')!;
    this.scrambleSeedInput = root.querySelector('#sp-seed')!;
    this.scrambleMovesInput = root.querySelector('#sp-moves')!;
    this.scrambleClearBtn = root.querySelector('#btn-sp-clear')!;
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
    this.cyclePreviewPillEl = root.querySelector('#cycle-preview-pill')!;
    this.focusPickBarEl = root.querySelector('#focus-pick-bar')!;
    this.scrubberEl = root.querySelector('#scrubber')!;
    this.stepCounterEl = root.querySelector('#step-counter')!;
    this.playBtnEl = root.querySelector('#btn-play')!;
    this.samplesRowEl = root.querySelector('#samples-row')!;
    this.saveMacroBarEl = root.querySelector('#save-macro-bar')!;
    this.saveMacroNameInput = root.querySelector('#save-macro-name')!;
    this.saveMacroBodyInput = root.querySelector('#save-macro-body')!;
    this.macroListPanelEl = root.querySelector('#macro-list-panel')!;
    this.macroTextPanelEl = root.querySelector('#macro-text-panel')!;
    this.macroTextAreaEl = root.querySelector('#macro-text-area')!;
    this.macroTextErrorEl = root.querySelector('#macro-text-error')!;
    this.macroListEl = root.querySelector('#macro-list')!;
    this.toastEl = root.querySelector('#toast')!;

    // Mount SVG renderer & Algorithm editor
    const stageWrap = root.querySelector<HTMLElement>('#stage-wrap')!;
    this.renderer = new PuzzleSvgRenderer(stageWrap, {
      onCircleClick: (cid, dir, layerOpt) => this.handleCircleClick(cid, dir, layerOpt),
    });

    const editorMount = root.querySelector<HTMLElement>('#editor-mount')!;
    this.editor = new AlgorithmEditor(editorMount, {
      onChange: () => this.scheduleReevaluate(),
      onCursorMove: (pos) => this.handleCursorMove(pos),
    });

    // Topbar controls
    this.puzzleBtnEl.addEventListener('click', () => this.puzzlePicker.open());
    root.querySelector('#btn-share')!.addEventListener('click', () => this.shareCurrentState());
    root.querySelector('#btn-help')!.addEventListener('click', () => this.helpModal.open());

    // Scramble popover
    this.scrambleBtnEl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const willOpen = this.scramblePopoverEl.hidden;
      if (willOpen) {
        this.syncScramblePopoverFields();
        this.scramblePopoverEl.hidden = false;
        this.scrambleSeedInput.focus();
      } else {
        this.closeScramblePopover();
      }
    });
    document.addEventListener('click', (ev) => {
      if (
        !this.scramblePopoverEl.hidden &&
        !(ev.target as HTMLElement).closest('.scramble-wrap')
      ) {
        this.closeScramblePopover();
      }
    });
    root.querySelector('#btn-sp-rand')!.addEventListener('click', () => {
      const seed = rollRandomSeed();
      this.scrambleSeedInput.value = seed;
      this.applyScramble(seed, parseInt(this.scrambleMovesInput.value, 10) || 20);
    });
    root.querySelector<HTMLFormElement>('#scramble-form')!.addEventListener('submit', (ev) => {
      ev.preventDefault();
      this.applyScramble(
        this.scrambleSeedInput.value || rollRandomSeed(),
        parseInt(this.scrambleMovesInput.value, 10) || 20,
      );
    });
    this.scrambleClearBtn.addEventListener('click', () => this.clearScramble());

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
        incrementalMove: (st) => rotateWholePuzzle(st, 1),
      });
    });
    this.rotCcwBtnEl.addEventListener('click', () => {
      this.appendInteractiveMove("z'", {
        allowCoalesce: true,
        incrementalMove: (st) => rotateWholePuzzle(st, -1),
      });
    });
    this.flipXBtnEl.addEventListener('click', () => {
      this.appendInteractiveMove('x', {
        allowCoalesce: true,
        incrementalMove: (st) => flipWholePuzzle(st, 'x'),
      });
    });
    this.flipYBtnEl.addEventListener('click', () => {
      this.appendInteractiveMove('y', {
        allowCoalesce: true,
        incrementalMove: (st) => flipWholePuzzle(st, 'y'),
      });
    });

    // Playback bar
    root.querySelector('#btn-start')!.addEventListener('click', () => {
      this.stopPlayback();
      this.jumpToStep(0);
    });
    root.querySelector('#btn-prev')!.addEventListener('click', () => {
      this.stopPlayback(true);
      this.stepBackward();
    });
    this.playBtnEl.addEventListener('click', () => {
      if (this.isPlaying) this.stopPlayback();
      else this.startPlayback();
    });
    root.querySelector('#btn-next')!.addEventListener('click', () => {
      this.stopPlayback(true);
      this.stepForward();
    });
    root.querySelector('#btn-end')!.addEventListener('click', () => {
      this.stopPlayback();
      this.jumpToStep(this.allSteps.length);
    });
    this.scrubberEl.addEventListener('input', () => {
      this.stopPlayback();
      this.scrubToPosition(parseFloat(this.scrubberEl.value));
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
      this.flushPendingEval();
      const sel = this.editor.getSelection();
      const target = sel.text.trim() || this.editor.getValue().trim();
      if (!target) {
        this.showToast('Type or select an algorithm to analyze');
        return;
      }
      this.runAnalysis(target, this.solvedState, sel.text.trim() ? 'Selection' : 'Algorithm');
    });

    // + Save Macro on-demand bar
    root.querySelector('#btn-save-sel')!.addEventListener('click', () => {
      const sel = this.editor.getSelection();
      const body = sel.text.trim() || this.editor.getValue().trim();
      if (!body) {
        this.showToast('Select or type moves first');
        return;
      }
      this.setMacroLibraryView('list');
      this.saveMacroBodyInput.value = body.replace(/\s+/g, ' ');
      this.saveMacroNameInput.value = '';
      this.saveMacroBarEl.hidden = false;
      this.saveMacroNameInput.focus();
    });

    root.querySelector('#btn-save-macro-cancel')!.addEventListener('click', () => {
      this.saveMacroBarEl.hidden = true;
    });

    this.saveMacroBarEl.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = this.saveMacroNameInput.value.trim();
      const body = this.saveMacroBodyInput.value.trim();
      if (!name || !body) return;
      if (this.getReservedMacroNames().has(name)) {
        this.showToast(`"${name}" is a reserved move name`);
        return;
      }
      const idx = this.macros.findIndex((m) => m.name === name);
      if (idx >= 0) this.macros[idx] = { ...this.macros[idx], body };
      else this.macros.push({ name, body });
      saveMacros(this.currentSpec.id, this.macros);
      this.cyclePreviewCache.clear();
      this.saveMacroBarEl.hidden = true;
      this.lastMacroListKey = '';
      this.renderMacroList();
      this.reevaluate(false);
      this.showToast(`Saved macro "${name}"`);
    });

    // Macro Library List / Text view toggle & Copy
    root.querySelectorAll<HTMLButtonElement>('#macro-view-toggle .preview-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setMacroLibraryView(btn.dataset.view === 'text' ? 'text' : 'list');
      });
    });

    root.querySelector('#btn-copy-macros')!.addEventListener('click', () => {
      const text =
        this.macroLibraryView === 'text'
          ? this.macroTextAreaEl.value
          : serializeMacroLibraryToText(this.macros);
      if (!text.trim()) {
        this.showToast('Macro Library is empty');
        return;
      }
      navigator.clipboard?.writeText(text).then(
        () => this.showToast('Copied Macro Library text to clipboard'),
        () => window.prompt('Copy Macro Library text:', text),
      );
    });

    root.querySelector('#btn-macro-text-cancel')!.addEventListener('click', () => {
      this.setMacroLibraryView('list');
    });

    root.querySelector('#btn-macro-text-apply')!.addEventListener('click', () => {
      this.applyMacroTextSheet();
    });

    this.macroTextAreaEl.addEventListener('keydown', (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
        ev.preventDefault();
        this.applyMacroTextSheet();
      }
    });
  }

  private bindGlobalShortcuts(): void {
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        if (!this.scramblePopoverEl.hidden) {
          ev.preventDefault();
          this.closeScramblePopover();
          return;
        }
        if (this.editingFocusMacroName) {
          ev.preventDefault();
          this.exitFocusPickMode();
          return;
        }
        if (!this.saveMacroBarEl.hidden) {
          ev.preventDefault();
          this.saveMacroBarEl.hidden = true;
          return;
        }
      }

      const activeTag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (activeTag === 'INPUT' && !ev.altKey) return;

      if (ev.altKey && ev.code === 'ArrowRight') {
        ev.preventDefault();
        this.stopPlayback(true);
        this.stepForward();
      } else if (ev.altKey && ev.code === 'ArrowLeft') {
        ev.preventDefault();
        this.stopPlayback(true);
        this.stepBackward();
      } else if (ev.altKey && ev.code === 'Space') {
        ev.preventDefault();
        if (this.isPlaying) this.stopPlayback();
        else this.startPlayback();
      }
    });
  }

  // ---- Seeded Scramble ----

  private closeScramblePopover(): void {
    if (this.scramblePopoverEl) this.scramblePopoverEl.hidden = true;
  }

  private syncScramblePopoverFields(): void {
    this.scrambleSeedInput.value = this.scrambleSeed ?? rollRandomSeed();
    this.scrambleMovesInput.value = String(this.scrambleMoves);
    this.scrambleClearBtn.hidden = this.scrambleSeed === null;
    this.scrambleBtnEl.classList.toggle('active', this.scrambleSeed !== null);
  }

  private applyScramble(seed: string, moves: number): void {
    const cleanSeed = seed.trim() || rollRandomSeed();
    const clampedMoves = Math.max(1, Math.min(1000, Math.round(moves) || 20));
    this.stopPlayback();
    this.hideAnalysisBanner();
    this.clearCyclePreview();
    this.closeScramblePopover();

    this.scrambleSeed = cleanSeed;
    this.scrambleMoves = clampedMoves;
    this.initialState = this.computeScrambleState(this.solvedState, cleanSeed, clampedMoves);
    this.cyclePreviewCache.clear();
    this.alg = '';
    this.editor.setValue('');
    this.syncCleanPuzzleHash();
    this.syncScramblePopoverFields();
    this.reevaluate(true);
    this.showToast(`Scrambled with seed "${cleanSeed}" (${clampedMoves} moves)`);
  }

  private clearScramble(): void {
    if (!this.scrambleSeed) return;
    this.stopPlayback();
    this.hideAnalysisBanner();
    this.clearCyclePreview();
    this.closeScramblePopover();

    this.scrambleSeed = null;
    this.initialState = this.solvedState;
    this.cyclePreviewCache.clear();
    this.syncCleanPuzzleHash();
    this.syncScramblePopoverFields();
    this.reevaluate(true);
    this.showToast('Reset starting state to solved');
  }

  // ---- Macro Library (List / Text, Hover Preview & Piece-Type Focus) ----

  private getReservedMacroNames(): Set<string> {
    return new Set([
      ...this.currentSpec.circles.map((c) => c.id),
      ...this.currentSpec.circles
        .filter((c) => c.layerRadii && c.layerRadii.length > 1)
        .map((c) => c.id.toLowerCase()),
      'x',
      'y',
      'z',
    ]);
  }

  private getMacroParseContext(): {
    reservedNames: Set<string>;
    validCircleIds: string[];
    multiLayerCircleIds: string[];
  } {
    return {
      reservedNames: this.getReservedMacroNames(),
      validCircleIds: this.currentSpec.circles.map((c) => c.id),
      multiLayerCircleIds: this.currentSpec.circles
        .filter((c) => c.layerRadii && c.layerRadii.length > 1)
        .map((c) => c.id),
    };
  }

  private setMacroLibraryView(view: 'list' | 'text'): void {
    this.macroLibraryView = view;
    if (view === 'text') {
      this.exitFocusPickMode();
      this.clearCyclePreview();
      if (this.saveMacroBarEl) this.saveMacroBarEl.hidden = true;
      if (this.macroTextAreaEl) {
        this.macroTextAreaEl.value = serializeMacroLibraryToText(this.macros);
      }
      if (this.macroTextErrorEl) {
        this.macroTextErrorEl.hidden = true;
        this.macroTextErrorEl.textContent = '';
      }
    }
    if (this.macroListPanelEl) this.macroListPanelEl.hidden = view !== 'list';
    if (this.macroTextPanelEl) this.macroTextPanelEl.hidden = view !== 'text';
    document
      .querySelectorAll<HTMLButtonElement>('#macro-view-toggle .preview-mode-btn')
      .forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.view === view);
      });
    if (view === 'text') {
      this.macroTextAreaEl?.focus();
    }
  }

  private applyMacroTextSheet(): void {
    const parsed = parseMacroLibraryText(this.macroTextAreaEl.value, this.getMacroParseContext());
    if (parsed.errors.length > 0) {
      this.macroTextErrorEl.hidden = false;
      this.macroTextErrorEl.textContent = parsed.errors.slice(0, 3).join(' · ');
      return;
    }
    this.macroTextErrorEl.hidden = true;
    this.macroTextErrorEl.textContent = '';
    this.macros = parsed.entries;
    saveMacros(this.currentSpec.id, this.macros);
    this.cyclePreviewCache.clear();
    this.setMacroLibraryView('list');
    this.lastMacroListKey = '';
    this.renderMacroList();
    this.reevaluate(false);
    this.showToast(
      `Updated Macro Library (${this.macros.length} ${this.macros.length === 1 ? 'macro' : 'macros'})`,
    );
  }

  private moveEditorMacrosToLibrary(): void {
    const parsed = parseMacroLibraryText(this.editor.getValue(), {
      ...this.getMacroParseContext(),
      allowNonMacroLines: true,
    });
    if (parsed.errors.length > 0) {
      this.showToast(`Could not move macros: ${parsed.errors[0]}`);
      return;
    }
    if (parsed.entries.length === 0) return;

    for (const entry of parsed.entries) {
      const idx = this.macros.findIndex((m) => m.name === entry.name);
      if (idx >= 0) this.macros[idx] = entry;
      else this.macros.push(entry);
    }
    saveMacros(this.currentSpec.id, this.macros);
    this.cyclePreviewCache.clear();

    this.alg = parsed.remainingText;
    this.editor.setValue(parsed.remainingText);
    this.lastMacroListKey = '';
    this.renderMacroList();
    this.reevaluate(true);
    this.showToast(
      `Moved ${parsed.entries.length} ${parsed.entries.length === 1 ? 'macro' : 'macros'} to Macro Library`,
    );
  }

  private previewMacroCycles(
    algSource: string,
    label: string,
    focusTypes?: string[],
    ignoreFocus = false,
  ): void {
    if (this.editingFocusMacroName) return;
    const curState = this.getDisplayedState();
    const activeFocus = ignoreFocus ? undefined : focusTypes;
    const focusKey = activeFocus ? JSON.stringify(activeFocus) : '';
    const cacheKey = `${focusKey}|${hashPuzzleState(curState)}|${algSource}`;
    let res = this.cyclePreviewCache.get(cacheKey);
    if (!res) {
      res = computeMacroCyclePreview(curState, algSource, this.macros, label, {
        focusTypes: activeFocus,
        solvedState: this.solvedState,
      });
      if (this.cyclePreviewCache.size >= 64) {
        const firstKey = this.cyclePreviewCache.keys().next().value;
        if (firstKey !== undefined) this.cyclePreviewCache.delete(firstKey);
      }
      this.cyclePreviewCache.set(cacheKey, res);
    }
    this.renderer.setCyclePreview(res);
    this.cyclePreviewPillEl.hidden = false;
    this.cyclePreviewPillEl.className = `cycle-preview-pill${res.blocked ? ' blocked' : ''}`;
    this.cyclePreviewPillEl.textContent = `Preview ${label}: ${res.summary}`;
  }

  private clearCyclePreview(): void {
    if (this.editingFocusMacroName) return;
    this.renderer?.setCyclePreview(null);
    if (this.cyclePreviewPillEl) {
      this.cyclePreviewPillEl.hidden = true;
    }
  }

  private enterFocusPickMode(macroName: string): void {
    if (this.editingFocusMacroName === macroName) {
      this.exitFocusPickMode();
      return;
    }
    if (!this.macros.some((m) => m.name === macroName)) return;
    this.stopPlayback();
    if (!this.isAtIntegerPos()) {
      this.jumpToStep(Math.round(this.currentTimelinePos));
    }
    this.editingFocusMacroName = macroName;
    this.renderer.setFocusPickHandler((pt) => this.handleFocusPickClick(pt));
    this.renderFocusPickOverlay();
    this.lastMacroListKey = '';
    this.renderMacroList();
  }

  private exitFocusPickMode(): void {
    if (!this.editingFocusMacroName) return;
    this.editingFocusMacroName = null;
    this.renderer.setFocusPickHandler(null);
    this.renderer.setCyclePreview(null);
    this.focusPickBarEl.hidden = true;
    this.cyclePreviewPillEl.hidden = true;
    this.lastMacroListKey = '';
    this.renderMacroList();
  }

  private updateMacroFocusTypes(macroName: string, nextFocusTypes: string[]): void {
    const idx = this.macros.findIndex((m) => m.name === macroName);
    if (idx < 0) return;
    const entry = this.macros[idx];
    if (nextFocusTypes.length > 0) {
      this.macros[idx] = { ...entry, focusTypes: nextFocusTypes };
    } else {
      const { focusTypes: _removed, ...rest } = entry;
      this.macros[idx] = rest;
    }
    saveMacros(this.currentSpec.id, this.macros);
    this.cyclePreviewCache.clear();
    this.renderFocusPickOverlay();
    this.lastMacroListKey = '';
    this.renderMacroList();
  }

  private handleFocusPickClick(pt: { x: number; y: number }): void {
    if (!this.editingFocusMacroName) return;
    const entry = this.macros.find((m) => m.name === this.editingFocusMacroName);
    if (!entry) {
      this.exitFocusPickMode();
      return;
    }
    const curState = this.getDisplayedState();
    const fullPreview = computeMacroCyclePreview(curState, entry.body, this.macros, entry.name, {
      solvedState: this.solvedState,
    });
    if (!fullPreview.ok || fullPreview.blocked) return;

    const nextFocus = toggleFocusTypeAtPoint(
      entry.focusTypes,
      curState,
      fullPreview,
      pt,
      this.solvedState,
    );
    if (nextFocus === null) return;
    this.updateMacroFocusTypes(entry.name, nextFocus);
  }

  private renderFocusPickOverlay(): void {
    if (!this.editingFocusMacroName) return;
    const entry = this.macros.find((m) => m.name === this.editingFocusMacroName);
    if (!entry) {
      this.exitFocusPickMode();
      return;
    }
    const curState = this.getDisplayedState();
    const res = computeMacroCyclePreview(curState, entry.body, this.macros, entry.name, {
      focusTypes: entry.focusTypes,
      solvedState: this.solvedState,
      includeDimmed: true,
    });
    this.renderer.setCyclePreview(res);

    const selectedShapes = resolveFocusTypeSet(this.solvedState, entry.focusTypes);
    const selCount = selectedShapes.size;
    this.focusPickBarEl.hidden = false;
    this.focusPickBarEl.innerHTML = `
      <div class="focus-pick-header">
        <span class="focus-pick-text">
          🎯 <strong>Focus “${escapeHtml(entry.name)}”</strong>: pick piece types below or click pieces on board
          ${
            selCount > 0
              ? `<span class="focus-pick-count">(${selCount} ${selCount === 1 ? 'type' : 'types'})</span>`
              : '<span class="focus-pick-count">(all shown)</span>'
          }
        </span>
        <div class="focus-pick-actions">
          ${selCount > 0 ? '<button type="button" class="btn btn-sm" id="btn-focus-clear">Clear</button>' : ''}
          <button type="button" class="btn btn-primary btn-sm" id="btn-focus-done">Done</button>
        </div>
      </div>
      <div class="focus-shape-chips" id="focus-shape-chips"></div>
    `;

    const chipsEl = this.focusPickBarEl.querySelector<HTMLElement>('#focus-shape-chips')!;
    if (res.pieceTypes.length === 0) {
      chipsEl.innerHTML = `<span class="focus-pick-count">${res.blocked ? escapeHtml(res.summary) : 'No pieces moved from current state'}</span>`;
    } else {
      for (const pt of res.pieceTypes) {
        const isSelected = selectedShapes.has(pt.shapeType);
        const isDimmed = selCount > 0 && !isSelected;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `focus-shape-chip${isSelected ? ' selected' : ''}${isDimmed ? ' dimmed' : ''}`;
        btn.title = `${isSelected ? 'Unfocus' : 'Focus'} ${pt.label} (@focus ${pt.id}) — ${pt.count} ${pt.count === 1 ? 'piece' : 'pieces'} affected`;
        btn.appendChild(renderPieceSilhouetteSvg(pt.sampleRegion));
        const nameSpan = document.createElement('span');
        nameSpan.className = 'focus-shape-name';
        nameSpan.textContent = pt.id;
        const countSpan = document.createElement('span');
        countSpan.className = 'focus-shape-count';
        countSpan.textContent = `×${pt.count}`;
        btn.append(nameSpan, countSpan);
        btn.addEventListener('click', () => {
          this.updateMacroFocusTypes(
            entry.name,
            toggleFocusType(entry.focusTypes, pt.id, this.solvedState),
          );
        });
        chipsEl.appendChild(btn);
      }
    }

    this.focusPickBarEl.querySelector('#btn-focus-clear')?.addEventListener('click', () => {
      this.updateMacroFocusTypes(entry.name, []);
    });
    this.focusPickBarEl.querySelector('#btn-focus-done')?.addEventListener('click', () => {
      this.exitFocusPickMode();
    });

    this.cyclePreviewPillEl.hidden = false;
    this.cyclePreviewPillEl.className = `cycle-preview-pill${res.blocked ? ' blocked' : ''}`;
    this.cyclePreviewPillEl.textContent = `Preview ${entry.name}: ${res.summary}`;
  }

  private renderMacroList(): void {
    const key = JSON.stringify([this.macros, this.showHiddenMacros, this.editingFocusMacroName]);
    if (key === this.lastMacroListKey) return;
    this.lastMacroListKey = key;

    this.macroListEl.innerHTML = '';

    if (this.macros.length === 0) {
      this.macroListEl.innerHTML =
        '<div class="empty-state">No macros yet. Click <b>+ Save Macro</b> above, or switch to <b>Text</b> to paste a macro sheet.</div>';
      return;
    }

    const visibleMacros = this.macros.filter((m) => !m.hidden);
    const hiddenMacros = this.macros.filter((m) => m.hidden);

    const addRow = (entry: MacroLibraryEntry, isHiddenHelper = false) => {
      const focusTypes = entry.focusTypes;
      const focusCount = focusTypes?.length ?? 0;
      const isEditingFocus = this.editingFocusMacroName === entry.name;
      const row = document.createElement('div');
      row.className = `macro-item${isHiddenHelper ? ' hidden-helper' : ''}${isEditingFocus ? ' editing-focus' : ''}`;
      row.innerHTML = `
        <div class="macro-item-top">
          <div class="macro-meta">
            <div class="macro-name-row">
              <span class="macro-name">${escapeHtml(entry.name)}</span>
              ${isHiddenHelper ? '<span class="macro-badge">helper</span>' : ''}
            </div>
            <div class="macro-body" title="${escapeHtml(entry.body)}">${escapeHtml(entry.body)}</div>
          </div>
          <div class="macro-btns">
            <button class="btn btn-sm" data-act="insert" title="Insert ${escapeHtml(entry.name)} at cursor">Insert</button>
            <button class="btn btn-sm" data-act="inv" title="Insert inverse ${escapeHtml(entry.name)}' at cursor">Inv '</button>
            <button class="btn btn-sm macro-focus-btn${focusCount > 0 ? ' has-focus' : ''}${isEditingFocus ? ' active' : ''}" data-act="focus" title="${
              focusCount > 0
                ? `Focusing ${focusCount} piece ${focusCount === 1 ? 'type' : 'types'} on hover — click to edit (Alt-hover peeks all)`
                : 'Pick specific piece types to highlight on hover'
            }">🎯${focusCount > 0 ? ` ${focusCount}` : ''}</button>
          </div>
        </div>
        ${entry.note ? `<div class="macro-note">${escapeHtml(entry.note)}</div>` : ''}
      `;

      const insertBtn = row.querySelector<HTMLButtonElement>('[data-act="insert"]')!;
      const invBtn = row.querySelector<HTMLButtonElement>('[data-act="inv"]')!;
      const metaEl = row.querySelector<HTMLElement>('.macro-meta')!;
      const noteEl = row.querySelector<HTMLElement>('.macro-note');

      const bindPreview = (el: HTMLElement, alg: string, lbl: string) => {
        el.addEventListener('mouseenter', (ev) =>
          this.previewMacroCycles(alg, lbl, focusTypes, (ev as MouseEvent).altKey),
        );
        el.addEventListener('mouseleave', () => this.clearCyclePreview());
        el.addEventListener('focus', () => this.previewMacroCycles(alg, lbl, focusTypes));
        el.addEventListener('blur', () => this.clearCyclePreview());
      };
      bindPreview(metaEl, entry.body, entry.name);
      if (noteEl) bindPreview(noteEl, entry.body, entry.name);
      bindPreview(insertBtn, entry.body, entry.name);
      bindPreview(invBtn, `(${entry.body})'`, `${entry.name}'`);

      insertBtn.addEventListener('click', () => {
        this.exitFocusPickMode();
        this.clearCyclePreview();
        this.appendInteractiveMove(entry.name, { allowCoalesce: false });
      });
      invBtn.addEventListener('click', () => {
        this.exitFocusPickMode();
        this.clearCyclePreview();
        this.appendInteractiveMove(`${entry.name}'`, { allowCoalesce: false });
      });
      row.querySelector('[data-act="focus"]')?.addEventListener('click', () => {
        this.enterFocusPickMode(entry.name);
      });

      this.macroListEl.appendChild(row);
    };

    let lastSection: string | undefined;
    for (const m of visibleMacros) {
      if (m.section && m.section !== lastSection) {
        const heading = document.createElement('div');
        heading.className = 'macro-section-heading';
        heading.textContent = m.section;
        this.macroListEl.appendChild(heading);
        if (m.sectionNote) {
          const secNote = document.createElement('div');
          secNote.className = 'macro-section-note';
          secNote.textContent = m.sectionNote;
          this.macroListEl.appendChild(secNote);
        }
        lastSection = m.section;
      }
      addRow(m, false);
    }

    if (hiddenMacros.length > 0) {
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'macro-hidden-toggle';
      toggleBtn.id = 'btn-toggle-hidden-macros';
      const n = hiddenMacros.length;
      toggleBtn.textContent = this.showHiddenMacros
        ? `▾ Hide ${n} hidden ${n === 1 ? 'helper' : 'helpers'} (@hide)`
        : `▸ Show ${n} hidden ${n === 1 ? 'helper' : 'helpers'} (@hide)`;
      toggleBtn.addEventListener('click', () => {
        this.showHiddenMacros = !this.showHiddenMacros;
        this.renderMacroList();
      });
      this.macroListEl.appendChild(toggleBtn);

      if (this.showHiddenMacros) {
        for (const m of hiddenMacros) addRow(m, true);
      }
    }
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
        this.stopPlayback();
        this.hideAnalysisBanner();
        this.editor.setValue(sample.alg);
        this.syncCleanPuzzleHash();
        this.reevaluate(true);
      });
      this.samplesRowEl.appendChild(btn);
    }
  }

  // ---- Evaluation & Rendering ----

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
    this.cancelPendingEval();
    this.syncCleanPuzzleHash();
    this.evalDebounceId = window.setTimeout(() => {
      this.evalDebounceId = null;
      this.reevaluate(true);
    }, 60);
  }

  private reevaluate(jumpToEnd: boolean): void {
    this.cancelPendingEval();
    this.stopPlayback();
    this.clearCyclePreview();

    this.alg = this.editor.getValue();
    this.evalResult = evaluateProgram(this.initialState, this.alg, this.macros, {
      solvedReference: this.solvedState,
      disallowMacroDefs: true,
    });
    this.allSteps = this.evalResult.steps;

    const maxStep = this.allSteps.length;
    this.scrubberEl.max = String(maxStep);
    this.lastScrubBaseStep = -1;
    this.currentTimelinePos = jumpToEnd ? maxStep : Math.min(this.currentTimelinePos, maxStep);

    this.renderCurrentStep();
    this.persistCurrentSession();
  }

  private isAtIntegerPos(pos = this.currentTimelinePos): boolean {
    return Math.abs(pos - Math.round(pos)) <= 1e-4;
  }

  private formatStepCounter(pos: number, total: number): string {
    return this.isAtIntegerPos(pos) ? `${Math.round(pos)} / ${total}` : `${pos.toFixed(1)} / ${total}`;
  }

  private getStateAtIntegerStep(stepIdx: number): PuzzleState {
    if (stepIdx <= 0 || this.allSteps.length === 0) return this.initialState;
    return this.allSteps[Math.min(stepIdx, this.allSteps.length) - 1].stateAfter;
  }

  private getDisplayedState(): PuzzleState {
    return this.getStateAtIntegerStep(Math.round(this.currentTimelinePos));
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

  private renderCurrentStep(): void {
    const pos = this.currentTimelinePos;
    if (this.allSteps.length > 0 && !this.isAtIntegerPos(pos)) {
      this.scrubToPosition(pos);
      return;
    }
    const stepIdx = Math.round(pos);
    this.currentTimelinePos = stepIdx;
    this.lastScrubBaseStep = -1;
    const state = this.getStateAtIntegerStep(stepIdx);
    const highlight = this.getHighlightForStep(stepIdx);
    const statuses = getAllCircleStatuses(state);

    this.renderer.render(state, highlight, statuses);
    this.updateChrome(state, statuses);
  }

  private updateChrome(
    state: PuzzleState,
    statuses: ReturnType<typeof getAllCircleStatuses>,
    opts: { preserveScrubber?: boolean } = {},
  ): void {
    const total = this.allSteps.length;
    const pos = this.currentTimelinePos;
    const isMid = total > 0 && !this.isAtIntegerPos(pos);
    const intPos = Math.round(pos);

    if (!opts.preserveScrubber) {
      this.scrubberEl.value = isMid ? pos.toFixed(2) : String(intPos);
      this.stepCounterEl.textContent = this.formatStepCounter(pos, total);
    }
    this.playBtnEl.textContent = this.isPlaying ? '⏸' : '▶';

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
    this.statusPillsEl
      .querySelector('#btn-pill-clear-scramble')
      ?.addEventListener('click', () => this.clearScramble());

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
      if (isMacroDefErr) {
        this.diagBannerEl
          .querySelector('#btn-move-macros-to-lib')
          ?.addEventListener('click', () => this.moveEditorMacrosToLibrary());
      }
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
      this.diagBannerEl.querySelector('#btn-jump-block')?.addEventListener('click', () => {
        this.stopPlayback();
        this.jumpToStep(total);
      });
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

  // ---- Playback & Continuous Smooth Scrubbing ----

  private syncLivePlaybackUi(livePos: number): void {
    this.currentTimelinePos = livePos;
    const total = this.allSteps.length;
    this.scrubberEl.value = this.isAtIntegerPos(livePos)
      ? String(Math.round(livePos))
      : livePos.toFixed(2);
    this.stepCounterEl.textContent = this.formatStepCounter(livePos, total);
  }

  private scrubToPosition(rawPos: number): void {
    const total = this.allSteps.length;
    const pos = Math.max(0, Math.min(total, Number.isFinite(rawPos) ? rawPos : 0));
    this.animTargetPos = null;
    this.clearCyclePreview();

    if (total === 0 || this.isAtIntegerPos(pos)) {
      this.jumpToStep(Math.round(pos));
      return;
    }

    const stepIdx = Math.min(total - 1, Math.floor(pos));
    const frac = pos - stepIdx;
    const step = this.allSteps[stepIdx];
    const fromState = this.getStateAtIntegerStep(stepIdx);
    this.currentTimelinePos = pos;

    const changedStep = this.lastScrubBaseStep !== stepIdx;
    const statuses = changedStep ? getAllCircleStatuses(fromState) : undefined;
    this.renderer.renderScrubFrame(fromState, step, frac, statuses);

    if (changedStep) {
      this.lastScrubBaseStep = stepIdx;
      this.updateChrome(fromState, statuses!);
    } else {
      this.scrubberEl.value = pos.toFixed(2);
      this.stepCounterEl.textContent = this.formatStepCounter(pos, total);
      const movePill = this.statusPillsEl.querySelector<HTMLElement>('#status-move-pill');
      if (movePill) {
        const macroTag = step.macroStack.length > 0 ? ` (${step.macroStack.join(' › ')})` : '';
        movePill.textContent = `Move: ${step.moveLabel} (${Math.round(frac * 100)}%)${macroTag}`;
      }
    }
  }

  private jumpToStep(stepIdx: number): void {
    const clamped = Math.max(0, Math.min(this.allSteps.length, Math.round(stepIdx)));
    this.animTargetPos = null;
    this.lastScrubBaseStep = -1;
    this.currentTimelinePos = clamped;
    this.renderCurrentStep();
  }

  private turnDurationMs(angleDeg: number, fastForwarded?: boolean, baseMs = 360): number {
    if (fastForwarded) return 0;
    const angleFactor = 0.65 + 0.35 * (Math.min(Math.abs(angleDeg), 180) / 72);
    return Math.round((baseMs * angleFactor) / this.speedMultiplier);
  }

  private stepForward(onDone?: () => void): void {
    this.flushPendingEval();
    if (!this.isPlaying && this.animTargetPos !== null && this.animTargetPos > this.currentTimelinePos) {
      this.currentTimelinePos = this.animTargetPos;
    }
    const total = this.allSteps.length;
    if (this.currentTimelinePos >= total - 1e-4) {
      this.animTargetPos = null;
      this.currentTimelinePos = total;
      onDone?.();
      return;
    }

    const stepIdx = Math.min(total - 1, Math.floor(this.currentTimelinePos + 1e-4));
    const startFrac = Math.max(0, Math.min(1, this.currentTimelinePos - stepIdx));
    const fromState = this.getStateAtIntegerStep(stepIdx);
    const step = this.allSteps[stepIdx];
    const targetPos = stepIdx + 1;
    this.animTargetPos = targetPos;
    this.lastScrubBaseStep = -1;

    const highlightAfter = this.getHighlightForStep(targetPos);
    const statusesAfter = getAllCircleStatuses(step.stateAfter);
    const fullMs = this.turnDurationMs(step.angleDeg, step.fastForwarded, 360);
    const durationMs = Math.round(fullMs * (1 - startFrac));

    if (durationMs > 16) {
      this.updateChrome(step.stateAfter, statusesAfter, { preserveScrubber: true });
    }

    this.renderer.animateTurn(
      {
        fromState,
        toState: step.stateAfter,
        angleDeg: step.angleDeg,
        pivot: step.pivot,
        movedPieceIds: step.movedPieceIds,
        durationMs,
        startFrac,
        endFrac: 1,
        onProgress: (u) => this.syncLivePlaybackUi(stepIdx + u),
        ...(step.flipAxis ? { flipAxis: step.flipAxis } : {}),
      },
      highlightAfter,
      () => {
        this.animTargetPos = null;
        this.currentTimelinePos = targetPos;
        this.updateChrome(step.stateAfter, statusesAfter);
        onDone?.();
      },
      statusesAfter,
    );
  }

  private stepBackward(): void {
    this.flushPendingEval();
    if (!this.isPlaying && this.animTargetPos !== null && this.animTargetPos < this.currentTimelinePos) {
      this.currentTimelinePos = this.animTargetPos;
    }
    if (this.currentTimelinePos <= 1e-4) {
      this.animTargetPos = null;
      this.currentTimelinePos = 0;
      return;
    }

    const mid = !this.isAtIntegerPos();
    const stepIdx = mid
      ? Math.floor(this.currentTimelinePos)
      : Math.round(this.currentTimelinePos) - 1;
    const startFrac = mid ? this.currentTimelinePos - stepIdx : 1;
    const step = this.allSteps[stepIdx];
    const fromState = this.getStateAtIntegerStep(stepIdx);
    const targetPos = stepIdx;
    this.animTargetPos = targetPos;
    this.lastScrubBaseStep = -1;

    const highlightAfter = this.getHighlightForStep(targetPos);
    const statusesAfter = getAllCircleStatuses(fromState);
    const fullMs = this.turnDurationMs(step.angleDeg, step.fastForwarded, 320);
    const durationMs = Math.round(fullMs * startFrac);

    if (durationMs > 16) {
      this.updateChrome(fromState, statusesAfter, { preserveScrubber: true });
    }

    this.renderer.animateTurn(
      {
        fromState,
        toState: step.stateAfter,
        angleDeg: step.angleDeg,
        pivot: step.pivot,
        movedPieceIds: step.movedPieceIds,
        durationMs,
        startFrac,
        endFrac: 0,
        onProgress: (u) => this.syncLivePlaybackUi(stepIdx + u),
        ...(step.flipAxis ? { flipAxis: step.flipAxis } : {}),
      },
      highlightAfter,
      () => {
        this.animTargetPos = null;
        this.currentTimelinePos = targetPos;
        this.updateChrome(fromState, statusesAfter);
      },
      statusesAfter,
    );
  }

  private startPlayback(): void {
    this.flushPendingEval();
    if (this.allSteps.length === 0) return;
    if (this.currentTimelinePos >= this.allSteps.length - 1e-4) {
      this.jumpToStep(0);
    }
    this.isPlaying = true;
    this.playBtnEl.textContent = '⏸';

    const playNext = () => {
      if (!this.isPlaying) return;
      if (this.currentTimelinePos >= this.allSteps.length - 1e-4) {
        this.stopPlayback();
        return;
      }
      this.stepForward(() => {
        if (!this.isPlaying) return;
        const pauseMs = Math.round(70 / this.speedMultiplier);
        this.playTimerId = window.setTimeout(playNext, pauseMs);
      });
    };

    playNext();
  }

  private stopPlayback(preserveTarget = false): void {
    this.isPlaying = false;
    if (!preserveTarget) this.animTargetPos = null;
    if (this.playTimerId !== null) {
      clearTimeout(this.playTimerId);
      this.playTimerId = null;
    }
    this.renderer?.cancelAnimation();
    if (this.playBtnEl) this.playBtnEl.textContent = '▶';
  }

  private handleCursorMove(cursorPos: number): void {
    if (this.isPlaying || this.allSteps.length === 0) return;
    let target = 0;
    for (let i = 0; i < this.allSteps.length; i++) {
      if (this.allSteps[i].topSpan.start < cursorPos) target = i + 1;
      else break;
    }
    if (Math.abs(target - this.currentTimelinePos) > 1e-4) {
      this.jumpToStep(target);
    }
  }

  // ---- Interactive Moves ----

  private handleCircleClick(
    circleId: string,
    direction: 1 | -1,
    layerOpt?: MoveLayerSpec,
  ): void {
    this.flushPendingEval();
    this.stopPlayback();
    if (Math.abs(this.currentTimelinePos - this.allSteps.length) > 1e-4) {
      this.jumpToStep(this.allSteps.length);
    }
    const curState = this.evalResult.finalState;
    const status = getCircleStatus(curState, circleId, layerOpt);

    if (status.blocked) {
      this.renderer.flashBlocked(circleId, status.blockingPieceIds);
      const label = formatMoveToken(circleId, 1, layerOpt);
      this.showToast(`Circle ${label} is blocked by ${status.blockingPieceIds.length} piece(s)`);
      return;
    }

    const token = formatMoveToken(circleId, direction, layerOpt);
    this.appendInteractiveMove(token, {
      allowCoalesce: true,
      incrementalMove: (st) => turnCircleBySteps(st, circleId, direction, layerOpt),
    });
  }

  private appendInteractiveMove(
    token: string,
    options: {
      allowCoalesce?: boolean;
      incrementalMove?: (state: PuzzleState) => MoveResult;
    } = {},
  ): void {
    this.flushPendingEval();
    const prevCount = this.allSteps.length;
    const wasAtEnd = Math.abs(this.currentTimelinePos - prevCount) <= 1e-4;

    if (!wasAtEnd) {
      const len = this.editor.getValue().length;
      this.editor.textarea.selectionStart = len;
      this.editor.textarea.selectionEnd = len;
    }

    const prevFinalState = this.evalResult.finalState;
    const deltaAnim = options.incrementalMove?.(prevFinalState);

    const ta = this.editor.textarea;
    const curText = ta.value;
    this.clearCyclePreview();
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

    this.alg = this.editor.getValue();
    this.syncCleanPuzzleHash();

    this.evalResult = evaluateProgram(this.initialState, this.alg, this.macros, {
      solvedReference: this.solvedState,
      disallowMacroDefs: true,
    });
    this.allSteps = this.evalResult.steps;

    const newTotal = this.allSteps.length;
    this.scrubberEl.max = String(newTotal);
    this.lastScrubBaseStep = -1;
    this.animTargetPos = null;
    this.currentTimelinePos = newTotal;
    this.persistCurrentSession();

    const finalAfter = this.evalResult.finalState;
    const highlightAfter = this.getHighlightForStep(newTotal);

    if (deltaAnim && deltaAnim.ok && !this.evalResult.blocked) {
      const statusesAfter = getAllCircleStatuses(finalAfter);
      this.updateChrome(finalAfter, statusesAfter);
      this.renderer.animateTurn(
        {
          fromState: prevFinalState,
          toState: finalAfter,
          angleDeg: deltaAnim.angleDeg,
          pivot: deltaAnim.pivot,
          movedPieceIds: deltaAnim.movedPieceIds,
          durationMs: this.turnDurationMs(deltaAnim.angleDeg, false, 260),
          ...(deltaAnim.flipAxis ? { flipAxis: deltaAnim.flipAxis } : {}),
        },
        highlightAfter,
        undefined,
        statusesAfter,
      );
    } else if (newTotal === prevCount + 1) {
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
          durationMs: this.turnDurationMs(step.angleDeg, step.fastForwarded, 280),
          ...(step.flipAxis ? { flipAxis: step.flipAxis } : {}),
        },
        highlightAfter,
        undefined,
        statusesAfter,
      );
    } else {
      this.renderCurrentStep();
    }
  }

  // ---- Order Analysis & Sharing ----

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
  new RingTwistApp(appRoot);
}
