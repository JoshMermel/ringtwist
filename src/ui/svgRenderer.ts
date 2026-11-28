import { ArcRegion, regionToSvgPath } from '../geom/arcRegion.ts';
import { Point } from '../geom/math.ts';
import { ExecutedStep } from '../lang/evaluator.ts';
import { CyclePreviewResult } from '../puzzle/cyclePreview.ts';
import { CircleStatus, MoveLayerSpec, getAllCircleStatuses, getCircleStatus } from '../puzzle/engine.ts';
import { CircleDef, MirrorAxis, Piece, PuzzleSpec, PuzzleState } from '../puzzle/types.ts';
import { renderCyclePreviewOverlay } from './svgCycleOverlay.ts';
import {
  buildPieceSvgNode,
  computeCircleLabelPosition,
  computePuzzleViewBox,
  svgEl,
} from './svgStatic.ts';

export { computePuzzleViewBox, renderPieceSilhouetteSvg, renderStaticPuzzleSvg } from './svgStatic.ts';

export interface RenderHighlight {
  blockedCircleId?: string;
  blockingPieceIds?: number[];
}

export interface TurnAnimationSpec {
  fromState: PuzzleState;
  toState: PuzzleState;
  angleDeg: number; // signed CW degrees
  pivot: { x: number; y: number };
  movedPieceIds: number[];
  durationMs: number;
  /** If set, animates a 180° pancake mirror flip around 'x' (top↔bottom) or 'y' (left↔right). */
  flipAxis?: MirrorAxis;
  /** Starting fraction along [0, 1] for resuming/rewinding from a mid-turn scrub position (default 0). */
  startFrac?: number;
  /** Ending fraction along [0, 1] (default 1; pass 0 to smoothly rewind back to fromState). */
  endFrac?: number;
  /** Optional per-frame progress callback receiving the live fraction u in [0, 1]. */
  onProgress?: (u: number) => void;
}

export interface SvgRendererCallbacks {
  onCircleClick: (circleId: string, direction: 1 | -1, layerOpt?: MoveLayerSpec) => void;
}

export class PuzzleSvgRenderer {
  private svg: SVGSVGElement;
  private piecesLayer: SVGGElement;
  private movingLayer: SVGGElement;
  private rimsLayer: SVGGElement;
  private previewLayer: SVGGElement;
  private labelsLayer: SVGGElement;
  private callbacks: SvgRendererCallbacks;
  private animFrameId: number | null = null;
  private flashTimerId: number | null = null;
  private currentSpec: PuzzleSpec | null = null;
  private currentState: PuzzleState | null = null;
  private currentStatuses: Record<string, CircleStatus> = {};
  private currentHighlight: RenderHighlight = {};
  private preFlashHighlight: RenderHighlight | null = null;
  private pieceNodesSpec: PuzzleSpec | null = null;
  private sortedPieceIds: number[] = [];
  private pieceNodes = new Map<
    number,
    {
      el: SVGElement;
      region: ArcRegion;
      stickers: Piece['stickers'];
      blocking: boolean;
      inMoving: boolean;
    }
  >();
  private rimLabelSpec: PuzzleSpec | null = null;
  private rimLabelNodes = new Map<
    string,
    {
      rims: SVGCircleElement[];
      labelG: SVGGElement;
      bg: SVGCircleElement;
      txt: SVGTextElement;
      title: SVGTitleElement;
      visible: boolean;
      rimClass: string;
      stroke: string;
      bgOpacity: string;
      txtOpacity: string;
    }
  >();
  private hoveredHit: { circleId: string; layerOpt?: MoveLayerSpec } | null = null;
  private focusPickHandler: ((pt: Point) => void) | null = null;
  private lastPointerEvent: MouseEvent | null = null;
  private wheelAccum = 0;
  private wheelCircleId: string | null = null;
  private lastWheelEventMs = 0;
  private lastWheelFireMs = 0;
  private scrubCache: { fromState: PuzzleState; step: ExecutedStep; half: 0 | 1 } | null = null;

