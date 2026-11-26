import './style.css';
import { interiorPointOfRegion } from './geom/arcRegion.ts';
import { Span } from './lang/ast.ts';
import {
  EvaluationResult,
  MacroLibraryEntry,
  analyzeAlgorithm,
  evaluateProgram,
} from './lang/evaluator.ts';
import { buildPuzzle } from './puzzle/builder.ts';
import { PUZZLE_CATALOG, getPuzzleSpec } from './puzzle/catalog.ts';
import {
  CyclePreviewResult,
  computeMacroCyclePreview,
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
  turnCircleNextUnblocked,
} from './puzzle/engine.ts';
import { RingTwistPuzzleDoc, exportPuzzleToRingTwistDoc } from './puzzle/format.ts';
import { compileRingTwistDoc } from './puzzle/formatBuilder.ts';
import { PuzzleSpec, PuzzleState } from './puzzle/types.ts';
import {
  CustomPuzzleModalController,
  createCustomPuzzleModal,
} from './ui/customPuzzleModal.ts';
import { AlgorithmEditor } from './ui/editor.ts';
import { createHelpModal } from './ui/helpModal.ts';
import { applyInteractiveMoveToText } from './ui/moveCoalesce.ts';
import { PuzzlePickerController, createPuzzlePickerModal } from './ui/puzzlePicker.ts';
import {
  UiMode,
  decodeShareHash,
  encodeShareHash,
  loadCustomPuzzles,
  loadMacros,
  loadSession,
  loadUiMode,
  saveCustomPuzzles,
  saveMacros,
  saveSession,
  saveUiMode,
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

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

interface MilestoneMark {
  label: string;
  charEnd: number;
  stepIndex: number;
}

function parseMilestones(
  src: string,
  steps: EvaluationResult['steps'],
): MilestoneMark[] {
  const marks: MilestoneMark[] = [];
  let offset = 0;
  const lines = src.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineEnd = offset + line.length;
    const m = /^\s*(?:\/\/|#)\s*@milestone(?:\s+(.*?))?\s*$/i.exec(line);
    if (m) {
      let stepIdx = 0;
      for (let i = 0; i < steps.length; i++) {
        if (steps[i].topSpan.start < lineEnd) stepIdx = i + 1;
        else break;
      }
      const rawLabel = (m[1] ?? '').trim();
      marks.push({
        label: rawLabel || `Milestone ${marks.length + 1}`,
        charEnd: lineEnd,
        stepIndex: stepIdx,
      });
    }
    offset = lineEnd + 1;
  }
  return marks;
}

class RingTwistApp {
  private puzzleCache = new Map<string, PuzzleState>();
  private customDocs: RingTwistPuzzleDoc[] = [];
  private customSpecs: PuzzleSpec[] = [];
  private currentSpec: PuzzleSpec;
  private solvedState: PuzzleState;
  private startState: PuzzleState;
  private uiMode: UiMode = 'explorer';
  private scrambleSeed = '';
  private scrambleMoves = 20;
  private solveElapsedMs = 0;
  private timerStartedAt: number | null = null;
  private timerIntervalId: number | null = null;
  private solveCompleted = false;
  private completionDismissed = false;
  private moveUndoStack: string[] = [];
  private cyclePreviewCache = new Map<string, CyclePreviewResult>();
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
  private lastMacroListKey = '';
  private lastMilestoneKey = '';

  // UI elements
  private renderer!: PuzzleSvgRenderer;
  private editor!: AlgorithmEditor;
  private helpModal!: { open: () => void; close: () => void };
  private puzzlePicker!: PuzzlePickerController;
  private customPuzzleModal!: CustomPuzzleModalController;
  private workspaceEl!: HTMLElement;
  private modeExplorerBtn!: HTMLButtonElement;
  private modeSolveBtn!: HTMLButtonElement;
  private solveBarEl!: HTMLElement;
  private solveSeedInput!: HTMLInputElement;
  private solveMovesInput!: HTMLInputElement;
  private solveClearScrambleBtn!: HTMLButtonElement;
  private solveMoveCountEl!: HTMLElement;
  private solveTimerBtn!: HTMLButtonElement;
  private solveTimerTextEl!: HTMLElement;
  private solveUndoBtn!: HTMLButtonElement;
  private milestonePopoverEl!: HTMLElement;
  private milestoneLabelInput!: HTMLInputElement;
  private milestonesBarEl!: HTMLElement;
  private cyclePreviewPillEl!: HTMLElement;
  private completionBannerEl!: HTMLElement;
  private stageHintEl!: HTMLElement;
  private puzzleBtnEl!: HTMLButtonElement;
  private rotCwBtnEl!: HTMLButtonElement;
  private rotCcwBtnEl!: HTMLButtonElement;
  private flipXBtnEl!: HTMLButtonElement;
  private flipYBtnEl!: HTMLButtonElement;
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
    this.customDocs = loadCustomPuzzles();
    this.customSpecs = this.compileCustomDocs(this.customDocs);
    this.uiMode = loadUiMode();

    const shared = decodeShareHash(window.location.hash);
    if (shared?.customDoc && !this.isBuiltInPuzzle(shared.customDoc.id)) {
      this.upsertCustomDoc(shared.customDoc, true);
    }

    const initialSpec = this.findPuzzleSpec(shared?.puzzleId ?? 'geranium-plus');
    this.currentSpec = initialSpec;
    this.solvedState = this.getOrBuildPuzzle(initialSpec);

    const saved = shared ? null : loadSession(initialSpec.id);
    this.scrambleSeed = shared?.scrambleSeed ?? saved?.scrambleSeed ?? '';
    this.scrambleMoves = shared?.scrambleMoves ?? saved?.scrambleMoves ?? 20;
    this.solveElapsedMs = saved?.elapsedMs ?? 0;
    this.solveCompleted = saved?.solved ?? false;
    this.startState = this.computeStartState(
      this.solvedState,
      this.scrambleSeed,
      this.scrambleMoves,
    );

    this.macros = shared?.macros ?? loadMacros(initialSpec.id);
    this.evalResult = evaluateProgram(this.startState, '', this.macros, {
      solvedReference: this.solvedState,
    });

    this.mountDOM(root);
    this.helpModal = createHelpModal();
    this.customPuzzleModal = createCustomPuzzleModal({
      isBuiltInId: (id) => this.isBuiltInPuzzle(id),
      onSave: (doc) => this.saveAndSelectCustomPuzzle(doc),
      onToast: (msg) => this.showToast(msg),
    });
    this.puzzlePicker = createPuzzlePickerModal({
      getPuzzles: () => this.getAllPuzzles(),
      isCustomPuzzle: (id) => this.customDocs.some((d) => d.id === id),
      getOrBuildPuzzle: (spec) => this.getOrBuildPuzzle(spec),
      getCurrentPuzzleId: () => this.currentSpec.id,
      onSelect: (puzzleId) => this.switchPuzzle(puzzleId),
      onOpenStudio: (forkSpec) => this.openPuzzleStudio(forkSpec),
      onDeleteCustom: (puzzleId) => this.deleteCustomPuzzle(puzzleId),
    });

    const initialAlg = shared ? shared.alg : (saved?.alg ?? '');
    this.editor.setValue(initialAlg);
    this.applyUiMode(this.uiMode, false);
    this.syncPuzzleButton();
    this.syncSolveBar();
    this.syncSolvedRefCard();
    this.renderSamples();
    this.renderMacroList();
    this.reevaluate(true, { suppressAutoStart: true });
    this.bindGlobalShortcuts();
    window.addEventListener('hashchange', () => this.applySharedHash());
    window.addEventListener('beforeunload', () => this.persistCurrentSession());
  }

  private computeStartState(solved: PuzzleState, seed: string, moves: number): PuzzleState {
    const clean = seed.trim();
    if (!clean) return solved;
    const clampedMoves = Math.max(4, Math.min(80, Math.round(moves) || 20));
    const seq = generateScramble(solved, clampedMoves, clean);
    const ev = evaluateProgram(solved, seq);
    return ev.finalState;
  }

  private isBuiltInPuzzle(id: string): boolean {
    return PUZZLE_CATALOG.some((p) => p.id === id);
  }

  private getAllPuzzles(): PuzzleSpec[] {
    return [...PUZZLE_CATALOG, ...this.customSpecs];
  }

  private findPuzzleSpec(id: string): PuzzleSpec {
    return this.customSpecs.find((p) => p.id === id) ?? getPuzzleSpec(id);
  }

  private compileCustomDocs(docs: RingTwistPuzzleDoc[]): PuzzleSpec[] {
    const specs: PuzzleSpec[] = [];
    for (const doc of docs) {
      try {
        specs.push(compileRingTwistDoc(doc));
      } catch {
        // Skip invalid persisted custom doc rather than breaking startup
      }
    }
    return specs;
  }

  private upsertCustomDoc(doc: RingTwistPuzzleDoc, persist: boolean): void {
    const normalized: RingTwistPuzzleDoc = { ...doc, category: 'Custom' };
    const idx = this.customDocs.findIndex((d) => d.id === normalized.id);
    if (idx >= 0) {
      this.customDocs[idx] = normalized;
    } else {
      this.customDocs.push(normalized);
    }
    this.customSpecs = this.compileCustomDocs(this.customDocs);
    this.puzzleCache.delete(normalized.id);
    this.puzzlePicker?.invalidateThumb(normalized.id);
    if (persist) {
      saveCustomPuzzles(this.customDocs);
    }
  }

  private saveAndSelectCustomPuzzle(doc: RingTwistPuzzleDoc): void {
    this.upsertCustomDoc(doc, true);
    this.switchPuzzle(doc.id);
    this.showToast(`Loaded custom puzzle "${doc.name}"`);
  }

  private openPuzzleStudio(forkSpec?: PuzzleSpec): void {
    if (!forkSpec) {
      this.customPuzzleModal.open();
      return;
    }
    const existingCustom = this.customDocs.find((d) => d.id === forkSpec.id);
    if (existingCustom) {
      this.customPuzzleModal.open(
        existingCustom,
        `Editing custom puzzle "${forkSpec.name}"`,
      );
      return;
    }
    const state = this.getOrBuildPuzzle(forkSpec);
    const exported = exportPuzzleToRingTwistDoc(state, interiorPointOfRegion);
    this.customPuzzleModal.open(
      exported,
      `Inspecting "${forkSpec.name}" — click Load & Save to fork as a Custom puzzle`,
    );
  }

  private deleteCustomPuzzle(puzzleId: string): void {
    const target = this.customDocs.find((d) => d.id === puzzleId);
    this.customDocs = this.customDocs.filter((d) => d.id !== puzzleId);
    this.customSpecs = this.compileCustomDocs(this.customDocs);
    saveCustomPuzzles(this.customDocs);
    this.puzzleCache.delete(puzzleId);
    this.puzzlePicker.invalidateThumb(puzzleId);
    if (this.currentSpec.id === puzzleId) {
      this.switchPuzzle('geranium-plus');
    }
    this.showToast(
      target ? `Deleted custom puzzle "${target.name}"` : 'Deleted custom puzzle',
    );
  }

  private applySharedHash(): void {
    const shared = decodeShareHash(window.location.hash);
    if (!shared) return;
    if (shared.customDoc && !this.isBuiltInPuzzle(shared.customDoc.id)) {
      this.upsertCustomDoc(shared.customDoc, true);
    }
    this.pauseTimer(false);
    this.cancelPendingEval();
    this.stopPlayback();
    this.hideAnalysisBanner();
    this.currentSpec = this.findPuzzleSpec(shared.puzzleId);
    this.solvedState = this.getOrBuildPuzzle(this.currentSpec);
    this.scrambleSeed = shared.scrambleSeed ?? '';
    this.scrambleMoves = shared.scrambleMoves ?? 20;
    this.startState = this.computeStartState(
      this.solvedState,
      this.scrambleSeed,
      this.scrambleMoves,
    );
    this.solveElapsedMs = 0;
    this.solveCompleted = false;
    this.completionDismissed = false;
    this.moveUndoStack = [];
    this.cyclePreviewCache.clear();
    this.macros = shared.macros ?? loadMacros(this.currentSpec.id);
    this.lastMacroListKey = '';
    this.lastMilestoneKey = '';
    this.editor.setValue(shared.alg);
    this.syncPuzzleButton();
    this.syncSolveBar();
    this.syncSolvedRefCard();
    this.renderSamples();
    this.reevaluate(true, { suppressAutoStart: true });
    this.showToast(`Loaded shared ${this.currentSpec.name} state`);
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
            <h1>RingTwist</h1>
            <div class="subtitle">Text-first 2D twisty circle puzzle simulator</div>
          </div>
        </div>
        <div class="topbar-controls">
          <button type="button" class="book-btn" id="puzzle-picker-btn" title="Choose a puzzle">
            <span class="book-btn-dot"></span>
            <span class="book-btn-name" id="puzzle-picker-name"></span>
            <span class="book-btn-meta" id="puzzle-picker-meta"></span>
          </button>
          <div class="mode-toggle" role="group" aria-label="Workspace mode">
            <button type="button" class="mode-btn" id="btn-mode-explorer" data-mode="explorer" title="Explorer Mode: script-first sequence discovery and order analysis">Explorer</button>
            <button type="button" class="mode-btn" id="btn-mode-solve" data-mode="solve" title="Solve Mode: large stage, separate scramble seed, timer, milestones, and macro toolbar">Solve</button>
          </div>
          <div class="scramble-wrap">
            <button type="button" class="btn" id="btn-scramble" aria-haspopup="true" aria-expanded="false" title="Start a repeatable seeded scramble">Scramble ▾</button>
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
                <input type="number" id="scramble-moves" min="4" max="80" value="20" />
              </div>
              <div class="sp-actions">
                <button type="button" class="btn btn-sm" id="btn-scramble-as-text" title="Insert raw scramble moves directly into the script editor">Insert as text</button>
                <button type="submit" class="btn btn-primary btn-sm">Start Scramble</button>
              </div>
            </form>
          </div>
          <button class="btn" id="btn-reset" title="Clear transcript (click again to clear active scramble)">Reset</button>
          <button class="btn" id="btn-share" title="Copy shareable link with puzzle, scramble seed, moves, and macros">Share</button>
          <button class="btn btn-primary" id="btn-help" title="Notation and controls guide">? Help</button>
        </div>
      </header>

      <main class="workspace" id="workspace">
        <section class="card puzzle-pane">
          <div class="solve-bar" id="solve-bar" hidden>
            <form class="solve-seed-form" id="solve-seed-form">
              <span class="solve-bar-label">Seed</span>
              <input type="text" class="solve-seed-input" id="solve-seed-input" autocomplete="off" spellcheck="false" placeholder="empty = solved" title="Free-text scramble seed (separate from your move transcript)" />
              <input type="number" class="solve-moves-input" id="solve-moves-input" min="4" max="80" value="20" title="Scramble move count" aria-label="Scramble moves" />
              <button type="button" class="btn btn-sm" id="btn-solve-rand-seed" title="Roll a random scramble seed and apply">🎲</button>
              <button type="submit" class="btn btn-primary btn-sm" id="btn-solve-apply-seed" title="Apply scramble seed">Apply</button>
              <button type="button" class="btn btn-sm" id="btn-solve-clear-seed" title="Clear scramble and return to solved start state" hidden>✕</button>
            </form>
            <div class="solve-hud">
              <span class="solve-stat" title="Solve moves in transcript (excluding scramble)"><strong id="solve-move-count">0</strong> moves</span>
              <button type="button" class="btn btn-sm solve-timer-btn" id="btn-solve-timer" title="Click to pause or resume solve timer">⏱ <span id="solve-timer-text">00:00</span></button>
              <button type="button" class="btn btn-sm" id="btn-solve-undo" title="Undo last interactive move" disabled>↶ Undo</button>
              <div class="milestone-wrap">
                <button type="button" class="btn btn-sm" id="btn-add-milestone" title="Insert a named milestone comment at this point in your solve">🚩 Milestone</button>
                <form class="milestone-popover" id="milestone-popover" hidden>
                  <div class="sp-title">Add Solve Milestone</div>
                  <input type="text" id="milestone-label-input" autocomplete="off" placeholder="e.g. outer ring done" />
                  <div class="sp-actions">
                    <button type="submit" class="btn btn-primary btn-sm">Add Comment</button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          <div class="status-strip">
            <div class="status-pills" id="status-pills"></div>
            <div class="circle-chips" id="circle-chips" title="Click a free circle chip to append a CW turn (Shift-click for CCW)"></div>
          </div>

          <div class="diagnostic-banner error" id="diag-banner"></div>
          <div class="diagnostic-banner analysis" id="analysis-banner"></div>

          <div class="stage-wrap" id="stage-wrap">
            <div class="completion-banner" id="completion-banner" hidden></div>
            <div class="stage-overlay-tl">
              <button class="btn btn-sm" id="btn-rot-ccw" title="Whole-puzzle rotation CCW (z')">↺ z'</button>
              <button class="btn btn-sm" id="btn-rot-cw" title="Whole-puzzle rotation CW (z)">↻ z</button>
              <button class="btn btn-sm" id="btn-flip-x" title="Flip puzzle top↔bottom (x)">⇅ x</button>
              <button class="btn btn-sm" id="btn-flip-y" title="Flip puzzle left↔right (y)">⇄ y</button>
            </div>
            <div class="stage-overlay-tr">
              <button type="button" class="btn btn-sm solved-peek-btn" id="btn-solved-peek" title="Toggle a reference preview of the solved puzzle">👁 Solved</button>
              <label class="click-mode-label" title="When checked, clicking a circle inserts A> / A< (next unblocked alignment) instead of 1 stop">
                <input type="checkbox" id="chk-click-next" />
                Click uses &gt;/&lt;
              </label>
            </div>
            <div class="cycle-preview-pill" id="cycle-preview-pill" hidden></div>
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
            <div class="stage-hint" id="stage-hint">Click circle: CW · Shift/Right-click: CCW · Scroll: turn</div>
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
              <h2 class="section-title" id="editor-section-title">Algorithm &amp; Script</h2>
              <div class="editor-actions">
                <label class="click-mode-label explorer-only" title="Moving your text cursor previews the puzzle at that step">
                  <input type="checkbox" id="chk-cursor-sync" checked />
                  Cursor sync
                </label>
                <button class="btn btn-sm explorer-only" id="btn-analyze" title="Compute exact order and cycle structure from current start state">Analyze Order</button>
                <button class="btn btn-sm" id="btn-editor-milestone" title="Add a // @milestone comment to mark a sub-goal">🚩 Milestone</button>
                <button class="btn btn-sm" id="btn-save-sel" title="Save selected text (or whole sequence) as a macro">+ Save Macro</button>
              </div>
            </div>

            <div class="milestones-bar" id="milestones-bar" hidden></div>

            <div id="editor-mount"></div>

            <div class="samples-row explorer-only" id="samples-row"></div>
          </section>

          <section class="card macros-card">
            <div class="section-header">
              <h2 class="section-title">Macro Library <span class="macro-hover-hint">hover to preview cycles</span></h2>
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

    this.workspaceEl = root.querySelector('#workspace')!;
    this.modeExplorerBtn = root.querySelector('#btn-mode-explorer')!;
    this.modeSolveBtn = root.querySelector('#btn-mode-solve')!;
    this.solveBarEl = root.querySelector('#solve-bar')!;
    this.solveSeedInput = root.querySelector('#solve-seed-input')!;
    this.solveMovesInput = root.querySelector('#solve-moves-input')!;
    this.solveClearScrambleBtn = root.querySelector('#btn-solve-clear-seed')!;
    this.solveMoveCountEl = root.querySelector('#solve-move-count')!;
    this.solveTimerBtn = root.querySelector('#btn-solve-timer')!;
    this.solveTimerTextEl = root.querySelector('#solve-timer-text')!;
    this.solveUndoBtn = root.querySelector('#btn-solve-undo')!;
    this.milestonePopoverEl = root.querySelector('#milestone-popover')!;
    this.milestoneLabelInput = root.querySelector('#milestone-label-input')!;
    this.milestonesBarEl = root.querySelector('#milestones-bar')!;
    this.cyclePreviewPillEl = root.querySelector('#cycle-preview-pill')!;
    this.completionBannerEl = root.querySelector('#completion-banner')!;
    this.stageHintEl = root.querySelector('#stage-hint')!;
    this.puzzleBtnEl = root.querySelector('#puzzle-picker-btn')!;
    this.rotCwBtnEl = root.querySelector('#btn-rot-cw')!;
    this.rotCcwBtnEl = root.querySelector('#btn-rot-ccw')!;
    this.flipXBtnEl = root.querySelector('#btn-flip-x')!;
    this.flipYBtnEl = root.querySelector('#btn-flip-y')!;
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
      onCircleClick: (cid, dir, layerOpt) => this.handleCircleClick(cid, dir, layerOpt),
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
      this.closeMilestonePopover();
      this.puzzlePicker.open();
    });

    this.modeExplorerBtn.addEventListener('click', () => this.applyUiMode('explorer', true));
    this.modeSolveBtn.addEventListener('click', () => this.applyUiMode('solve', true));

    const rollSeed = () => String(Math.floor(10000 + Math.random() * 90000));
    this.scrambleSeedInput.value = this.scrambleSeed || rollSeed();

    const scrambleBtn = root.querySelector<HTMLButtonElement>('#btn-scramble')!;
    const openScramblePopover = () => {
      this.scrambleSeedInput.value = this.scrambleSeed || rollSeed();
      this.scrambleMovesInput.value = String(this.scrambleMoves);
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
      this.closeMilestonePopover();
      if (this.scramblePopoverEl.hidden) openScramblePopover();
      else closeScramblePopover();
    });

    root.querySelector('#btn-rand-seed')!.addEventListener('click', () => {
      this.scrambleSeedInput.value = rollSeed();
      this.scrambleSeedInput.focus();
    });

    // Insert raw moves into editor (legacy Explorer option)
    root.querySelector('#btn-scramble-as-text')!.addEventListener('click', () => {
      this.stopPlayback();
      const rawSeed = this.scrambleSeedInput.value.trim() || rollSeed();
      this.scrambleSeedInput.value = rawSeed;
      const moveCount = Math.max(
        4,
        Math.min(80, parseInt(this.scrambleMovesInput.value, 10) || 20),
      );
      this.scrambleMovesInput.value = String(moveCount);
      this.clearScrambleStateOnly();
      const scramble = generateScramble(this.solvedState, moveCount, rawSeed);
      const script = `// Scramble (seed: ${rawSeed}, ${moveCount} moves)\n${scramble}\n\n// Solve below:\n`;
      this.editor.setValue(script);
      this.reevaluate(true);
      closeScramblePopover();
      this.editor.textarea.focus();
      this.editor.textarea.selectionStart = script.length;
      this.editor.textarea.selectionEnd = script.length;
      this.showToast(`Inserted ${moveCount}-move scramble text (seed: ${rawSeed})`);
    });

    this.scramblePopoverEl.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const rawSeed = this.scrambleSeedInput.value.trim() || rollSeed();
      const moveCount = Math.max(
        4,
        Math.min(80, parseInt(this.scrambleMovesInput.value, 10) || 20),
      );
      this.startNewScramble(rawSeed, moveCount);
      closeScramblePopover();
    });

    // Solve bar seed form
    root.querySelector<HTMLFormElement>('#solve-seed-form')!.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const rawSeed = this.solveSeedInput.value.trim();
      const moveCount = Math.max(
        4,
        Math.min(80, parseInt(this.solveMovesInput.value, 10) || 20),
      );
      if (!rawSeed) {
        this.clearScramble();
      } else {
        this.startNewScramble(rawSeed, moveCount);
      }
    });

    root.querySelector('#btn-solve-rand-seed')!.addEventListener('click', () => {
      const seed = rollSeed();
      const moveCount = Math.max(
        4,
        Math.min(80, parseInt(this.solveMovesInput.value, 10) || 20),
      );
      this.startNewScramble(seed, moveCount);
    });

    this.solveClearScrambleBtn.addEventListener('click', () => {
      this.clearScramble();
    });

    this.solveTimerBtn.addEventListener('click', () => {
      if (this.timerStartedAt !== null) {
        this.pauseTimer(true);
      } else if (!this.solveCompleted) {
        this.startTimer();
      }
    });

    this.solveUndoBtn.addEventListener('click', () => {
      this.undoLastInteractiveChange();
    });

    // Milestone popover wiring
    const milestoneBtn = root.querySelector<HTMLButtonElement>('#btn-add-milestone')!;
    const editorMilestoneBtn = root.querySelector<HTMLButtonElement>('#btn-editor-milestone')!;
    const openMilestonePopover = () => {
      const existing = parseMilestones(this.editor.getValue(), this.evalResult.steps);
      this.milestoneLabelInput.value = `Milestone ${existing.length + 1}`;
      this.milestonePopoverEl.hidden = false;
      this.milestoneLabelInput.focus();
      this.milestoneLabelInput.select();
    };
    const closeMilestonePopover = () => {
      this.milestonePopoverEl.hidden = true;
    };
    this.closeMilestonePopover = closeMilestonePopover;

    milestoneBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeScramblePopover();
      if (this.milestonePopoverEl.hidden) openMilestonePopover();
      else closeMilestonePopover();
    });
    editorMilestoneBtn.addEventListener('click', () => {
      const existing = parseMilestones(this.editor.getValue(), this.evalResult.steps);
      const label = window.prompt('Milestone label:', `Milestone ${existing.length + 1}`);
      if (label !== null) {
        this.insertMilestoneComment(label.trim() || `Milestone ${existing.length + 1}`);
      }
    });
    this.milestonePopoverEl.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const label = this.milestoneLabelInput.value.trim() || 'Milestone';
      this.insertMilestoneComment(label);
      closeMilestonePopover();
    });

    document.addEventListener('click', (ev) => {
      if (
        !this.scramblePopoverEl.hidden &&
        !this.scramblePopoverEl.contains(ev.target as Node) &&
        ev.target !== scrambleBtn
      ) {
        closeScramblePopover();
      }
      if (
        !this.milestonePopoverEl.hidden &&
        !this.milestonePopoverEl.contains(ev.target as Node) &&
        ev.target !== milestoneBtn
      ) {
        closeMilestonePopover();
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
      this.hideAnalysisBanner();
      const curText = this.editor.getValue().trim();
      if (curText.length === 0 && this.scrambleSeed) {
        this.clearScramble();
        return;
      }
      if (curText.length > 0) this.pushUndoSnapshot(this.editor.getValue());
      this.editor.setValue('');
      this.resetTimer();
      this.solveCompleted = false;
      this.completionDismissed = false;
      this.reevaluate(true, { suppressAutoStart: true });
      this.showToast(
        this.scrambleSeed
          ? `Cleared transcript (seed "${this.scrambleSeed}" kept — click Reset again to clear scramble)`
          : 'Reset to solved state',
      );
    });

    root.querySelector('#btn-share')!.addEventListener('click', () => {
      this.shareCurrentState();
    });

    root.querySelector('#btn-help')!.addEventListener('click', () => {
      this.helpModal.open();
    });

    // Whole-puzzle rotation & mirror-flip quick buttons
    root.querySelector('#btn-rot-cw')!.addEventListener('click', () => {
      this.appendInteractiveMove('z', {
        allowCoalesce: true,
        incrementalMove: (st) => rotateWholePuzzle(st, 1),
      });
    });
    root.querySelector('#btn-rot-ccw')!.addEventListener('click', () => {
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
      this.flushPendingEval();
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

      const reserved = new Set([
        ...this.currentSpec.circles.map((c) => c.id),
        ...this.currentSpec.circles
          .filter((c) => c.layerRadii && c.layerRadii.length > 1)
          .map((c) => c.id.toLowerCase()),
        'z',
      ]);
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
      this.cyclePreviewCache.clear();
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
        const reserved = new Set([
        ...this.currentSpec.circles.map((c) => c.id),
        ...this.currentSpec.circles
          .filter((c) => c.layerRadii && c.layerRadii.length > 1)
          .map((c) => c.id.toLowerCase()),
        'z',
      ]);
        const valid = parsed
          .filter(
            (m): m is MacroLibraryEntry =>
              typeof m?.name === 'string' && typeof m?.body === 'string',
          )
          .map((m) => ({
            name: m.name.trim(),
            body: m.body.trim(),
            ...(typeof m.note === 'string' ? { note: m.note } : {}),
          }))
          .filter(
            (m) =>
              /^[A-Za-z_][A-Za-z0-9_]*$/.test(m.name) &&
              m.body.length > 0 &&
              !reserved.has(m.name),
          );
        if (valid.length === 0) throw new Error('No valid non-reserved macros found');
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
      if (ev.key === 'Escape') {
        if (!this.scramblePopoverEl.hidden) {
          this.closeScramblePopover();
          return;
        }
        if (!this.milestonePopoverEl.hidden) {
          this.closeMilestonePopover();
          return;
        }
      }
      // Never override standard textbox editing shortcuts when user is typing in an input/textarea
      const activeTag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (activeTag === 'INPUT' && !ev.altKey) return;

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
  private closeMilestonePopover: () => void = () => {};

  private applyUiMode(mode: UiMode, persist: boolean): void {
    this.uiMode = mode;
    this.workspaceEl.classList.toggle('mode-solve', mode === 'solve');
    this.modeExplorerBtn.classList.toggle('active', mode === 'explorer');
    this.modeSolveBtn.classList.toggle('active', mode === 'solve');
    const titleEl = document.querySelector('#editor-section-title');
    if (titleEl) {
      titleEl.textContent = mode === 'solve' ? 'Solve Transcript' : 'Algorithm & Script';
    }
    this.syncSolveBar();
    if (persist) saveUiMode(mode);
  }

  private syncSolveBar(): void {
    const showBar = this.uiMode === 'solve' || this.scrambleSeed.length > 0;
    this.solveBarEl.hidden = !showBar;
    this.solveSeedInput.value = this.scrambleSeed;
    this.solveMovesInput.value = String(this.scrambleMoves);
    this.solveClearScrambleBtn.hidden = this.scrambleSeed.length === 0;
    this.solveUndoBtn.disabled = this.moveUndoStack.length === 0;
    this.updateTimerDisplay();
  }

  private getCurrentElapsedMs(): number {
    return this.solveElapsedMs + (this.timerStartedAt !== null ? Date.now() - this.timerStartedAt : 0);
  }

  private updateTimerDisplay(): void {
    if (!this.solveTimerTextEl) return;
    this.solveTimerTextEl.textContent = formatDuration(this.getCurrentElapsedMs());
    this.solveTimerBtn.classList.toggle('running', this.timerStartedAt !== null);
  }

  private startTimer(): void {
    if (this.timerStartedAt !== null) return;
    this.timerStartedAt = Date.now();
    if (this.timerIntervalId === null) {
      this.timerIntervalId = window.setInterval(() => this.updateTimerDisplay(), 250);
    }
    this.updateTimerDisplay();
  }

  private pauseTimer(persist: boolean): void {
    if (this.timerStartedAt !== null) {
      this.solveElapsedMs += Date.now() - this.timerStartedAt;
      this.timerStartedAt = null;
    }
    if (this.timerIntervalId !== null) {
      clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
    this.updateTimerDisplay();
    if (persist) this.persistCurrentSession();
  }

  private resetTimer(): void {
    this.pauseTimer(false);
    this.solveElapsedMs = 0;
    this.updateTimerDisplay();
  }

  private persistCurrentSession(): void {
    if (!this.editor) return;
    saveSession(this.currentSpec.id, {
      alg: this.editor.getValue(),
      ...(this.scrambleSeed
        ? { scrambleSeed: this.scrambleSeed, scrambleMoves: this.scrambleMoves }
        : {}),
      elapsedMs: this.getCurrentElapsedMs(),
      solved: this.solveCompleted,
    });
  }

  private clearScrambleStateOnly(): void {
    this.scrambleSeed = '';
    this.startState = this.solvedState;
    this.solveCompleted = false;
    this.completionDismissed = false;
    this.resetTimer();
    this.syncSolveBar();
  }

  private startNewScramble(seed: string, moves: number): void {
    this.stopPlayback();
    this.hideAnalysisBanner();
    this.clearCyclePreview();
    this.scrambleSeed = seed.trim();
    this.scrambleMoves = Math.max(4, Math.min(80, Math.round(moves) || 20));
    this.startState = this.computeStartState(
      this.solvedState,
      this.scrambleSeed,
      this.scrambleMoves,
    );
    this.moveUndoStack = [];
    this.cyclePreviewCache.clear();
    this.solveCompleted = false;
    this.completionDismissed = false;
    this.resetTimer();
    this.editor.setValue('');
    this.syncSolveBar();
    this.reevaluate(true, { suppressAutoStart: true });
    this.persistCurrentSession();
    this.showToast(`Scrambled (seed: ${this.scrambleSeed}, ${this.scrambleMoves} moves)`);
  }

  private clearScramble(): void {
    this.stopPlayback();
    this.hideAnalysisBanner();
    this.clearCyclePreview();
    this.clearScrambleStateOnly();
    this.reevaluate(true, { suppressAutoStart: true });
    this.persistCurrentSession();
    this.showToast('Cleared scramble — starting from solved state');
  }

  private pushUndoSnapshot(prevText: string): void {
    if (this.moveUndoStack[this.moveUndoStack.length - 1] === prevText) return;
    this.moveUndoStack.push(prevText);
    if (this.moveUndoStack.length > 100) this.moveUndoStack.shift();
    if (this.solveUndoBtn) this.solveUndoBtn.disabled = false;
  }

  private undoLastInteractiveChange(): void {
    const prev = this.moveUndoStack.pop();
    if (prev === undefined) return;
    this.stopPlayback();
    this.clearCyclePreview();
    this.editor.setValue(prev);
    const len = prev.length;
    this.editor.textarea.selectionStart = len;
    this.editor.textarea.selectionEnd = len;
    this.solveUndoBtn.disabled = this.moveUndoStack.length === 0;
    this.reevaluate(true, { suppressAutoStart: true });
  }

  private insertMilestoneComment(label: string): void {
    const cur = this.editor.getValue();
    this.pushUndoSnapshot(cur);
    const prefix = cur.length > 0 && !cur.endsWith('\n') ? '\n' : '';
    const next = `${cur}${prefix}// @milestone ${label}\n`;
    this.editor.setValue(next);
    this.editor.textarea.selectionStart = next.length;
    this.editor.textarea.selectionEnd = next.length;
    this.reevaluate(true, { suppressAutoStart: true });
    this.showToast(`Added milestone "${label}"`);
  }

  private getMergedMacros(): MacroLibraryEntry[] {
    const mergedMap = new Map<string, MacroLibraryEntry>();
    for (const m of this.macros) mergedMap.set(m.name, m);
    for (const [name, body] of Object.entries(this.evalResult.inlineMacros)) {
      mergedMap.set(name, { name, body });
    }
    return Array.from(mergedMap.values());
  }

  private previewMacroCycles(algSource: string, label: string): void {
    const curState = this.getDisplayedState();
    const cacheKey = `${hashPuzzleState(curState)}|${algSource}`;
    let res = this.cyclePreviewCache.get(cacheKey);
    if (!res) {
      res = computeMacroCyclePreview(curState, algSource, this.getMergedMacros(), label);
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
    this.renderer?.setCyclePreview(null);
    if (this.cyclePreviewPillEl) {
      this.cyclePreviewPillEl.hidden = true;
    }
  }

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
      ? `Whole-puzzle rotation CW by ${this.currentSpec.symmetryStepDeg}° (z)`
      : `${this.currentSpec.name} has no rotational symmetry`;
    this.rotCcwBtnEl.title = hasSym
      ? `Whole-puzzle rotation CCW by ${this.currentSpec.symmetryStepDeg}° (z')`
      : `${this.currentSpec.name} has no rotational symmetry`;

    const mirrorAxes = getSupportedMirrorAxes(this.solvedState);
    const hasFlipX = mirrorAxes.includes('x');
    const hasFlipY = mirrorAxes.includes('y');
    this.flipXBtnEl.disabled = !hasFlipX;
    this.flipYBtnEl.disabled = !hasFlipY;
    this.flipXBtnEl.title = hasFlipX
      ? 'Flip puzzle top↔bottom around horizontal x-axis (x)'
      : `${this.currentSpec.name} does not have top↔bottom (x) mirror symmetry`;
    this.flipYBtnEl.title = hasFlipY
      ? 'Flip puzzle left↔right around vertical y-axis (y)'
      : `${this.currentSpec.name} does not have left↔right (y) mirror symmetry`;

    const hasMultiLayer = this.currentSpec.circles.some(
      (c) => c.layerRadii && c.layerRadii.length > 1,
    );
    const hasExterior = this.currentSpec.circles.some((c) => c.turnRegion === 'outside');
    if (hasMultiLayer) {
      this.stageHintEl.textContent =
        'Inner disk: A · Outer ring: wide a (Alt+click/scroll: outer slice 2A) · Shift/Right-click: CCW';
    } else if (hasExterior) {
      this.stageHintEl.textContent =
        'Click inner circle or outer frame: CW · Shift/Right-click: CCW · Scroll: turn';
    } else {
      this.stageHintEl.textContent =
        'Click circle: CW · Shift/Right-click: CCW · Scroll: turn';
    }
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
    const inlineEntries = Object.entries(this.evalResult.inlineMacros);
    const key = JSON.stringify([this.macros, inlineEntries]);
    if (key === this.lastMacroListKey) return;
    this.lastMacroListKey = key;

    this.macroListEl.innerHTML = '';

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

      const insertBtn = row.querySelector<HTMLButtonElement>('[data-act="insert"]')!;
      const invBtn = row.querySelector<HTMLButtonElement>('[data-act="inv"]')!;
      const metaEl = row.querySelector<HTMLElement>('.macro-meta')!;

      const bindPreview = (el: HTMLElement, alg: string, lbl: string) => {
        el.addEventListener('mouseenter', () => this.previewMacroCycles(alg, lbl));
        el.addEventListener('mouseleave', () => this.clearCyclePreview());
        el.addEventListener('focus', () => this.previewMacroCycles(alg, lbl));
        el.addEventListener('blur', () => this.clearCyclePreview());
      };
      bindPreview(metaEl, entry.body, entry.name);
      bindPreview(insertBtn, entry.body, entry.name);
      bindPreview(invBtn, `(${entry.body})'`, `${entry.name}'`);

      insertBtn.addEventListener('click', () => {
        this.clearCyclePreview();
        this.appendInteractiveMove(entry.name, { allowCoalesce: false });
      });
      invBtn.addEventListener('click', () => {
        this.clearCyclePreview();
        this.appendInteractiveMove(`${entry.name}'`, { allowCoalesce: false });
      });
      row.querySelector('[data-act="order"]')?.addEventListener('click', () => {
        this.clearCyclePreview();
        const curState = this.getDisplayedState();
        this.runAnalysis(entry.body, curState, `Macro "${entry.name}"`);
      });
      row.querySelector('[data-act="del"]')?.addEventListener('click', () => {
        this.clearCyclePreview();
        this.macros = this.macros.filter((m) => m.name !== entry.name);
        saveMacros(this.currentSpec.id, this.macros);
        this.cyclePreviewCache.clear();
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
    this.pauseTimer(true);
    this.cancelPendingEval();
    this.stopPlayback();
    this.hideAnalysisBanner();
    this.clearCyclePreview();
    this.currentSpec = this.findPuzzleSpec(puzzleId);
    this.solvedState = this.getOrBuildPuzzle(this.currentSpec);

    const saved = loadSession(this.currentSpec.id);
    this.scrambleSeed = saved?.scrambleSeed ?? '';
    this.scrambleMoves = saved?.scrambleMoves ?? 20;
    this.solveElapsedMs = saved?.elapsedMs ?? 0;
    this.solveCompleted = saved?.solved ?? false;
    this.completionDismissed = false;
    this.moveUndoStack = [];
    this.cyclePreviewCache.clear();
    this.startState = this.computeStartState(
      this.solvedState,
      this.scrambleSeed,
      this.scrambleMoves,
    );

    this.macros = loadMacros(this.currentSpec.id);
    this.lastMacroListKey = '';
    this.lastMilestoneKey = '';
    this.editor.setValue(saved?.alg ?? '');
    this.syncPuzzleButton();
    this.syncSolveBar();
    this.syncSolvedRefCard();
    this.renderSamples();
    this.renderMacroList();
    this.reevaluate(true, { suppressAutoStart: true });
  }

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
    this.evalDebounceId = window.setTimeout(() => {
      this.evalDebounceId = null;
      this.reevaluate(true);
    }, 60);
  }

  private reevaluate(
    jumpToEnd: boolean,
    opts: { suppressAutoStart?: boolean } = {},
  ): void {
    this.cancelPendingEval();
    this.stopPlayback();
    this.clearCyclePreview();
    const src = this.editor.getValue();
    this.evalResult = evaluateProgram(this.startState, src, this.macros, {
      solvedReference: this.solvedState,
    });
    this.renderMacroList();
    this.renderMilestones();

    const maxStep = this.evalResult.steps.length;
    this.scrubberEl.max = String(maxStep);

    if (jumpToEnd) {
      this.currentStepIndex = maxStep;
    } else {
      this.currentStepIndex = Math.min(this.currentStepIndex, maxStep);
    }

    if (!opts.suppressAutoStart && this.scrambleSeed && maxStep > 0 && !this.solveCompleted) {
      this.startTimer();
    }
    this.checkSolveCompletion();
    this.renderCurrentStep();
    this.persistCurrentSession();
  }

  private renderMilestones(): void {
    const src = this.editor.getValue();
    const marks = parseMilestones(src, this.evalResult.steps);
    const key = JSON.stringify(marks);
    if (key === this.lastMilestoneKey) return;
    this.lastMilestoneKey = key;

    this.milestonesBarEl.innerHTML = '';
    if (marks.length === 0) {
      this.milestonesBarEl.hidden = true;
      return;
    }
    this.milestonesBarEl.hidden = false;
    const lbl = document.createElement('span');
    lbl.className = 'samples-label';
    lbl.textContent = 'Milestones:';
    this.milestonesBarEl.appendChild(lbl);

    for (const m of marks) {
      const chip = document.createElement('span');
      chip.className = 'milestone-chip';

      const jumpBtn = document.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.className = 'milestone-jump';
      jumpBtn.textContent = `🚩 ${m.label} (${m.stepIndex})`;
      jumpBtn.title = `Preview puzzle at milestone "${m.label}" (move ${m.stepIndex})`;
      jumpBtn.addEventListener('click', () => {
        this.stopPlayback();
        this.jumpToStep(m.stepIndex);
        this.editor.textarea.selectionStart = m.charEnd;
        this.editor.textarea.selectionEnd = m.charEnd;
      });

      const revBtn = document.createElement('button');
      revBtn.type = 'button';
      revBtn.className = 'milestone-revert';
      revBtn.textContent = '↩';
      revBtn.title = `Roll back transcript to milestone "${m.label}"`;
      revBtn.addEventListener('click', () => {
        const cur = this.editor.getValue();
        this.pushUndoSnapshot(cur);
        const truncated = cur.slice(0, m.charEnd).trimEnd() + '\n';
        this.editor.setValue(truncated);
        this.editor.textarea.selectionStart = truncated.length;
        this.editor.textarea.selectionEnd = truncated.length;
        this.reevaluate(true, { suppressAutoStart: true });
        this.showToast(`Reverted to milestone "${m.label}"`);
      });

      chip.append(jumpBtn, revBtn);
      this.milestonesBarEl.appendChild(chip);
    }
  }

  private checkSolveCompletion(): void {
    const solvedNow =
      this.scrambleSeed.length > 0 &&
      this.evalResult.steps.length > 0 &&
      !this.evalResult.blocked &&
      isPuzzleSolved(this.evalResult.finalState, this.solvedState);

    if (solvedNow && !this.solveCompleted) {
      this.solveCompleted = true;
      this.completionDismissed = false;
      this.pauseTimer(true);
    } else if (!solvedNow && this.solveCompleted) {
      this.solveCompleted = false;
      this.completionDismissed = false;
    }

    if (this.solveCompleted && !this.completionDismissed) {
      const moves = this.evalResult.steps.length;
      const timeStr = formatDuration(this.getCurrentElapsedMs());
      this.completionBannerEl.hidden = false;
      this.completionBannerEl.innerHTML = `
        <span class="completion-text">
          🎉 <strong>Solved!</strong> ${moves} moves · ${timeStr} · seed <code>${escapeHtml(this.scrambleSeed)}</code>
        </span>
        <div class="completion-actions">
          <button type="button" class="btn btn-primary btn-sm" id="btn-comp-share">Share Solve</button>
          <button type="button" class="btn btn-sm" id="btn-comp-new">New Scramble</button>
          <button type="button" class="solved-ref-icon" id="btn-comp-close" title="Dismiss">✕</button>
        </div>
      `;
      this.completionBannerEl.querySelector('#btn-comp-share')?.addEventListener('click', () => {
        this.shareCurrentState();
      });
      this.completionBannerEl.querySelector('#btn-comp-new')?.addEventListener('click', () => {
        const seed = String(Math.floor(10000 + Math.random() * 90000));
        this.startNewScramble(seed, this.scrambleMoves);
      });
      this.completionBannerEl.querySelector('#btn-comp-close')?.addEventListener('click', () => {
        this.completionDismissed = true;
        this.completionBannerEl.hidden = true;
      });
    } else {
      this.completionBannerEl.hidden = true;
    }
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
    if (this.solveMoveCountEl) this.solveMoveCountEl.textContent = String(total);
    if (this.solveUndoBtn) this.solveUndoBtn.disabled = this.moveUndoStack.length === 0;

    // Status pills
    const pills: string[] = [];
    const solvedNow = isPuzzleSolved(state, this.solvedState);
    if (solvedNow) {
      pills.push('<span class="pill pill-solved">✓ Solved</span>');
    } else if (this.scrambleSeed) {
      pills.push(`<span class="pill pill-scramble">Scrambled · ${escapeHtml(this.scrambleSeed)}</span>`);
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

    // Circle free/blocked chips (shows A, 2A, a separately for multi-layer concentric circles)
    this.circleChipsEl.innerHTML = '';
    for (const c of this.currentSpec.circles) {
      const chipSpecs: { label: string; layerOpt?: MoveLayerSpec; desc: string }[] =
        c.layerRadii && c.layerRadii.length > 1
          ? [
              { label: c.id, layerOpt: { layer: 1 }, desc: `Inner disk ${c.id}` },
              { label: `2${c.id}`, layerOpt: { layer: 2 }, desc: `Outer ring 2${c.id}` },
              { label: c.id.toLowerCase(), layerOpt: { wide: true }, desc: `Wide full circle ${c.id.toLowerCase()}` },
            ]
          : [{ label: c.id, desc: `Circle ${c.id}` }];

      for (const cs of chipSpecs) {
        const st = cs.layerOpt ? getCircleStatus(state, c.id, cs.layerOpt) : statuses[c.id];
        const chip = document.createElement('button');
        chip.className = `circle-chip ${st.blocked ? 'blocked' : 'free'}`;
        chip.textContent = `${cs.label} ${st.blocked ? '✕' : '✓'}`;
        chip.style.borderLeft = `3px solid ${c.color}`;
        chip.title = st.blocked
          ? `${cs.desc} blocked by ${st.blockingPieceIds.length} piece(s)`
          : `${cs.desc} free — click for CW, shift-click for CCW`;
        chip.addEventListener('click', (ev) => {
          this.handleCircleClick(c.id, ev.shiftKey ? -1 : 1, cs.layerOpt);
        });
        this.circleChipsEl.appendChild(chip);
      }
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

  private turnDurationMs(angleDeg: number, fastForwarded?: boolean, baseMs = 360): number {
    if (fastForwarded) return 0;
    // Scale duration cleanly with turn angle so angular speed stays consistent across 36°..180° turns
    const angleFactor = 0.65 + 0.35 * (Math.min(Math.abs(angleDeg), 180) / 72);
    return Math.round((baseMs * angleFactor) / this.speedMultiplier);
  }

  private stepForward(onDone?: () => void): void {
    this.flushPendingEval();
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

    const durationMs = this.turnDurationMs(step.angleDeg, step.fastForwarded, 360);
    this.renderer.animateTurn(
      {
        fromState,
        toState: step.stateAfter,
        angleDeg: step.angleDeg,
        pivot: step.pivot,
        movedPieceIds: step.movedPieceIds,
        durationMs,
        ...(step.flipAxis ? { flipAxis: step.flipAxis } : {}),
      },
      highlightAfter,
      onDone,
      statusesAfter,
    );
  }

  private stepBackward(): void {
    this.flushPendingEval();
    if (this.currentStepIndex <= 0) return;
    const step = this.evalResult.steps[this.currentStepIndex - 1];
    const fromState = step.stateAfter;
    this.currentStepIndex--;
    const toState = this.getDisplayedState();

    const highlightAfter = this.getHighlightForStep(this.currentStepIndex);
    const statusesAfter = getAllCircleStatuses(toState);
    this.updateChrome(toState, statusesAfter);

    const durationMs = this.turnDurationMs(step.angleDeg, step.fastForwarded, 320);
    this.renderer.animateTurn(
      {
        fromState,
        toState,
        angleDeg: -step.angleDeg,
        pivot: step.pivot,
        movedPieceIds: step.movedPieceIds,
        durationMs,
        ...(step.flipAxis ? { flipAxis: step.flipAxis } : {}),
      },
      highlightAfter,
      undefined,
      statusesAfter,
    );
  }

  private startPlayback(): void {
    this.flushPendingEval();
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
        const pauseMs = Math.round(70 / this.speedMultiplier);
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

  private handleCircleClick(
    circleId: string,
    direction: 1 | -1,
    layerOpt?: MoveLayerSpec,
  ): void {
    this.flushPendingEval();
    this.stopPlayback();
    // Interactive moves always append/coalesce at the end of the sequence, so validate
    // against `finalState` (and jump scrubber to end first if user had scrubbed earlier).
    if (this.currentStepIndex !== this.evalResult.steps.length) {
      this.jumpToStep(this.evalResult.steps.length);
    }
    const curState = this.evalResult.finalState;
    const status = getCircleStatus(curState, circleId, layerOpt);

    if (status.blocked) {
      this.renderer.flashBlocked(circleId, status.blockingPieceIds);
      const label = formatMoveToken(circleId, 1, layerOpt);
      this.showToast(
        `Circle ${label} is blocked by ${status.blockingPieceIds.length} piece(s)`,
      );
      return;
    }

    const useNext = this.clickUsesNextUnblocked;
    const base = formatMoveToken(circleId, 1, layerOpt);
    const token = useNext
      ? `${base}${direction === 1 ? '>' : '<'}`
      : formatMoveToken(circleId, direction, layerOpt);

    this.appendInteractiveMove(token, {
      allowCoalesce: true,
      incrementalMove: (st) =>
        useNext
          ? turnCircleNextUnblocked(st, circleId, direction, 1, layerOpt)
          : turnCircleBySteps(st, circleId, direction, layerOpt),
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
    this.pushUndoSnapshot(curText);
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

    this.evalResult = evaluateProgram(
      this.startState,
      this.editor.getValue(),
      this.macros,
      { solvedReference: this.solvedState },
    );
    this.renderMacroList();
    this.renderMilestones();

    const newTotal = this.evalResult.steps.length;
    this.scrubberEl.max = String(newTotal);
    this.currentStepIndex = newTotal;

    if (this.scrambleSeed && newTotal > 0 && !this.solveCompleted) {
      this.startTimer();
    }
    this.checkSolveCompletion();
    this.persistCurrentSession();

    const finalAfter = this.evalResult.finalState;
    const highlightAfter = this.getHighlightForStep(this.currentStepIndex);

    if (deltaAnim && deltaAnim.ok && !this.evalResult.blocked) {
      // Smoothly animate the incremental turn (works cleanly for append, merge B->B2, AND cancel B+B'!)
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
      const step = this.evalResult.steps[newTotal - 1];
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

  private runAnalysis(algSource: string, baseState: PuzzleState, label: string): void {
    // Merge sidebar macros + inline macros defined in the editor so analyzing a
    // selected macro call or inline macro body resolves all script-local macros.
    const mergedMap = new Map<string, MacroLibraryEntry>();
    for (const m of this.macros) mergedMap.set(m.name, m);
    for (const [name, body] of Object.entries(this.evalResult.inlineMacros)) {
      mergedMap.set(name, { name, body });
    }
    const res = analyzeAlgorithm(baseState, algSource, Array.from(mergedMap.values()));
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
    const customDoc = this.customDocs.find((d) => d.id === this.currentSpec.id);
    const hash = encodeShareHash({
      puzzleId: this.currentSpec.id,
      alg: this.editor.getValue(),
      macros: this.macros,
      ...(this.scrambleSeed
        ? { scrambleSeed: this.scrambleSeed, scrambleMoves: this.scrambleMoves }
        : {}),
      ...(customDoc ? { customDoc } : {}),
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
