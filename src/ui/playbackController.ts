import { ExecutedStep } from '../lang/evaluator.ts';
import { CircleStatus, getAllCircleStatuses } from '../puzzle/engine.ts';
import { PuzzleState } from '../puzzle/types.ts';
import { PuzzleSvgRenderer, RenderHighlight } from './svgRenderer.ts';

export interface PlaybackHost {
  getSteps: () => ExecutedStep[];
  getStateAtIntegerStep: (stepIdx: number) => PuzzleState;
  getHighlightForStep: (stepIdx: number) => RenderHighlight;
  flushPendingEval: () => void;
  onNavigate: () => void;
  onChromeUpdate: (
    state: PuzzleState,
    statuses: Record<string, CircleStatus>,
  ) => void;
  onMovePillText: (text: string) => void;
}

/**
 * Owns continuous Twizzle-style timeline state, smooth mid-turn scrubbing,
 * step forward/backward animations, and timed playback loop.
 */
export class PlaybackController {
  private scrubberEl: HTMLInputElement;
  private stepCounterEl: HTMLElement;
  private playBtnEl: HTMLButtonElement;
  private renderer: PuzzleSvgRenderer;
  private host: PlaybackHost;

  private currentTimelinePos = 0;
  private animTargetPos: number | null = null;
  private lastScrubBaseStep = -1;
  private isPlaying = false;
  private playTimerId: number | null = null;
  private speedMultiplier = 1.0;

  constructor(root: HTMLElement, renderer: PuzzleSvgRenderer, host: PlaybackHost) {
    this.renderer = renderer;
    this.host = host;
    this.scrubberEl = root.querySelector('#scrubber')!;
    this.stepCounterEl = root.querySelector('#step-counter')!;
    this.playBtnEl = root.querySelector('#btn-play')!;

    root.querySelector('#btn-start')!.addEventListener('click', () => {
      this.host.flushPendingEval();
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
      this.host.flushPendingEval();
      this.stopPlayback();
      this.jumpToStep(this.host.getSteps().length);
    });
    this.scrubberEl.addEventListener('input', () => {
      this.host.flushPendingEval();
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
  }

  public getPosition(): number {
    return this.currentTimelinePos;
  }

  public getPlaying(): boolean {
    return this.isPlaying;
  }

  public isAtIntegerPos(pos = this.currentTimelinePos): boolean {
    return Math.abs(pos - Math.round(pos)) <= 1e-4;
  }

  public formatStepCounter(pos: number, total: number): string {
    return this.isAtIntegerPos(pos)
      ? `${Math.round(pos)} / ${total}`
      : `${pos.toFixed(1)} / ${total}`;
  }

  public getDisplayedState(): PuzzleState {
    return this.host.getStateAtIntegerStep(Math.round(this.currentTimelinePos));
  }

  public syncTimelineAfterEval(total: number, jumpToEnd: boolean): void {
    this.scrubberEl.max = String(total);
    this.lastScrubBaseStep = -1;
    this.animTargetPos = null;
    this.currentTimelinePos = jumpToEnd ? total : Math.min(this.currentTimelinePos, total);
  }

  public syncScrubberReadout(pos: number, total: number): void {
    const isMid = total > 0 && !this.isAtIntegerPos(pos);
    this.scrubberEl.value = isMid ? pos.toFixed(2) : String(Math.round(pos));
    this.stepCounterEl.textContent = this.formatStepCounter(pos, total);
    this.playBtnEl.textContent = this.isPlaying ? '⏸' : '▶';
  }

  public turnDurationMs(angleDeg: number, fastForwarded?: boolean, baseMs = 360): number {
    if (fastForwarded) return 0;
    const angleFactor = 0.65 + 0.35 * (Math.min(Math.abs(angleDeg), 180) / 72);
    return Math.round((baseMs * angleFactor) / this.speedMultiplier);
  }

  public renderCurrentStep(): void {
    const steps = this.host.getSteps();
    const pos = this.currentTimelinePos;
    if (steps.length > 0 && !this.isAtIntegerPos(pos)) {
      this.scrubToPosition(pos);
      return;
    }
    const stepIdx = Math.round(pos);
    this.currentTimelinePos = stepIdx;
    this.lastScrubBaseStep = -1;
    const state = this.host.getStateAtIntegerStep(stepIdx);
    const highlight = this.host.getHighlightForStep(stepIdx);
    const statuses = getAllCircleStatuses(state);

    this.renderer.render(state, highlight, statuses);
    this.host.onChromeUpdate(state, statuses);
  }

  public scrubToPosition(rawPos: number): void {
    const steps = this.host.getSteps();
    const total = steps.length;
    const pos = Math.max(0, Math.min(total, Number.isFinite(rawPos) ? rawPos : 0));
    this.animTargetPos = null;
    this.host.onNavigate();

    if (total === 0 || this.isAtIntegerPos(pos)) {
      this.jumpToStep(Math.round(pos));
      return;
    }

    const stepIdx = Math.min(total - 1, Math.floor(pos));
    const frac = pos - stepIdx;
    const step = steps[stepIdx];
    const fromState = this.host.getStateAtIntegerStep(stepIdx);
    this.currentTimelinePos = pos;

    const changedStep = this.lastScrubBaseStep !== stepIdx;
    const statuses = changedStep ? getAllCircleStatuses(fromState) : undefined;
    this.renderer.renderScrubFrame(fromState, step, frac, statuses);

    if (changedStep) {
      this.lastScrubBaseStep = stepIdx;
      this.host.onChromeUpdate(fromState, statuses!);
    } else {
      this.scrubberEl.value = pos.toFixed(2);
      this.stepCounterEl.textContent = this.formatStepCounter(pos, total);
      const macroTag = step.macroStack.length > 0 ? ` (${step.macroStack.join(' › ')})` : '';
      this.host.onMovePillText(`${step.moveLabel} ${Math.round(frac * 100)}%${macroTag}`);
    }
  }

  public jumpToStep(stepIdx: number): void {
    const total = this.host.getSteps().length;
    const clamped = Math.max(0, Math.min(total, Math.round(stepIdx)));
    this.animTargetPos = null;
    this.lastScrubBaseStep = -1;
    this.currentTimelinePos = clamped;
    this.host.onNavigate();
    this.renderCurrentStep();
  }

  public stepForward(onDone?: () => void): void {
    this.host.flushPendingEval();
    this.host.onNavigate();
    let snappedFromMid = !this.isAtIntegerPos();
    if (!this.isPlaying && this.animTargetPos !== null && this.animTargetPos > this.currentTimelinePos) {
      this.currentTimelinePos = this.animTargetPos;
      snappedFromMid = true;
    }
    const steps = this.host.getSteps();
    const total = steps.length;
    if (this.currentTimelinePos >= total - 1e-4) {
      this.animTargetPos = null;
      this.currentTimelinePos = total;
      if (snappedFromMid) this.renderCurrentStep();
      onDone?.();
      return;
    }

    const stepIdx = Math.min(total - 1, Math.floor(this.currentTimelinePos + 1e-4));
    const startFrac = Math.max(0, Math.min(1, this.currentTimelinePos - stepIdx));
    const fromState = this.host.getStateAtIntegerStep(stepIdx);
    const step = steps[stepIdx];
    const targetPos = stepIdx + 1;
    this.animTargetPos = targetPos;
    this.lastScrubBaseStep = -1;

    const highlightAfter = this.host.getHighlightForStep(targetPos);
    const statusesAfter = getAllCircleStatuses(step.stateAfter);
    const fullMs = this.turnDurationMs(step.angleDeg, step.fastForwarded, 360);
    const durationMs = Math.round(fullMs * (1 - startFrac));

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
        this.host.onChromeUpdate(step.stateAfter, statusesAfter);
        onDone?.();
      },
      statusesAfter,
    );
  }