  constructor(container: HTMLElement, callbacks: SvgRendererCallbacks) {
    this.callbacks = callbacks;
    this.svg = svgEl('svg', { class: 'puzzle-svg' });
    this.piecesLayer = svgEl('g', { class: 'layer-pieces' });
    this.movingLayer = svgEl('g', { class: 'layer-moving' });
    this.rimsLayer = svgEl('g', { class: 'layer-rims' });
    this.previewLayer = svgEl('g', { class: 'layer-cycle-preview' });
    this.labelsLayer = svgEl('g', { class: 'layer-labels' });

    this.svg.append(
      this.piecesLayer,
      this.movingLayer,
      this.rimsLayer,
      this.previewLayer,
      this.labelsLayer,
    );
    container.appendChild(this.svg);

    this.setupPointerInteraction();
  }

  private setupPointerInteraction(): void {
    const clientToMath = (ev: MouseEvent): { x: number; y: number } | null => {
      const ctm = this.svg.getScreenCTM();
      if (!ctm) return null;
      const pt = this.svg.createSVGPoint();
      pt.x = ev.clientX;
      pt.y = ev.clientY;
      const svgPt = pt.matrixTransform(ctm.inverse());
      return { x: svgPt.x, y: -svgPt.y };
    };

    const pickCircleAt = (
      ev: MouseEvent,
      altOverride?: boolean,
    ): { circle: CircleDef; layerOpt?: MoveLayerSpec } | null => {
      if (!this.currentSpec) return null;
      const altHeld = altOverride ?? ev.altKey;
      const target = ev.target as Element | null;
      const labelGroup = target?.closest?.('[data-circle-id]') as Element | null;
      if (labelGroup) {
        const id = labelGroup.getAttribute('data-circle-id');
        const c = this.currentSpec.circles.find((x) => x.id === id) ?? null;
        if (!c) return null;
        // Clicking the label badge on a multi-layer circle turns the wide full circle (`a`),
        // or holds Alt to turn only the outer annulus slice (`2A`).
        const layerOpt: MoveLayerSpec | undefined =
          c.layerRadii && c.layerRadii.length > 1
            ? altHeld
              ? { layer: c.layerRadii.length }
              : { wide: true }
            : undefined;
        return { circle: c, layerOpt };
      }

      const pt = clientToMath(ev);
      if (!pt) return null;
      // Pick circle containing pt whose center is closest to pt (standard 'inside' circles first)
      let best: CircleDef | null = null;
      let bestDist = Infinity;
      for (const c of this.currentSpec.circles) {
        if (c.turnRegion === 'outside') continue;
        // Hidden (blocked) discovered grips should never intercept pointer hover/clicks
        if (c.discovered && this.currentStatuses[c.id]?.blocked) continue;
        const d = Math.hypot(pt.x - c.cx, pt.y - c.cy);
        if (d <= c.r && d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      // If not inside any standard circle, check exterior-turn ('outside') circles (e.g. Moonspinner)
      if (!best) {
        for (const c of this.currentSpec.circles) {
          if (c.turnRegion !== 'outside') continue;
          const d = Math.hypot(pt.x - c.cx, pt.y - c.cy);
          if (d > c.r) {
            return { circle: c };
          }
        }
        return null;
      }
      if (best.layerRadii && best.layerRadii.length > 1) {
        // Innermost disk (`A`): turns inner layer only.
        if (bestDist <= best.layerRadii[0]) {
          return { circle: best, layerOpt: { layer: 1 } };
        }
        // Outer ring(s): drag inner rings along by default (wide `a`).
        // Holding Alt/Option turns only that outer slice (`2A`) without dragging the inner ring!
        if (altHeld) {
          for (let i = 1; i < best.layerRadii.length; i++) {
            if (bestDist <= best.layerRadii[i]) {
              return { circle: best, layerOpt: { layer: i + 1 } };
            }
          }
          return { circle: best, layerOpt: { layer: best.layerRadii.length } };
        }
        return { circle: best, layerOpt: { wide: true } };
      }
      return { circle: best };
    };

    const sameHover = (
      a: { circleId: string; layerOpt?: MoveLayerSpec } | null,
      b: { circleId: string; layerOpt?: MoveLayerSpec } | null,
    ): boolean =>
      a?.circleId === b?.circleId &&
      a?.layerOpt?.layer === b?.layerOpt?.layer &&
      a?.layerOpt?.wide === b?.layerOpt?.wide;

    this.svg.addEventListener('mousemove', (ev) => {
      this.lastPointerEvent = ev;
      if (this.focusPickHandler) {
        if (this.hoveredHit !== null) {
          this.hoveredHit = null;
          this.updateHoverRing();
        }
        return;
      }
      const hit = pickCircleAt(ev);
      const next = hit ? { circleId: hit.circle.id, layerOpt: hit.layerOpt } : null;
      if (!sameHover(next, this.hoveredHit)) {
        this.hoveredHit = next;
        this.updateHoverRing();
      }
    });

    this.svg.addEventListener('mouseleave', () => {
      this.lastPointerEvent = null;
      if (this.hoveredHit !== null) {
        this.hoveredHit = null;
        this.updateHoverRing();
      }
    });

    const refreshHoverOnAlt = (ev: KeyboardEvent) => {
      if (this.focusPickHandler) return;
      if (ev.key !== 'Alt' || !this.lastPointerEvent || !this.hoveredHit) return;
      const hit = pickCircleAt(this.lastPointerEvent, ev.altKey);
      const next = hit ? { circleId: hit.circle.id, layerOpt: hit.layerOpt } : null;
      if (!sameHover(next, this.hoveredHit)) {
        this.hoveredHit = next;
        this.updateHoverRing();
      }
    };
    window.addEventListener('keydown', refreshHoverOnAlt);
    window.addEventListener('keyup', refreshHoverOnAlt);

    this.svg.addEventListener('click', (ev) => {
      if (this.focusPickHandler) {
        const pt = clientToMath(ev);
        if (pt) this.focusPickHandler(pt);
        return;
      }
      const hit = pickCircleAt(ev);
      if (!hit) return;
      const dir: 1 | -1 = ev.shiftKey ? -1 : 1;
      this.callbacks.onCircleClick(hit.circle.id, dir, hit.layerOpt);
    });

    this.svg.addEventListener('contextmenu', (ev) => {
      if (this.focusPickHandler) {
        ev.preventDefault();
        return;
      }
      const hit = pickCircleAt(ev);
      if (!hit) return;
      ev.preventDefault();
      this.callbacks.onCircleClick(hit.circle.id, -1, hit.layerOpt);
    });

    const WHEEL_THRESHOLD_PX = 95;
    const WHEEL_COOLDOWN_MS = 210;
    const WHEEL_RESET_GAP_MS = 240;

    this.svg.addEventListener(
      'wheel',
      (ev) => {
        if (this.focusPickHandler) return;
        const hit = pickCircleAt(ev);
        if (!hit) return;
        const c = hit.circle;
        ev.preventDefault();

        const now = performance.now();
        // Reset accumulator if switching circles or pausing between gestures
        if (this.wheelCircleId !== c.id || now - this.lastWheelEventMs > WHEEL_RESET_GAP_MS) {
          this.wheelAccum = 0;
          this.wheelCircleId = c.id;
        }
        this.lastWheelEventMs = now;

        // Absorb Mac trackpad momentum/inertia right after firing a turn
        if (now - this.lastWheelFireMs < WHEEL_COOLDOWN_MS) {
          this.wheelAccum = 0;
          return;
        }

        // Normalize deltaY across pixel / line / page wheel modes
        let deltaPx = ev.deltaY;
        if (ev.deltaMode === WheelEvent.DOM_DELTA_LINE) deltaPx *= 32;
        else if (ev.deltaMode === WheelEvent.DOM_DELTA_PAGE) deltaPx *= 120;
        if (deltaPx === 0) return;

        // If user reverses direction mid-gesture, flush opposite accumulated delta immediately
        if (this.wheelAccum !== 0 && Math.sign(deltaPx) !== Math.sign(this.wheelAccum)) {
          this.wheelAccum = 0;
        }
        this.wheelAccum += deltaPx;

        if (Math.abs(this.wheelAccum) >= WHEEL_THRESHOLD_PX) {
          const dir: 1 | -1 = this.wheelAccum > 0 ? 1 : -1;
          this.wheelAccum = 0;
          this.lastWheelFireMs = now;
          this.callbacks.onCircleClick(c.id, dir, hit.layerOpt);
        }
      },
      { passive: false },
    );
  }

  private updateHoverRing(): void {
    const hit = this.hoveredHit;
    let hoveredFree = false;
    if (hit && this.currentState) {
      const st = hit.layerOpt
        ? getCircleStatus(this.currentState, hit.circleId, hit.layerOpt)
        : this.currentStatuses[hit.circleId];
      hoveredFree = !st?.blocked;
    }

    for (const [id, node] of this.rimLabelNodes) {
      const isHoveredCircle = !!hit && id === hit.circleId;
      for (let ri = 0; ri < node.rims.length; ri++) {
        const rim = node.rims[ri];
        let isHoveredRim = false;
        if (isHoveredCircle && hit) {
          if (!hit.layerOpt || hit.layerOpt.wide) {
            // Single-layer or wide turn: highlight every rim of this circle (signals outer drags inner)
            isHoveredRim = true;
          } else if (hit.layerOpt.layer !== undefined) {
            isHoveredRim = ri + 1 === hit.layerOpt.layer;
          }
        }

        if (isHoveredRim && hoveredFree) {
          if (rim.style.stroke !== 'rgba(255, 255, 255, 0.8)') {
            rim.style.stroke = 'rgba(255, 255, 255, 0.8)';
            rim.style.strokeWidth = '0.048';
          }
        } else if (isHoveredRim && !hoveredFree) {
          if (rim.style.stroke !== 'rgba(244, 63, 94, 0.8)') {
            rim.style.stroke = 'rgba(244, 63, 94, 0.8)';
            rim.style.strokeWidth = '0.044';
          }
        } else if (rim.style.stroke !== '') {
          rim.style.stroke = '';
          rim.style.strokeWidth = '';
        }
      }
    }
  }

  /**
   * Enter or exit interactive focus-cycle picking mode: while active, clicking the puzzle
   * invokes `handler(mathPt)` to toggle cycles instead of turning circles.
   */
  public setFocusPickHandler(handler: ((pt: Point) => void) | null): void {
    this.focusPickHandler = handler;
    this.svg.classList.toggle('focus-picking', handler !== null);
    if (handler !== null && this.hoveredHit !== null) {
      this.hoveredHit = null;
      this.updateHoverRing();
    }
  }

  /**
   * Render (or clear when null) live piece-cycle arrows overlaid on the puzzle when hovering a macro.
   */
  public setCyclePreview(preview: CyclePreviewResult | null): void {
    if (!preview && this.previewLayer.childNodes.length === 0) return;
    if (!this.currentState) {
      this.previewLayer.innerHTML = '';
      return;
    }
    renderCyclePreviewOverlay(this.previewLayer, preview, this.currentSpec);
  }

  public cancelAnimation(skipFlashRestore = false): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.flashTimerId !== null) {
      clearTimeout(this.flashTimerId);
      this.flashTimerId = null;
      const restore = this.preFlashHighlight;
      this.preFlashHighlight = null;
      if (!skipFlashRestore && restore !== null && this.currentState) {
        this.render(this.currentState, restore, this.currentStatuses);
      }
    }
  }

