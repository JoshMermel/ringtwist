import './style.css';
import { interiorPointOfRegion } from './geom/arcRegion.ts';
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
import {
  SolveMilestone,
  parseSolveTranscript,
  serializeSolveTranscript,
} from './puzzle/solveStack.ts';
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
  loadExploreSession,
  loadLastPuzzleId,
  loadMacros,
  loadSolveSession,
  loadUiMode,
  saveCustomPuzzles,
  saveExploreSession,
  saveLastPuzzleId,
  saveMacros,
  saveSolveSession,
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

function rollRandomSeed(): string {
  return String(Math.floor(10000 + Math.random() * 90000));
}

interface CompiledMilestone {
  label: string;
  alg: string;
  steps: ExecutedStep[];
  stateBefore: PuzzleState;
  stateAfter: PuzzleState;
  startStep: number;
  endStep: number;
  error?: string;
}

interface SolveUndoEntry {
  milestones: SolveMilestone[];
  activeAlg: string;
}

class RingTwistApp {
  private puzzleCache = new Map<string, PuzzleState>();
  private customDocs: RingTwistPuzzleDoc[] = [];
  private customSpecs: PuzzleSpec[] = [];
  private currentSpec: PuzzleSpec;
  private solvedState: PuzzleState;
  private uiMode: UiMode = 'explorer';

  // Explore Mode state (always starts solved)
  private exploreAlg = '';

  // Solve Mode state (always starts scrambled from solveSeed; milestones form an immutable stack)
  private solveSeed = '';
  private solveScrambleMoves = 20;
  private scrambleState: PuzzleState;
  private solveMilestones: SolveMilestone[] = [];
  private compiledMilestones: CompiledMilestone[] = [];
  private solveActiveAlg = '';
  private solveElapsedMs = 0;
  private timerStartedAt: number | null = null;
  private timerIntervalId: number | null = null;
  private solveCompleted = false;
  private completionDismissed = false;
  private solveUndoStack: SolveUndoEntry[] = [];

  // Shared active evaluation & playback state
  private macros: MacroLibraryEntry[] = [];
  private evalResult: EvaluationResult;
  private allSteps: ExecutedStep[] = [];
  private currentStepIndex = 0; // 0 = initial state (solved in Explore, scrambled in Solve)
  private isPlaying = false;
  private playTimerId: number | null = null;
  private evalDebounceId: number | null = null;
  private cursorSyncEnabled = true;
  private clickUsesNextUnblocked = false;
  private speedMultiplier = 1.0;
  private solvedPeekVisible = false;
  private solvedPeekExpanded = false;
  private cyclePreviewCache = new Map<string, CyclePreviewResult>();
  private lastMacroListKey = '';

  // UI elements
  private renderer!: PuzzleSvgRenderer;
  private editor!: AlgorithmEditor;
  private helpModal!: { open: () => void; close: () => void };
  private puzzlePicker!: PuzzlePickerController;
  private customPuzzleModal!: CustomPuzzleModalController;
  private workspaceEl!: HTMLElement;
  private modeExplorerBtn!: HTMLButtonElement;
  private modeSolveBtn!: HTMLButtonElement;
  private solveHudBarEl!: HTMLElement;
  private solveMoveCountEl!: HTMLElement;
  private solveTimerBtn!: HTMLButtonElement;
  private solveTimerTextEl!: HTMLElement;
  private solveUndoBtn!: HTMLButtonElement;
  private solveStackCardEl!: HTMLElement;
  private solveStackCountEl!: HTMLElement;
  private solveStackListEl!: HTMLElement;
  private commitMilestoneFormEl!: HTMLFormElement;
  private commitMilestoneLabelInput!: HTMLInputElement;
  private commitMilestoneBtn!: HTMLButtonElement;
  private clearDraftBtn!: HTMLButtonElement;
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

    const shared = decodeShareHash(window.location.hash);
    if (shared?.customDoc && !this.isBuiltInPuzzle(shared.customDoc.id)) {
      this.upsertCustomDoc(shared.customDoc, true);
    }

    const initialSpec = this.findPuzzleSpec(
      shared?.puzzleId ?? loadLastPuzzleId() ?? 'geranium-plus',
    );
    this.currentSpec = initialSpec;
    saveLastPuzzleId(initialSpec.id);
    if (!shared) {
      window.history.replaceState(null, '', `#p=${encodeURIComponent(initialSpec.id)}`);
    }
    this.solvedState = this.getOrBuildPuzzle(initialSpec);
    this.scrambleState = this.solvedState;
    this.macros = shared?.macros ?? loadMacros(initialSpec.id);

    // Determine initial mode: shared link with seed opens Solve Mode; shared with alg opens Explore Mode;
    // bare `#p=<id>` preserves the user's saved mode and sessions.
    if (shared?.scrambleSeed) {
      this.uiMode = 'solve';
    } else if (shared?.hasSharedAlg) {
      this.uiMode = 'explorer';
    } else {
      this.uiMode = loadUiMode();
    }

    // Load per-puzzle Explore & Solve sessions
    this.loadPuzzleSessions(initialSpec.id, shared ?? undefined);