  public stepBackward(): void {
    this.host.flushPendingEval();
    this.host.onNavigate();
    let snappedFromMid = !this.isAtIntegerPos();
    if (!this.isPlaying && this.animTargetPos !== null && this.animTargetPos < this.currentTimelinePos) {
      this.currentTimelinePos = this.animTargetPos;
      snappedFromMid = true;
    }
    if (this.currentTimelinePos <= 1e-4) {
      this.animTargetPos = null;
      this.currentTimelinePos = 0;
      if (snappedFromMid) this.renderCurrentStep();
      return;
    }

    const steps = this.host.getSteps();
    const mid = !this.isAtIntegerPos();
    const stepIdx = mid
      ? Math.floor(this.currentTimelinePos)
      : Math.round(this.currentTimelinePos) - 1;
    const startFrac = mid ? this.currentTimelinePos - stepIdx : 1;
    const step = steps[stepIdx];
    const fromState = this.host.getStateAtIntegerStep(stepIdx);
    const targetPos = stepIdx;
    this.animTargetPos = targetPos;
    this.lastScrubBaseStep = -1;

    const highlightAfter = this.host.getHighlightForStep(targetPos);
    const statusesAfter = getAllCircleStatuses(fromState);
    const fullMs = this.turnDurationMs(step.angleDeg, step.fastForwarded, 320);
    const durationMs = Math.round(fullMs * startFrac);

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
        this.host.onChromeUpdate(fromState, statusesAfter);
      },
      statusesAfter,
    );
  }

  public startPlayback(): void {
    this.host.flushPendingEval();
    const total = this.host.getSteps().length;
    if (total === 0) return;
    if (this.currentTimelinePos >= total - 1e-4) {
      this.jumpToStep(0);
    }
    this.isPlaying = true;
    this.playBtnEl.textContent = '⏸';

    const playNext = () => {
      if (!this.isPlaying) return;
      if (this.currentTimelinePos >= this.host.getSteps().length - 1e-4) {
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

  public stopPlayback(preserveTarget = false): void {
    this.isPlaying = false;
    if (!preserveTarget) this.animTargetPos = null;
    if (this.playTimerId !== null) {
      clearTimeout(this.playTimerId);
      this.playTimerId = null;
    }
    this.renderer.cancelAnimation();
    this.playBtnEl.textContent = '▶';
  }

  public syncCursor(cursorPos: number): void {
    const steps = this.host.getSteps();
    if (this.isPlaying || steps.length === 0) return;
    let target = 0;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].topSpan.start < cursorPos) target = i + 1;
      else break;
    }
    if (Math.abs(target - this.currentTimelinePos) > 1e-4) {
      this.jumpToStep(target);
    }
  }

  private syncLivePlaybackUi(livePos: number): void {
    this.currentTimelinePos = livePos;
    const total = this.host.getSteps().length;
    this.scrubberEl.value = this.isAtIntegerPos(livePos)
      ? String(Math.round(livePos))
      : livePos.toFixed(2);
    this.stepCounterEl.textContent = this.formatStepCounter(livePos, total);
  }
}