  private updateViewBox(spec: PuzzleSpec): void {
    this.svg.setAttribute('viewBox', computePuzzleViewBox(spec));
  }

  public render(
    state: PuzzleState,
    highlight: RenderHighlight = {},
    statuses?: Record<string, CircleStatus>,
  ): void {
    this.cancelAnimation(true);
    this.preFlashHighlight = null;
    this.scrubCache = null;
    if (this.currentSpec !== state.spec) {
      this.hoveredHit = null;
      this.lastPointerEvent = null;
    }
    this.currentSpec = state.spec;
    this.currentState = state;
    this.currentStatuses = statuses ?? getAllCircleStatuses(state);
    this.currentHighlight = highlight;
    this.updateViewBox(state.spec);

    this.drawPieces(state, new Set(highlight.blockingPieceIds ?? []), null);
    this.drawRimsAndLabels(state.spec, this.currentStatuses, highlight.blockedCircleId);
  }

  private applyMovingTransform(
    angleDeg: number,
    pivot: { x: number; y: number },
    flipAxis: MirrorAxis | undefined,
    u: number,
  ): void {
    const px = pivot.x;
    const svgPy = -pivot.y;
    if (flipAxis) {
      const scale = Math.max(0.001, Math.abs(Math.cos(Math.PI * u)));
      const sx = flipAxis === 'y' ? scale : 1;
      const sy = flipAxis === 'x' ? scale : 1;
      this.movingLayer.setAttribute(
        'transform',
        `translate(${px.toFixed(4)} ${svgPy.toFixed(4)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${(-px).toFixed(4)} ${(-svgPy).toFixed(4)})`,
      );
    } else {
      const curDeg = angleDeg * u;
      this.movingLayer.setAttribute(
        'transform',
        `rotate(${curDeg.toFixed(3)} ${px.toFixed(4)} ${svgPy.toFixed(4)})`,
      );
    }
  }