    this.evalResult = evaluateProgram(this.getActiveEvalBaseState(), '', this.macros, {
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

    this.applyUiModeChrome();
    this.editor.setValue(this.uiMode === 'solve' ? this.solveActiveAlg : this.exploreAlg);
    this.syncPuzzleButton();
    this.syncSolvedRefCard();
    this.renderSamples();
    this.renderMacroList();
    if (this.uiMode === 'solve') {
      this.rebuildCommittedStack();
    }
    this.reevaluate(true, { suppressAutoStart: true });
    this.bindGlobalShortcuts();
    window.addEventListener('hashchange', () => this.applySharedHash());
    window.addEventListener('beforeunload', () => this.persistCurrentSessions());
  }

  private computeScrambleState(solved: PuzzleState, seed: string, moves: number): PuzzleState {
    const clean = seed.trim() || rollRandomSeed();
    const clamped = Math.max(1, Math.min(1000, Math.round(moves) || 20));
    const seq = generateScramble(solved, clamped, clean);
    const ev = evaluateProgram(solved, seq);
    return ev.finalState;
  }

  private loadPuzzleSessions(
    puzzleId: string,
    shared?: { alg: string; hasSharedAlg?: boolean; scrambleSeed?: string; scrambleMoves?: number },
  ): void {
    const savedExplore = loadExploreSession(puzzleId);
    const savedSolve = loadSolveSession(puzzleId);

    // Explore state
    this.exploreAlg =
      shared && shared.hasSharedAlg && !shared.scrambleSeed ? shared.alg : (savedExplore?.alg ?? '');

    // Solve state: hydrate from share hash, or localStorage, or auto-roll a fresh scramble
    if (shared && shared.scrambleSeed) {
      const parsed = parseSolveTranscript(shared.alg);
      this.solveSeed = shared.scrambleSeed;
      this.solveScrambleMoves = shared.scrambleMoves ?? 20;
      this.solveMilestones = parsed.milestones;
      this.solveActiveAlg = parsed.activeAlg;
      this.solveElapsedMs = 0;
      this.solveCompleted = false;
    } else if (savedSolve && savedSolve.seed.trim().length > 0) {
      this.solveSeed = savedSolve.seed;
      this.solveScrambleMoves = savedSolve.scrambleMoves;
      this.solveMilestones = savedSolve.milestones.map((m) => ({ ...m }));
      this.solveActiveAlg = savedSolve.activeAlg;
      this.solveElapsedMs = savedSolve.elapsedMs;
      this.solveCompleted = savedSolve.solved;
    } else {
      this.solveSeed = rollRandomSeed();
      this.solveScrambleMoves = 20;
      this.solveMilestones = [];
      this.solveActiveAlg = '';
      this.solveElapsedMs = 0;
      this.solveCompleted = false;
    }

    this.completionDismissed = false;
    this.solveUndoStack = [];
    this.cyclePreviewCache.clear();
    this.scrambleState = this.computeScrambleState(
      this.solvedState,
      this.solveSeed,
      this.solveScrambleMoves,
    );
    this.compiledMilestones = [];
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
    if (idx >= 0) this.customDocs[idx] = normalized;
    else this.customDocs.push(normalized);
    this.customSpecs = this.compileCustomDocs(this.customDocs);
    this.puzzleCache.delete(normalized.id);
    this.puzzlePicker?.invalidateThumb(normalized.id);
    if (persist) saveCustomPuzzles(this.customDocs);
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
    this.clearCyclePreview();

    this.currentSpec = this.findPuzzleSpec(shared.puzzleId);
    saveLastPuzzleId(this.currentSpec.id);
    this.solvedState = this.getOrBuildPuzzle(this.currentSpec);
    this.macros = shared.macros ?? loadMacros(this.currentSpec.id);
    if (shared.scrambleSeed) {
      this.uiMode = 'solve';
    } else if (shared.hasSharedAlg) {
      this.uiMode = 'explorer';
    }
    this.loadPuzzleSessions(this.currentSpec.id, shared);
    this.lastMacroListKey = '';

    this.applyUiModeChrome();
    this.editor.setValue(this.uiMode === 'solve' ? this.solveActiveAlg : this.exploreAlg);
    this.syncPuzzleButton();
    this.syncSolvedRefCard();
    this.renderSamples();
    if (this.uiMode === 'solve') {
      this.rebuildCommittedStack();
    }
    this.reevaluate(true, { suppressAutoStart: true });
    const hasPayload = Boolean(
      shared.scrambleSeed || shared.hasSharedAlg || shared.macros || shared.customDoc,
    );
    this.showToast(
      hasPayload
        ? `Loaded shared ${this.currentSpec.name} state`
        : `Switched to ${this.currentSpec.name}`,
    );
  }

  private getOrBuildPuzzle(spec: PuzzleSpec): PuzzleState {
    let cached = this.puzzleCache.get(spec.id);
    if (!cached) {
      cached = buildPuzzle(spec);
      this.puzzleCache.set(spec.id, cached);
    }
    return cached;
  }

  private getTimelineInitialState(): PuzzleState {
    return this.uiMode === 'solve' ? this.scrambleState : this.solvedState;
  }

  private getCommittedStepCount(): number {
    if (this.uiMode !== 'solve' || this.compiledMilestones.length === 0) return 0;
    return this.compiledMilestones[this.compiledMilestones.length - 1].endStep;
  }

  private getActiveEvalBaseState(): PuzzleState {
    if (this.uiMode !== 'solve') return this.solvedState;
    if (this.compiledMilestones.length === 0) return this.scrambleState;
    return this.compiledMilestones[this.compiledMilestones.length - 1].stateAfter;
  }

  private rebuildCommittedStack(): void {
    const compiled: CompiledMilestone[] = [];
    let curState = this.scrambleState;
    let stepOffset = 0;

    for (const m of this.solveMilestones) {
      const ev = evaluateProgram(curState, m.alg, this.macros, {
        solvedReference: this.solvedState,
      });
      const error =
        ev.parseErrors[0]?.message ??
        ev.runtimeError?.message ??
        (ev.blocked ? `Blocked at ${ev.blocked.moveLabel}` : undefined);
      compiled.push({
        label: m.label,
        alg: m.alg,
        steps: ev.steps,
        stateBefore: curState,
        stateAfter: ev.finalState,
        startStep: stepOffset,
        endStep: stepOffset + ev.steps.length,
        ...(error ? { error } : {}),
      });
      curState = ev.finalState;
      stepOffset += ev.steps.length;
    }

    this.compiledMilestones = compiled;
  }

  private rebuildAllSteps(): void {
    if (this.uiMode === 'solve') {
      const steps: ExecutedStep[] = [];
      for (const m of this.compiledMilestones) {
        for (const s of m.steps) steps.push(s);
      }
      for (const s of this.evalResult.steps) steps.push(s);
      this.allSteps = steps;
    } else {
      this.allSteps = this.evalResult.steps;
    }
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
          </button>
          <div class="mode-toggle" role="group" aria-label="Workspace mode">
            <button type="button" class="mode-btn" id="btn-mode-explorer" data-mode="explorer" title="Explore Mode: start solved, write move sequences, analyze orders">Explore</button>
            <button type="button" class="mode-btn" id="btn-mode-solve" data-mode="solve" title="Solve Mode: start scrambled from a seed, commit moves onto a milestone stack">Solve</button>
          </div>
          <button class="btn" id="btn-share" title="Copy shareable link">Share</button>
          <button class="btn btn-primary" id="btn-help" title="Notation and controls guide">? Help</button>
        </div>
      </header>

      <main class="workspace" id="workspace">
        <section class="card puzzle-pane">
          <div class="solve-hud-bar" id="solve-hud-bar" hidden>
            <div class="solve-hud-left">
              <span class="solve-stat" id="solve-move-stat" title="Total solve moves (committed milestones + current moves)"><strong id="solve-move-count">0</strong> moves</span>
              <button type="button" class="btn btn-sm solve-timer-btn" id="btn-solve-timer" title="Click to pause or resume solve timer">⏱ <span id="solve-timer-text">00:00</span></button>
            </div>
            <div class="solve-hud-right">
              <button type="button" class="btn btn-sm" id="btn-solve-undo" title="Undo last interactive move or milestone action" disabled>↶ Undo</button>
              <button type="button" class="btn btn-sm" id="btn-copy-solve" title="Copy full solve transcript (seed + all milestones + current moves)">Copy Solve</button>
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
          <section class="card solve-stack-card" id="solve-stack-card" hidden>
            <div class="section-header">
              <h2 class="section-title">Solve Stack <span class="stack-count-badge" id="solve-stack-count">0 milestones</span></h2>
            </div>
            <div class="solve-stack-list" id="solve-stack-list"></div>
          </section>

          <section class="card editor-card">
            <div class="section-header">
              <h2 class="section-title" id="editor-section-title">Algorithm &amp; Script</h2>
              <div class="editor-actions">
                <label class="click-mode-label explorer-only" title="Moving your text cursor previews the puzzle at that step">
                  <input type="checkbox" id="chk-cursor-sync" checked />
                  Cursor sync
                </label>
                <button class="btn btn-sm explorer-only" id="btn-analyze" title="Compute exact order and cycle structure from solved state">Analyze Order</button>
                <button class="btn btn-sm" id="btn-save-sel" title="Save selected text (or whole sequence) as a macro">+ Save Macro</button>
              </div>
            </div>

            <div id="editor-mount"></div>

            <form class="commit-milestone-bar" id="commit-milestone-form" hidden>
              <input type="text" id="commit-milestone-label" autocomplete="off" placeholder="Milestone label (optional)" />
              <button type="submit" class="btn btn-primary btn-sm" id="btn-commit-milestone" title="Lift current moves onto the Solve Stack and clear textbox">+ Milestone</button>
              <button type="button" class="btn btn-sm" id="btn-clear-draft" title="Clear current textbox moves without touching committed milestones">Clear</button>
            </form>

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
    this.solveHudBarEl = root.querySelector('#solve-hud-bar')!;
    this.solveMoveCountEl = root.querySelector('#solve-move-count')!;
    this.solveTimerBtn = root.querySelector('#btn-solve-timer')!;
    this.solveTimerTextEl = root.querySelector('#solve-timer-text')!;
    this.solveUndoBtn = root.querySelector('#btn-solve-undo')!;
    this.solveStackCardEl = root.querySelector('#solve-stack-card')!;
    this.solveStackCountEl = root.querySelector('#solve-stack-count')!;
    this.solveStackListEl = root.querySelector('#solve-stack-list')!;
    this.commitMilestoneFormEl = root.querySelector('#commit-milestone-form')!;
    this.commitMilestoneLabelInput = root.querySelector('#commit-milestone-label')!;
    this.commitMilestoneBtn = root.querySelector('#btn-commit-milestone')!;
    this.clearDraftBtn = root.querySelector('#btn-clear-draft')!;
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

    // Header controls
    this.puzzleBtnEl.addEventListener('click', () => {
      this.puzzlePicker.open();
    });

    this.modeExplorerBtn.addEventListener('click', () => this.switchUiMode('explorer'));
    this.modeSolveBtn.addEventListener('click', () => this.switchUiMode('solve'));

    root.querySelector('#btn-share')!.addEventListener('click', () => {
      this.shareCurrentState();
    });

    root.querySelector('#btn-help')!.addEventListener('click', () => {
      this.helpModal.open();
    });

    // Solve HUD & Milestone commit controls
    this.solveTimerBtn.addEventListener('click', () => {
      if (this.timerStartedAt !== null) {
        this.pauseTimer(true);
      } else if (!this.solveCompleted) {
        this.startTimer();
      }
    });

    this.solveUndoBtn.addEventListener('click', () => {
      this.undoLastSolveAction();
    });

    root.querySelector('#btn-copy-solve')!.addEventListener('click', () => {
      this.flushPendingEval();
      const body = serializeSolveTranscript(this.solveMilestones, this.editor.getValue());
      const header = `// RingTwist Solve — ${this.currentSpec.name} (seed: ${this.solveSeed}, ${this.solveScrambleMoves} scramble moves)\n`;
      const full = body ? `${header}\n${body}\n` : header;
      navigator.clipboard?.writeText(full).then(
        () => this.showToast('Copied full solve transcript to clipboard'),
        () => window.prompt('Copy solve transcript:', full),
      );
    });

    this.commitMilestoneFormEl.addEventListener('submit', (ev) => {
      ev.preventDefault();
      this.commitActiveAsMilestone();
    });

    this.clearDraftBtn.addEventListener('click', () => {
      const cur = this.editor.getValue();
      if (!cur.trim()) return;
      this.pushSolveUndoSnapshot();
      this.editor.setValue('');
      this.solveActiveAlg = '';
      this.reevaluate(true, { suppressAutoStart: true });
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
      this.jumpToStep(this.allSteps.length);
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

    // Analyze Order button (Explore mode)
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
        'x',
        'y',
        'z',
      ]);
      if (reserved.has(name)) {
        this.showToast(`"${name}" is a reserved move name`);
        return;
      }

      const existingIdx = this.macros.findIndex((m) => m.name === name);
      if (existingIdx >= 0) this.macros[existingIdx] = { ...this.macros[existingIdx], body };
      else this.macros.push({ name, body });
      saveMacros(this.currentSpec.id, this.macros);
      this.cyclePreviewCache.clear();
      this.macroNameInput.value = '';
      this.macroBodyInput.value = '';
      if (this.uiMode === 'solve') this.rebuildCommittedStack();
      this.renderMacroList();
      this.reevaluate(false, { suppressAutoStart: true });
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
          'x',
          'y',
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
        for (const entry of valid) {
          const idx = this.macros.findIndex((m) => m.name === entry.name);
          if (idx >= 0) this.macros[idx] = entry;
          else this.macros.push(entry);
        }
        saveMacros(this.currentSpec.id, this.macros);
        this.cyclePreviewCache.clear();
        if (this.uiMode === 'solve') this.rebuildCommittedStack();
        this.renderMacroList();
        this.reevaluate(false, { suppressAutoStart: true });
        this.showToast(`Imported ${valid.length} macro(s)`);
      } catch (err) {
        this.showToast(`Import failed: ${(err as Error).message}`);
      }
    });
  }

  private bindGlobalShortcuts(): void {
    window.addEventListener('keydown', (ev) => {
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

  private applyUiModeChrome(): void {
    const isSolve = this.uiMode === 'solve';
    this.workspaceEl.classList.toggle('mode-solve', isSolve);
    this.modeExplorerBtn.classList.toggle('active', !isSolve);
    this.modeSolveBtn.classList.toggle('active', isSolve);
    this.solveHudBarEl.hidden = !isSolve;
    this.solveStackCardEl.hidden = !isSolve;
    this.commitMilestoneFormEl.hidden = !isSolve;

    const titleEl = document.querySelector('#editor-section-title');
    if (titleEl) {
      titleEl.textContent = isSolve ? 'Current Moves' : 'Algorithm & Script';
    }
  }

  private switchUiMode(mode: UiMode): void {
    if (mode === this.uiMode) return;
    this.flushPendingEval();
    this.stopPlayback();
    this.hideAnalysisBanner();
    this.clearCyclePreview();

    // Save current editor text into the mode we're leaving
    if (this.uiMode === 'solve') {
      this.solveActiveAlg = this.editor.getValue();
      this.pauseTimer(false);
    } else {
      this.exploreAlg = this.editor.getValue();
    }
    this.persistCurrentSessions();

    this.uiMode = mode;
    saveUiMode(mode);
    this.applyUiModeChrome();

    if (mode === 'solve') {
      if (!this.solveSeed.trim()) {
        this.solveSeed = rollRandomSeed();
        this.scrambleState = this.computeScrambleState(
          this.solvedState,
          this.solveSeed,
          this.solveScrambleMoves,
        );
      }
      this.rebuildCommittedStack();
      this.editor.setValue(this.solveActiveAlg);
    } else {
      this.editor.setValue(this.exploreAlg);
    }

    this.reevaluate(true, { suppressAutoStart: true });
  }

  // ---- Solve Timer ----

  private getCurrentElapsedMs(): number {
    return this.solveElapsedMs + (this.timerStartedAt !== null ? Date.now() - this.timerStartedAt : 0);
  }

  private updateTimerDisplay(): void {
    if (!this.solveTimerTextEl) return;
    this.solveTimerTextEl.textContent = formatDuration(this.getCurrentElapsedMs());
    this.solveTimerBtn.classList.toggle('running', this.timerStartedAt !== null);
  }

  private startTimer(): void {
    if (this.uiMode !== 'solve' || this.timerStartedAt !== null) return;
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
    if (persist) this.persistCurrentSessions();
  }

  private resetTimer(): void {
    this.pauseTimer(false);
    this.solveElapsedMs = 0;
    this.updateTimerDisplay();
  }

  private persistCurrentSessions(): void {
    if (this.editor) {
      if (this.uiMode === 'solve') this.solveActiveAlg = this.editor.getValue();
      else this.exploreAlg = this.editor.getValue();
    }
    saveExploreSession(this.currentSpec.id, { alg: this.exploreAlg });
    if (this.solveSeed.trim()) {
      saveSolveSession(this.currentSpec.id, {
        seed: this.solveSeed,
        scrambleMoves: this.solveScrambleMoves,
        milestones: this.solveMilestones,
        activeAlg: this.solveActiveAlg,
        elapsedMs: this.getCurrentElapsedMs(),
        solved: this.solveCompleted,
      });
    }
  }

  // ---- Solve Stack Actions ----

  private pushSolveUndoSnapshot(): void {
    if (this.uiMode !== 'solve') return;
    const snap: SolveUndoEntry = {
      milestones: this.solveMilestones.map((m) => ({ ...m })),
      activeAlg: this.editor.getValue(),
    };
    const prev = this.solveUndoStack[this.solveUndoStack.length - 1];
    if (
      prev &&
      prev.activeAlg === snap.activeAlg &&
      JSON.stringify(prev.milestones) === JSON.stringify(snap.milestones)
    ) {
      return;
    }
    this.solveUndoStack.push(snap);
    if (this.solveUndoStack.length > 100) this.solveUndoStack.shift();
    if (this.solveUndoBtn) this.solveUndoBtn.disabled = false;
  }

  private undoLastSolveAction(): void {
    if (this.uiMode !== 'solve') return;
    const prev = this.solveUndoStack.pop();
    if (!prev) return;
    this.stopPlayback();
    this.clearCyclePreview();
    this.solveMilestones = prev.milestones;
    this.solveActiveAlg = prev.activeAlg;
    this.rebuildCommittedStack();
    this.editor.setValue(prev.activeAlg);
    const len = prev.activeAlg.length;
    this.editor.textarea.selectionStart = len;
    this.editor.textarea.selectionEnd = len;
    this.solveUndoBtn.disabled = this.solveUndoStack.length === 0;
    this.reevaluate(true, { suppressAutoStart: true });
  }

  private applySolveScramble(seed: string, moves: number): void {
    const cleanSeed = seed.trim() || rollRandomSeed();
    const clampedMoves = Math.max(1, Math.min(1000, Math.round(moves) || 20));
    this.stopPlayback();
    this.hideAnalysisBanner();
    this.clearCyclePreview();
    this.solveSeed = cleanSeed;
    this.solveScrambleMoves = clampedMoves;
    this.scrambleState = this.computeScrambleState(
      this.solvedState,
      this.solveSeed,
      this.solveScrambleMoves,
    );
    this.solveMilestones = [];
    this.compiledMilestones = [];
    this.solveActiveAlg = '';
    this.solveUndoStack = [];
    this.cyclePreviewCache.clear();
    this.solveCompleted = false;
    this.completionDismissed = false;
    this.resetTimer();
    this.editor.setValue('');
    this.reevaluate(true, { suppressAutoStart: true });
    this.persistCurrentSessions();
    this.showToast(`Scrambled with seed "${this.solveSeed}" (${this.solveScrambleMoves} moves)`);
  }

  private commitActiveAsMilestone(): void {
    if (this.uiMode !== 'solve') return;
    this.flushPendingEval();
    const rawAlg = this.editor.getValue().trim();
    if (!rawAlg) {
      this.showToast('Enter or click some moves before committing a milestone');
      return;
    }
    if (
      this.evalResult.parseErrors.length > 0 ||
      this.evalResult.runtimeError ||
      this.evalResult.blocked
    ) {
      this.showToast('Fix syntax or blocking errors before committing a milestone');
      return;
    }
    if (this.evalResult.steps.length === 0) {
      this.showToast('Current moves contain no executable turns');
      return;
    }

    this.pushSolveUndoSnapshot();
    const customLabel = this.commitMilestoneLabelInput.value.trim();
    const label = customLabel || `Milestone ${this.solveMilestones.length + 1}`;
    const startStep = this.getCommittedStepCount();
    const baseState = this.getActiveEvalBaseState();

    this.solveMilestones.push({ label, alg: rawAlg });
    this.compiledMilestones.push({
      label,
      alg: rawAlg,
      steps: this.evalResult.steps,
      stateBefore: baseState,
      stateAfter: this.evalResult.finalState,
      startStep,
      endStep: startStep + this.evalResult.steps.length,
    });

    this.commitMilestoneLabelInput.value = '';
    this.solveActiveAlg = '';
    this.editor.setValue('');
    this.reevaluate(true, { suppressAutoStart: true });
    this.showToast(`Committed "${label}" (${this.compiledMilestones[this.compiledMilestones.length - 1].steps.length} moves)`);
  }

  private pullTopMilestoneToEditor(): void {
    if (this.uiMode !== 'solve' || this.solveMilestones.length === 0) return;
    this.flushPendingEval();
    this.pushSolveUndoSnapshot();
    const top = this.solveMilestones.pop()!;
    this.compiledMilestones.pop();

    const curDraft = this.editor.getValue().trim();
    const combined = curDraft ? `${top.alg}\n${curDraft}` : top.alg;
    this.solveActiveAlg = combined;
    this.editor.setValue(combined);
    this.editor.textarea.focus();
    this.editor.textarea.selectionStart = combined.length;
    this.editor.textarea.selectionEnd = combined.length;
    this.reevaluate(true, { suppressAutoStart: true });
    this.showToast(`Pulled "${top.label}" back into editor`);
  }

  private discardTopMilestone(): void {
    if (this.uiMode !== 'solve' || this.solveMilestones.length === 0) return;
    this.flushPendingEval();
    this.pushSolveUndoSnapshot();
    const top = this.solveMilestones.pop()!;
    this.compiledMilestones.pop();
    this.reevaluate(true, { suppressAutoStart: true });
    this.showToast(`Discarded "${top.label}"`);
  }

  private renderSolveStack(): void {
    if (this.uiMode !== 'solve') return;

    const count = this.compiledMilestones.length;
    this.solveStackCountEl.textContent = count === 1 ? '1 milestone' : `${count} milestones`;

    // Preserve focus if the user is actively typing in the inline seed/moves input
    const activeId = document.activeElement?.id;
    const isEditingSeed = activeId === 'stack-seed-input' || activeId === 'stack-moves-input';
    if (isEditingSeed) {
      // Only update active highlight classes without clobbering the focused input
      this.updateSolveStackHighlight();
      return;
    }

    this.solveStackListEl.innerHTML = '';

    // Entry 0: Pinned Scramble Root with editable seed + moves
    const rootItem = document.createElement('div');
    rootItem.className = `stack-item stack-item-root${this.currentStepIndex === 0 ? ' inspecting' : ''}`;
    rootItem.dataset.stackIndex = '0';
    rootItem.innerHTML = `
      <div class="stack-item-head">
        <span class="stack-badge stack-badge-root">SCRAMBLE</span>
        <span class="stack-step-meta" title="Click to preview initial scrambled state">step 0</span>
      </div>
      <form class="stack-seed-form" id="stack-seed-form">
        <input type="text" class="stack-seed-input" id="stack-seed-input" value="${escapeHtml(this.solveSeed)}" autocomplete="off" spellcheck="false" placeholder="seed" title="Editable scramble seed" />
        <input type="number" class="stack-moves-input" id="stack-moves-input" min="1" max="1000" value="${this.solveScrambleMoves}" title="Scramble move count (1–1000)" aria-label="Scramble moves" />
        <button type="button" class="btn btn-sm" id="btn-stack-rand" title="Roll a new random scramble seed">🎲</button>
        <button type="submit" class="btn btn-primary btn-sm" id="btn-stack-apply" title="Re-scramble using this seed">Apply</button>
      </form>
    `;

    rootItem.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest('form') && (target.tagName === 'INPUT' || target.tagName === 'BUTTON')) {
        return;
      }
      this.stopPlayback();
      this.jumpToStep(0);
    });

    const seedForm = rootItem.querySelector<HTMLFormElement>('#stack-seed-form')!;
    const seedInput = rootItem.querySelector<HTMLInputElement>('#stack-seed-input')!;
    const movesInput = rootItem.querySelector<HTMLInputElement>('#stack-moves-input')!;
    seedForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      this.applySolveScramble(seedInput.value, parseInt(movesInput.value, 10) || 20);
    });
    rootItem.querySelector('#btn-stack-rand')!.addEventListener('click', () => {
      this.applySolveScramble(rollRandomSeed(), parseInt(movesInput.value, 10) || 20);
    });

    this.solveStackListEl.appendChild(rootItem);

    // Entries 1..K: Committed Milestones
    for (let i = 0; i < this.compiledMilestones.length; i++) {
      const m = this.compiledMilestones[i];
      const isTop = i === this.compiledMilestones.length - 1;
      const isInspecting =
        this.currentStepIndex > m.startStep && this.currentStepIndex <= m.endStep;
      const item = document.createElement('div');
      item.className = `stack-item stack-item-milestone${isInspecting ? ' inspecting' : ''}${m.error ? ' has-error' : ''}`;
      item.dataset.stackIndex = String(i + 1);

      const compactAlg = m.alg.replace(/\s+/g, ' ');
      item.innerHTML = `
        <div class="stack-item-main">
          <div class="stack-item-head">
            <span class="stack-badge">#${i + 1}</span>
            <span class="stack-label">${escapeHtml(m.label)}</span>
            <span class="stack-step-meta">${m.steps.length}m · step ${m.endStep}</span>
          </div>
          <div class="stack-alg-preview" title="${escapeHtml(m.alg)}">${escapeHtml(compactAlg)}</div>
        </div>
        ${
          isTop
            ? `<div class="stack-top-actions">
                 <button type="button" class="btn btn-sm" data-act="pull" title="Pull top milestone back into the editor">↩</button>
                 <button type="button" class="btn btn-sm btn-danger" data-act="discard" title="Discard top milestone from stack">×</button>
               </div>`
            : ''
        }
      `;

      item.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).closest('button')) return;
        this.stopPlayback();
        this.jumpToStep(m.endStep);
      });

      if (isTop) {
        item.querySelector('[data-act="pull"]')?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.pullTopMilestoneToEditor();
        });
        item.querySelector('[data-act="discard"]')?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.discardTopMilestone();
        });
      }

      this.solveStackListEl.appendChild(item);
    }

    // Keep latest milestone scrolled into view cleanly
    this.solveStackListEl.scrollTop = this.solveStackListEl.scrollHeight;
  }

  private updateSolveStackHighlight(): void {
    if (this.uiMode !== 'solve') return;
    const rows = this.solveStackListEl.querySelectorAll<HTMLElement>('.stack-item');
    for (const row of rows) {
      const idx = parseInt(row.dataset.stackIndex ?? '-1', 10);
      if (idx === 0) {
        row.classList.toggle('inspecting', this.currentStepIndex === 0);
      } else if (idx > 0 && idx <= this.compiledMilestones.length) {
        const m = this.compiledMilestones[idx - 1];
        row.classList.toggle(
          'inspecting',
          this.currentStepIndex > m.startStep && this.currentStepIndex <= m.endStep,
        );
      }
    }
  }

  // ---- Macro Hover Piece-Cycle Preview ----

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

  // ---- Solved Reference & Header Chrome ----

  private setSolvedPeekVisible(visible: boolean): void {
    this.solvedPeekVisible = visible;
    this.solvedRefCardEl.hidden = !visible;
    this.solvedPeekBtnEl.classList.toggle('active', visible);
    if (visible) this.syncSolvedRefCard();
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
    nameEl.textContent = this.currentSpec.name;
    this.puzzleBtnEl.setAttribute(
      'aria-label',
      `Puzzle: ${this.currentSpec.name}. Choose a puzzle`,
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

    const addRow = (entry: MacroLibraryEntry, isInline: boolean) => {
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
        if (this.uiMode === 'solve') this.rebuildCommittedStack();
        this.renderMacroList();
        this.reevaluate(false, { suppressAutoStart: true });
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
    this.flushPendingEval();
    this.pauseTimer(true);
    this.cancelPendingEval();
    this.stopPlayback();
    this.hideAnalysisBanner();
    this.clearCyclePreview();

    this.currentSpec = this.findPuzzleSpec(puzzleId);
    saveLastPuzzleId(this.currentSpec.id);
    window.history.replaceState(null, '', `#p=${encodeURIComponent(this.currentSpec.id)}`);
    this.solvedState = this.getOrBuildPuzzle(this.currentSpec);
    this.macros = loadMacros(this.currentSpec.id);
    this.loadPuzzleSessions(this.currentSpec.id);
    this.lastMacroListKey = '';

    this.applyUiModeChrome();
    this.editor.setValue(this.uiMode === 'solve' ? this.solveActiveAlg : this.exploreAlg);
    this.syncPuzzleButton();
    this.syncSolvedRefCard();
    this.renderSamples();
    this.renderMacroList();
    if (this.uiMode === 'solve') {
      this.rebuildCommittedStack();
    }
    this.reevaluate(true, { suppressAutoStart: true });
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
    if (this.uiMode === 'solve') this.solveActiveAlg = src;
    else this.exploreAlg = src;

    this.evalResult = evaluateProgram(this.getActiveEvalBaseState(), src, this.macros, {
      solvedReference: this.solvedState,
    });
    this.rebuildAllSteps();
    this.renderMacroList();

    const maxStep = this.allSteps.length;
    this.scrubberEl.max = String(maxStep);

    if (jumpToEnd) {
      this.currentStepIndex = maxStep;
    } else {
      this.currentStepIndex = Math.min(this.currentStepIndex, maxStep);
    }

    if (
      !opts.suppressAutoStart &&
      this.uiMode === 'solve' &&
      maxStep > 0 &&
      !this.solveCompleted
    ) {
      this.startTimer();
    }

    this.checkSolveCompletion();
    this.renderSolveStack();
    this.renderCurrentStep();
    this.persistCurrentSessions();
  }

  private checkSolveCompletion(): void {
    if (this.uiMode !== 'solve') {
      this.completionBannerEl.hidden = true;
      return;
    }

    const totalMoves = this.allSteps.length;
    const solvedNow =
      totalMoves > 0 &&
      !this.evalResult.blocked &&
      this.evalResult.parseErrors.length === 0 &&
      !this.evalResult.runtimeError &&
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
      const timeStr = formatDuration(this.getCurrentElapsedMs());
      this.completionBannerEl.hidden = false;
      this.completionBannerEl.innerHTML = `
        <span class="completion-text">
          🎉 <strong>Solved!</strong> ${totalMoves} moves · ${timeStr} · seed <code>${escapeHtml(this.solveSeed)}</code>
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
        this.applySolveScramble(rollRandomSeed(), this.solveScrambleMoves);
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
    if (this.currentStepIndex <= 0 || this.allSteps.length === 0) {
      return this.getTimelineInitialState();
    }
    const idx = Math.min(this.currentStepIndex, this.allSteps.length) - 1;
    return this.allSteps[idx].stateAfter;
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
    const total = this.allSteps.length;
    const committed = this.getCommittedStepCount();
    this.scrubberEl.value = String(this.currentStepIndex);
    this.stepCounterEl.textContent = `${this.currentStepIndex} / ${total}`;
    this.playBtnEl.textContent = this.isPlaying ? '⏸' : '▶';

    if (this.uiMode === 'solve') {
      this.solveMoveCountEl.textContent = String(total);
      this.solveUndoBtn.disabled = this.solveUndoStack.length === 0;
      const canCommit =
        this.evalResult.steps.length > 0 &&
        this.evalResult.parseErrors.length === 0 &&
        !this.evalResult.runtimeError &&
        !this.evalResult.blocked;
      this.commitMilestoneBtn.disabled = !canCommit;
      this.clearDraftBtn.disabled = this.editor.getValue().trim().length === 0;
      this.updateTimerDisplay();
      this.updateSolveStackHighlight();
    }

    // Status pills
    const pills: string[] = [];
    const solvedNow = isPuzzleSolved(state, this.solvedState);
    if (solvedNow) {
      pills.push('<span class="pill pill-solved">✓ Solved</span>');
    } else if (this.uiMode === 'solve') {
      pills.push(`<span class="pill pill-scramble">Seed · ${escapeHtml(this.solveSeed)}</span>`);
    }
    pills.push(`<span class="pill">${state.pieces.length} pieces</span>`);

    if (this.currentStepIndex > 0 && this.currentStepIndex <= total) {
      const st = this.allSteps[this.currentStepIndex - 1];
      const macroTag = st.macroStack.length > 0 ? ` (${st.macroStack.join(' › ')})` : '';
      pills.push(
        `<span class="pill pill-info">Move: ${escapeHtml(st.moveLabel)}${escapeHtml(macroTag)}</span>`,
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

    // Circle free/blocked chips
    this.circleChipsEl.innerHTML = '';
    for (const c of this.currentSpec.circles) {
      if (c.discovered && statuses[c.id]?.blocked) continue;
      const chipSpecs: { label: string; layerOpt?: MoveLayerSpec; desc: string }[] =
        c.layerRadii && c.layerRadii.length > 1
          ? [
              { label: c.id, layerOpt: { layer: 1 }, desc: `Inner disk ${c.id}` },
              { label: `2${c.id}`, layerOpt: { layer: 2 }, desc: `Outer ring 2${c.id}` },
              {
                label: c.id.toLowerCase(),
                layerOpt: { wide: true },
                desc: `Wide full circle ${c.id.toLowerCase()}`,
              },
            ]
          : [{ label: c.id, desc: c.discovered ? `Discovered grip ${c.id}` : `Circle ${c.id}` }];

      for (const cs of chipSpecs) {
        const st = cs.layerOpt ? getCircleStatus(state, c.id, cs.layerOpt) : statuses[c.id];
        const chip = document.createElement('button');
        chip.className = `circle-chip ${st.blocked ? 'blocked' : 'free'}${c.discovered ? ' discovered' : ''}`;
        chip.textContent = c.discovered
          ? `✦ ${cs.label} ✓`
          : `${cs.label} ${st.blocked ? '✕' : '✓'}`;
        chip.style.borderLeft = `3px solid ${c.discovered ? '#fbbf24' : c.color}`;
        chip.title = st.blocked
          ? `${cs.desc} blocked by ${st.blockingPieceIds.length} piece(s)`
          : `${cs.desc} free — click for CW, shift-click for CCW`;
        chip.addEventListener('click', (ev) => {
          this.handleCircleClick(c.id, ev.shiftKey ? -1 : 1, cs.layerOpt);
        });
        this.circleChipsEl.appendChild(chip);
      }
    }

    // Diagnostic banner
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
      const via =
        b.macroStack.length > 0 ? ` inside <code>${escapeHtml(b.macroStack.join(' › '))}</code>` : '';
      this.diagBannerEl.className = 'diagnostic-banner error visible';
      this.diagBannerEl.innerHTML = `
        <span>
          <b>Blocked at step ${committed + b.stepIndex + 1} (<code>${escapeHtml(b.moveLabel)}</code>${via}):</b>
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

    // Active span highlight in editor (only when step is inside active textbox)
    const localIdx = this.currentStepIndex - committed;
    const activeSpan =
      localIdx > 0 && localIdx <= this.evalResult.steps.length
        ? this.evalResult.steps[localIdx - 1].topSpan
        : undefined;
    this.editor.setHighlights({ activeSpan, errorSpans });
  }

  // ---- Playback ----

  private jumpToStep(stepIdx: number): void {
    const clamped = Math.max(0, Math.min(this.allSteps.length, stepIdx));
    this.currentStepIndex = clamped;
    this.renderCurrentStep();
  }

  private turnDurationMs(angleDeg: number, fastForwarded?: boolean, baseMs = 360): number {
    if (fastForwarded) return 0;
    const angleFactor = 0.65 + 0.35 * (Math.min(Math.abs(angleDeg), 180) / 72);
    return Math.round((baseMs * angleFactor) / this.speedMultiplier);
  }

  private stepForward(onDone?: () => void): void {
    this.flushPendingEval();
    const total = this.allSteps.length;
    if (this.currentStepIndex >= total) {
      onDone?.();
      return;
    }
    const fromState = this.getDisplayedState();
    const step = this.allSteps[this.currentStepIndex];
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
    const step = this.allSteps[this.currentStepIndex - 1];
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
    if (this.allSteps.length === 0) return;
    if (this.currentStepIndex >= this.allSteps.length) {
      this.jumpToStep(0);
    }
    this.isPlaying = true;
    this.playBtnEl.textContent = '⏸';

    const playNext = () => {
      if (!this.isPlaying) return;
      if (this.currentStepIndex >= this.allSteps.length) {
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

    const committed = this.getCommittedStepCount();
    let localTarget = 0;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].topSpan.start < cursorPos) localTarget = i + 1;
      else break;
    }
    const target = committed + localTarget;
    if (target !== this.currentStepIndex) {
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
    if (this.currentStepIndex !== this.allSteps.length) {
      this.jumpToStep(this.allSteps.length);
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
    const prevCount = this.allSteps.length;
    const wasAtEnd = this.currentStepIndex === prevCount;

    if (!wasAtEnd) {
      const len = this.editor.getValue().length;
      this.editor.textarea.selectionStart = len;
      this.editor.textarea.selectionEnd = len;
    }

    const prevFinalState = this.evalResult.finalState;
    const deltaAnim = options.incrementalMove?.(prevFinalState);

    const ta = this.editor.textarea;
    const curText = ta.value;
    this.pushSolveUndoSnapshot();
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

    const nextText = this.editor.getValue();
    if (this.uiMode === 'solve') this.solveActiveAlg = nextText;
    else this.exploreAlg = nextText;

    this.evalResult = evaluateProgram(
      this.getActiveEvalBaseState(),
      nextText,
      this.macros,
      { solvedReference: this.solvedState },
    );
    this.rebuildAllSteps();
    this.renderMacroList();

    const newTotal = this.allSteps.length;
    this.scrubberEl.max = String(newTotal);
    this.currentStepIndex = newTotal;

    if (this.uiMode === 'solve' && newTotal > 0 && !this.solveCompleted) {
      this.startTimer();
    }
    this.checkSolveCompletion();
    this.persistCurrentSessions();

    const finalAfter = this.evalResult.finalState;
    const highlightAfter = this.getHighlightForStep(this.currentStepIndex);

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

  private runAnalysis(algSource: string, baseState: PuzzleState, label: string): void {
    const res = analyzeAlgorithm(baseState, algSource, this.getMergedMacros());
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
    const alg =
      this.uiMode === 'solve'
        ? serializeSolveTranscript(this.solveMilestones, this.editor.getValue())
        : this.editor.getValue();

    const hash = encodeShareHash({
      puzzleId: this.currentSpec.id,
      alg,
      macros: this.macros,
      ...(this.uiMode === 'solve'
        ? { scrambleSeed: this.solveSeed, scrambleMoves: this.solveScrambleMoves }
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