  /**
   * Render a continuous mid-turn frame at fraction `frac` in (0, 1) of `step` starting from
   * `fromState`. Caches the base SVG DOM per (fromState, step, flip-half) so dragging the
   * scrubber inside a move updates only a single `transform` attribute at 60 fps.
   */
  public renderScrubFrame(
    fromState: PuzzleState,
    step: ExecutedStep,
    frac: number,
    statuses?: Record<string, CircleStatus>,
  ): void {
    this.cancelAnimation(true);
    this.preFlashHighlight = null;
    this.currentHighlight = {};
    const u = Math.max(0, Math.min(1, frac));
    if (step.fastForwarded) {
      this.render(u >= 0.5 ? step.stateAfter : fromState, {}, u >= 0.5 ? undefined : statuses);
      return;
    }

    const half: 0 | 1 = step.flipAxis && u >= 0.5 ? 1 : 0;
    const hitCache =
      this.scrubCache !== null &&
      this.scrubCache.fromState === fromState &&
      this.scrubCache.step === step &&
      this.scrubCache.half === half;

    if (!hitCache) {
      this.currentSpec = fromState.spec;
      this.currentState = fromState;
      this.currentStatuses = statuses ?? getAllCircleStatuses(fromState);
      this.updateViewBox(fromState.spec);
      const drawState = half === 1 ? step.stateAfter : fromState;
      this.drawPieces(drawState, new Set(), new Set(step.movedPieceIds));
      this.drawRimsAndLabels(fromState.spec, this.currentStatuses, undefined);
      this.scrubCache = { fromState, step, half };
    }

    this.applyMovingTransform(step.angleDeg, step.pivot, step.flipAxis, u);
  }

  /**
   * Smoothly animate a turn from `startFrac` to `endFrac` (default 0 → 1), then snap cleanly.
   */
  public animateTurn(
    anim: TurnAnimationSpec,
    highlightAfter: RenderHighlight,
    onDone?: () => void,
    statusesAfter?: Record<string, CircleStatus>,
  ): void {
    const prevStatuses =
      this.currentState === anim.fromState ? this.currentStatuses : undefined;
    this.cancelAnimation(true);
    this.preFlashHighlight = null;
    this.currentHighlight = {};
    this.scrubCache = null;

    const startFrac = anim.startFrac ?? 0;
    const endFrac = anim.endFrac ?? 1;
    const finalState = endFrac >= 0.5 ? anim.toState : anim.fromState;

    if (
      anim.durationMs <= 16 ||
      Math.abs(endFrac - startFrac) < 1e-4 ||
      (!anim.flipAxis && Math.abs(anim.angleDeg) < 1e-4)
    ) {
      this.render(finalState, highlightAfter, statusesAfter);
      anim.onProgress?.(endFrac);
      onDone?.();
      return;
    }

    this.currentSpec = anim.fromState.spec;
    this.currentState = anim.fromState;
    this.currentStatuses = prevStatuses ?? getAllCircleStatuses(anim.fromState);
    this.updateViewBox(anim.fromState.spec);

    const movedSet = new Set(anim.movedPieceIds);
    let curHalf: 0 | 1 = anim.flipAxis && startFrac >= 0.5 ? 1 : 0;
    this.drawPieces(curHalf === 1 ? anim.toState : anim.fromState, new Set(), movedSet);
    this.drawRimsAndLabels(
      anim.fromState.spec,
      this.currentStatuses,
      undefined,
    );
    this.applyMovingTransform(anim.angleDeg, anim.pivot, anim.flipAxis, startFrac);

    let startTime: number | null = null;

    const tick = (now: number) => {
      if (startTime === null) startTime = now;
      const t = Math.min(1, (now - startTime) / anim.durationMs);
      const u = startFrac + (endFrac - startFrac) * t;

      if (anim.flipAxis) {
        const nextHalf: 0 | 1 = u >= 0.5 ? 1 : 0;
        if (nextHalf !== curHalf) {
          curHalf = nextHalf;
          this.drawPieces(curHalf === 1 ? anim.toState : anim.fromState, new Set(), movedSet);
        }
      }
      this.applyMovingTransform(anim.angleDeg, anim.pivot, anim.flipAxis, u);
      anim.onProgress?.(u);

      if (t < 1) {
        this.animFrameId = requestAnimationFrame(tick);
      } else {
        this.animFrameId = null;
        this.movingLayer.removeAttribute('transform');
        this.render(finalState, highlightAfter, statusesAfter);
        onDone?.();
      }
    };

    this.animFrameId = requestAnimationFrame(tick);
  }

  /** Briefly flash a blocked circle + its blocking pieces when clicked directly. */
  public flashBlocked(circleId: string, blockingPieceIds: number[]): void {
    if (!this.currentState) return;
    const flashedState = this.currentState;
    const flashedStatuses = this.currentStatuses;
    // Preserve the true pre-flash highlight across rapid repeated clicks
    const baseHighlight = this.preFlashHighlight ?? this.currentHighlight;
    this.render(
      flashedState,
      {
        blockedCircleId: circleId,
        blockingPieceIds,
      },
      flashedStatuses,
    );
    this.preFlashHighlight = baseHighlight;
    this.flashTimerId = window.setTimeout(() => {
      this.flashTimerId = null;
      const restore = this.preFlashHighlight ?? {};
      this.preFlashHighlight = null;
      if (this.currentState === flashedState) {
        this.render(flashedState, restore, flashedStatuses);
      }
    }, 900);
  }

  private buildPieceElement(p: Piece, isBlocking: boolean): SVGElement {
    return buildPieceSvgNode(p, isBlocking, false);
  }

  private drawPieces(
    state: PuzzleState,
    blockingIds: Set<number>,
    movingIds: Set<number> | null,
  ): void {
    this.movingLayer.removeAttribute('transform');

    const needsRebuild =
      this.pieceNodesSpec !== state.spec || this.pieceNodes.size !== state.pieces.length;

    if (needsRebuild) {
      this.piecesLayer.innerHTML = '';
      this.movingLayer.innerHTML = '';
      this.pieceNodes.clear();
      this.pieceNodesSpec = state.spec;

      // Sort largest-first once per puzzle spec so smaller pieces draw cleanly on top
      const sorted = [...state.pieces].sort((a, b) => b.area - a.area);
      this.sortedPieceIds = sorted.map((p) => p.id);
      const deferredBlocking: SVGElement[] = [];

      for (const p of sorted) {
        const isBlocking = blockingIds.has(p.id);
        const inMoving = Boolean(movingIds && movingIds.has(p.id));
        const el = this.buildPieceElement(p, isBlocking);
        this.pieceNodes.set(p.id, {
          el,
          region: p.region,
          stickers: p.stickers,
          blocking: isBlocking,
          inMoving,
        });
        if (inMoving) {
          this.movingLayer.appendChild(el);
        } else if (isBlocking) {
          deferredBlocking.push(el);
        } else {
          this.piecesLayer.appendChild(el);
        }
      }
      for (const el of deferredBlocking) {
        this.piecesLayer.appendChild(el);
      }
      return;
    }

    // Fast path: reuse persistent SVG nodes by piece.id, touching ONLY moved or highlighted pieces!
    const pieceById = new Map<number, Piece>();
    for (const p of state.pieces) pieceById.set(p.id, p);

    const wasMovingEmpty = this.movingLayer.childNodes.length === 0;
    const returningToPieces = new Set<number>();
    let movingChanged = false;
    let movingCount = 0;
    const deferredBlocking: SVGElement[] = [];

    for (const id of this.sortedPieceIds) {
      const p = pieceById.get(id);
      const entry = this.pieceNodes.get(id);
      if (!p || !entry) continue;

      const wasBlocking = entry.blocking;
      const isBlocking = blockingIds.has(id);
      const wantMoving = Boolean(movingIds && movingIds.has(id));
      const geomChanged = entry.region !== p.region || entry.stickers !== p.stickers;

      if (geomChanged) {
        if (p.stickers && p.stickers.length > 0) {
          const nextEl = this.buildPieceElement(p, isBlocking);
          entry.el.replaceWith(nextEl);
          entry.el = nextEl;
          entry.blocking = isBlocking;
        } else {
          entry.el.setAttribute('d', regionToSvgPath(p.region));
        }
        entry.region = p.region;
        entry.stickers = p.stickers;
      }

      if (entry.blocking !== isBlocking) {
        const targetEl =
          p.stickers && p.stickers.length > 0
            ? (entry.el.lastElementChild ?? entry.el)
            : entry.el;
        targetEl.setAttribute('class', isBlocking ? 'puzzle-piece blocking' : 'puzzle-piece');
        entry.blocking = isBlocking;
      }
      if (wasBlocking && !isBlocking && !wantMoving) {
        returningToPieces.add(id);
      }

      if (entry.inMoving !== wantMoving) {
        entry.inMoving = wantMoving;
        if (wantMoving) {
          this.movingLayer.appendChild(entry.el);
          movingChanged = true;
        } else if (!isBlocking) {
          returningToPieces.add(id);
        }
      }
      if (wantMoving) movingCount++;

      if (!wantMoving && isBlocking) {
        deferredBlocking.push(entry.el);
      }
    }

    // Surgically insert ONLY returning/unblocking pieces into their exact canonical largest-first
    // slot in piecesLayer (touches ~30 nodes instead of re-appending all ~196 pieces!).
    if (returningToPieces.size > 0) {
      let nextAnchor: Node | null = null;
      for (let i = this.sortedPieceIds.length - 1; i >= 0; i--) {
        const id = this.sortedPieceIds[i];
        const entry = this.pieceNodes.get(id);
        if (!entry || entry.inMoving || entry.blocking) continue;
        if (returningToPieces.has(id) || entry.el.parentNode !== this.piecesLayer) {
          this.piecesLayer.insertBefore(entry.el, nextAnchor);
        }
        nextAnchor = entry.el;
      }
    }
    // Restore canonical largest-first z-order in movingLayer only when transitioning between
    // overlapping moving sets (when movingLayer started empty, appendChild above is already sorted).
    if (movingChanged && !wasMovingEmpty && movingCount > 1) {
      for (const id of this.sortedPieceIds) {
        const entry = this.pieceNodes.get(id);
        if (entry && entry.inMoving) {
          this.movingLayer.appendChild(entry.el);
        }
      }
    }
    for (const el of deferredBlocking) {
      this.piecesLayer.appendChild(el);
    }
  }

  private drawRimsAndLabels(
    spec: PuzzleSpec,
    statuses: Record<string, CircleStatus>,
    blockedCircleId?: string,
  ): void {
    if (this.rimLabelSpec !== spec) {
      this.rimsLayer.innerHTML = '';
      this.labelsLayer.innerHTML = '';
      this.rimLabelNodes.clear();
      this.rimLabelSpec = spec;

      const symCenter = spec.symmetryCenter ?? { x: 0, y: 0 };
      for (const c of spec.circles) {
        const radii = c.layerRadii && c.layerRadii.length > 1 ? c.layerRadii : [c.r];
        const rims: SVGCircleElement[] = [];
        for (let ri = 0; ri < radii.length; ri++) {
          const r = radii[ri];
          const isInner = ri < radii.length - 1;
          const rim = svgEl('circle', {
            cx: c.cx,
            cy: -c.cy,
            r,
            class: 'circle-rim free',
            'data-rim-id': c.id,
            'data-rim-layer': String(ri + 1),
            ...(isInner ? { 'stroke-dasharray': '0.07 0.045' } : {}),
          });
          this.rimsLayer.appendChild(rim);
          rims.push(rim);
        }

        const { lx, ly } = computeCircleLabelPosition(c, spec, symCenter);
        const labelG = svgEl('g', {
          class: 'circle-label-group',
          'data-circle-id': c.id,
        });
        const title = svgEl('title');
        const bg = svgEl('circle', {
          cx: lx,
          cy: ly,
          r: 0.175,
          class: c.discovered ? 'circle-label-bg discovered' : 'circle-label-bg',
          stroke: c.color,
        });
        const txt = svgEl('text', {
          x: lx,
          y: ly,
          class: 'circle-label-text',
        });
        txt.textContent = c.id;
        labelG.append(title, bg, txt);
        this.labelsLayer.appendChild(labelG);

        this.rimLabelNodes.set(c.id, {
          rims,
          labelG,
          bg,
          txt,
          title,
          visible: true,
          rimClass: 'circle-rim free',
          stroke: c.color,
          bgOpacity: '1',
          txtOpacity: '1',
        });
      }
    }

    for (const c of spec.circles) {
      const node = this.rimLabelNodes.get(c.id);
      if (!node) continue;
      const st = statuses[c.id];
      const isTargetBlocked = c.id === blockedCircleId;
      // Discovered grips stay completely hidden while blocked (unless explicitly targeted by a blocked move)
      const shouldShow = !(c.discovered && st?.blocked && !isTargetBlocked);

      if (node.visible !== shouldShow) {
        node.visible = shouldShow;
        const disp = shouldShow ? '' : 'none';
        for (const rim of node.rims) rim.style.display = disp;
        node.labelG.style.display = disp;
      }
      if (!shouldShow) continue;

      const rimClass = isTargetBlocked
        ? 'circle-rim target-blocked'
        : c.discovered
          ? 'circle-rim discovered-free'
          : st?.blocked
            ? 'circle-rim blocked'
            : 'circle-rim free';
      if (node.rimClass !== rimClass) {
        node.rimClass = rimClass;
        for (const rim of node.rims) {
          rim.setAttribute('class', rimClass);
        }
      }

      const nextTitle = st?.blocked
        ? `${c.discovered ? 'Discovered grip' : 'Circle'} ${c.id} — BLOCKED by ${st.blockingPieceIds.length} piece(s)`
        : c.discovered
          ? `Discovered grip ${c.id} — Unlocked! (click: CW, shift/right-click: CCW)`
          : c.turnRegion === 'outside'
            ? `Circle ${c.id} (exterior turn) — Free (click outer frame or badge: CW, shift/right-click: CCW)`
            : c.layerRadii && c.layerRadii.length > 1
              ? `Circle ${c.id} (multi-layer) — click inner for ${c.id}, outer ring or badge for wide ${c.id.toLowerCase()} (drags inner), Alt+click outer ring for slice 2${c.id}`
              : `Circle ${c.id} — Free (click: CW, shift/right-click: CCW)`;
      if (node.title.textContent !== nextTitle) {
        node.title.textContent = nextTitle;
      }

      const stroke = isTargetBlocked
        ? '#f43f5e'
        : c.discovered
          ? '#fbbf24'
          : st?.blocked
            ? '#475569'
            : c.color;
      if (node.stroke !== stroke) {
        node.stroke = stroke;
        node.bg.setAttribute('stroke', stroke);
      }
      const bgOpacity = st?.blocked && !isTargetBlocked ? '0.65' : '1';
      if (node.bgOpacity !== bgOpacity) {
        node.bgOpacity = bgOpacity;
        node.bg.setAttribute('opacity', bgOpacity);
      }
      const txtOpacity = st?.blocked && !isTargetBlocked ? '0.55' : '1';
      if (node.txtOpacity !== txtOpacity) {
        node.txtOpacity = txtOpacity;
        node.txt.setAttribute('opacity', txtOpacity);
      }
    }

    this.updateHoverRing();
  }
}
