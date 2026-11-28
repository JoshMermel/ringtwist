import {
  ArcRegion,
  edgeEnd,
  edgePointAt,
  edgeStart,
  regionBounds,
  regionToSvgPath,
} from '../geom/arcRegion.ts';
import { Point } from '../geom/math.ts';
import { ExecutedStep } from '../lang/evaluator.ts';
import { CyclePreviewResult } from '../puzzle/cyclePreview.ts';
import { CircleStatus, MoveLayerSpec, getAllCircleStatuses, getCircleStatus } from '../puzzle/engine.ts';
import { CircleDef, MirrorAxis, Piece, PuzzleSpec, PuzzleState, StickerWedge } from '../puzzle/types.ts';

function stickerWedgeToSvgPath(s: StickerWedge, decimals = 4): string {
  const fmt = (n: number) => Number(n.toFixed(decimals)).toString();
  const start = edgeStart(s.arc);
  const sweepFlag = s.arc.sweep > 0 ? 0 : 1;
  const segments = Math.max(1, Math.ceil(Math.abs(s.arc.sweep) / (Math.PI * 0.44)));
  const parts = [`M ${fmt(s.apex.x)} ${fmt(-s.apex.y)}`, `L ${fmt(start.x)} ${fmt(-start.y)}`];
  for (let i = 1; i <= segments; i++) {
    const pt = i === segments ? edgeEnd(s.arc) : edgePointAt(s.arc, i / segments);
    parts.push(`A ${fmt(s.arc.r)} ${fmt(s.arc.r)} 0 0 ${sweepFlag} ${fmt(pt.x)} ${fmt(-pt.y)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

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

export function computePuzzleViewBox(spec: PuzzleSpec, padRatio = 0.12, minPad = 0.42): string {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const c of spec.circles) {
    minX = Math.min(minX, c.cx - c.r);
    maxX = Math.max(maxX, c.cx + c.r);
    minY = Math.min(minY, -c.cy - c.r);
    maxY = Math.max(maxY, -c.cy + c.r);
  }
  if (spec.viewBounds) {
    minX = Math.min(minX, spec.viewBounds.minX);
    maxX = Math.max(maxX, spec.viewBounds.maxX);
    minY = Math.min(minY, -spec.viewBounds.maxY);
    maxY = Math.max(maxY, -spec.viewBounds.minY);
  }

  const span = Math.max(maxX - minX, maxY - minY);
  const pad = Math.max(minPad, span * padRatio);
  return `${(minX - pad).toFixed(3)} ${(minY - pad).toFixed(3)} ${(maxX - minX + pad * 2).toFixed(3)} ${(maxY - minY + pad * 2).toFixed(3)}`;
}

function buildPieceSvgNode(p: Piece, isBlocking: boolean, compact = false): SVGElement {
  const strokeW = compact ? '0.022' : undefined;
  if (!p.stickers || p.stickers.length === 0) {
    const attrs: Record<string, string | number> = {
      d: regionToSvgPath(p.region),
      fill: p.color,
      class: isBlocking ? 'puzzle-piece blocking' : 'puzzle-piece',
      'data-piece-id': p.id,
    };
    if (strokeW) attrs['stroke-width'] = strokeW;
    return svgEl('path', attrs);
  }

  const g = svgEl('g', { 'data-piece-id': p.id });
  for (const s of p.stickers) {
    g.appendChild(
      svgEl('path', {
        d: stickerWedgeToSvgPath(s),
        fill: s.color,
        stroke: 'rgba(9, 14, 28, 0.5)',
        'stroke-width': compact ? 0.018 : 0.012,
        'stroke-linejoin': 'round',
      }),
    );
  }
  const apex = p.stickers[0].apex;
  g.appendChild(
    svgEl('circle', {
      cx: apex.x,
      cy: -apex.y,
      r: 0.055,
      fill: '#0f172a',
      stroke: 'rgba(248, 250, 252, 0.55)',
      'stroke-width': 0.012,
    }),
  );
  const outlineAttrs: Record<string, string | number> = {
    d: regionToSvgPath(p.region),
    fill: 'none',
    class: isBlocking ? 'puzzle-piece blocking' : 'puzzle-piece',
  };
  if (strokeW) outlineAttrs['stroke-width'] = strokeW;
  g.appendChild(svgEl('path', outlineAttrs));
  return g;
}

function computeCircleLabelPosition(
  c: CircleDef,
  spec: PuzzleSpec,
  symCenter: { x: number; y: number },
): { lx: number; ly: number } {
  if (c.labelPos) {
    return { lx: c.labelPos.x, ly: -c.labelPos.y };
  }
  // Discovered internal grips sit inside the primary circles; place their badge right at
  // their own center so they clearly mark the newly aligned disk without colliding with outer labels.
  if (c.discovered) {
    return { lx: c.cx, ly: -c.cy };
  }
  const labelDist = c.r + 0.22;
  const candidates: [number, number][] = [];

  let dx = c.cx - symCenter.x;
  let dy = c.cy - symCenter.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) {
    candidates.push([0, 1], [0, -1], [1, 0], [-1, 0]);
  } else {
    dx /= len;
    dy /= len;
    candidates.push([dx, dy], [0, 1], [0, -1], [-dx, -dy]);
  }

  // Pick the first candidate that doesn't land inside any other primary circle
  for (const [ux, uy] of candidates) {
    const px = c.cx + ux * labelDist;
    const py = c.cy + uy * labelDist;
    const insideOther = spec.circles.some(
      (o) => !o.discovered && o.id !== c.id && Math.hypot(px - o.cx, py - o.cy) < o.r + 0.12,
    );
    if (!insideOther) {
      return { lx: px, ly: -py };
    }
  }

  // If this circle sits right at the symmetry center (surrounded by outer circles),
  // place its badge right at its center so it doesn't collide with outer circle labels.
  if (len < 1e-4) {
    return { lx: c.cx, ly: -c.cy };
  }

  // Fallback: directly above the circle
  return { lx: c.cx, ly: -(c.cy + labelDist) };
}

/**
 * Render a lightweight static SVG snapshot of a PuzzleState — used for
 * the Solved Reference preview card and visual Puzzle Picker thumbnails.
 */
export function renderStaticPuzzleSvg(
  state: PuzzleState,
  options: { showLabels?: boolean; compact?: boolean; className?: string } = {},
): SVGSVGElement {
  const showLabels = options.showLabels ?? false;
  const compact = options.compact ?? !showLabels;
  const svg = svgEl('svg', {
    class: options.className ?? 'static-puzzle-svg',
    viewBox: computePuzzleViewBox(
      state.spec,
      showLabels ? 0.13 : 0.06,
      showLabels ? 0.36 : 0.14,
    ),
    'aria-hidden': 'true',
  });

  const sorted = [...state.pieces].sort((a, b) => b.area - a.area);
  const piecesG = svgEl('g');
  for (const p of sorted) {
    piecesG.appendChild(buildPieceSvgNode(p, false, compact));
  }
  svg.appendChild(piecesG);

  const rimsG = svgEl('g');
  for (const c of state.spec.circles) {
    if (c.discovered) continue;
    const radii = c.layerRadii && c.layerRadii.length > 1 ? c.layerRadii : [c.r];
    for (let ri = 0; ri < radii.length; ri++) {
      const r = radii[ri];
      const isInner = ri < radii.length - 1;
      rimsG.appendChild(
        svgEl('circle', {
          cx: c.cx,
          cy: -c.cy,
          r,
          fill: 'none',
          stroke: isInner ? 'rgba(226, 232, 240, 0.55)' : 'rgba(226, 232, 240, 0.45)',
          'stroke-width': compact ? 0.032 : 0.024,
          ...(isInner ? { 'stroke-dasharray': '0.07 0.045' } : {}),
        }),
      );
    }
  }
  svg.appendChild(rimsG);

  if (showLabels) {
    const symCenter = state.spec.symmetryCenter ?? { x: 0, y: 0 };
    const labelsG = svgEl('g');
    for (const c of state.spec.circles) {
      if (c.discovered) continue;
      const { lx, ly } = computeCircleLabelPosition(c, state.spec, symCenter);
      labelsG.appendChild(
        svgEl('circle', {
          cx: lx,
          cy: ly,
          r: 0.17,
          class: 'circle-label-bg',
          stroke: c.color,
        }),
      );
      const txt = svgEl('text', {
        x: lx,
        y: ly,
        class: 'circle-label-text',
      });
      txt.textContent = c.id;
      labelsG.appendChild(txt);
    }
    svg.appendChild(labelsG);
  }

  return svg;
}

/**
 * Render a crisp miniature SVG silhouette of a single piece's geometric shape —
 * used as visual shape-type chips in the per-macro focus picker.
 */
export function renderPieceSilhouetteSvg(
  region: ArcRegion,
  className = 'focus-shape-svg',
): SVGSVGElement {
  const b = regionBounds(region);
  const svgMinX = b.minX;
  const svgMaxX = b.maxX;
  const svgMinY = -b.maxY;
  const svgMaxY = -b.minY;
  const cx = (svgMinX + svgMaxX) * 0.5;
  const cy = (svgMinY + svgMaxY) * 0.5;
  const span = Math.max(svgMaxX - svgMinX, svgMaxY - svgMinY, 0.05);
  const pad = span * 0.16;
  const size = span + pad * 2;

  const svg = svgEl('svg', {
    class: className,
    viewBox: `${(cx - size * 0.5).toFixed(4)} ${(cy - size * 0.5).toFixed(4)} ${size.toFixed(4)} ${size.toFixed(4)}`,
    'aria-hidden': 'true',
  });
  svg.appendChild(
    svgEl('path', {
      d: regionToSvgPath(region),
      fill: 'currentColor',
      'fill-opacity': '0.32',
      stroke: 'currentColor',
      'stroke-width': (span * 0.085).toFixed(4),
      'stroke-linejoin': 'round',
    }),
  );
  return svg;
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
    const rims = this.rimsLayer.querySelectorAll<SVGCircleElement>('[data-rim-id]');
    const hit = this.hoveredHit;
    let hoveredFree = false;
    if (hit && this.currentState) {
      const st = hit.layerOpt
        ? getCircleStatus(this.currentState, hit.circleId, hit.layerOpt)
        : this.currentStatuses[hit.circleId];
      hoveredFree = !st?.blocked;
    }

    for (const rim of rims) {
      const id = rim.getAttribute('data-rim-id');
      const layerNum = parseInt(rim.getAttribute('data-rim-layer') ?? '1', 10);
      const isHoveredCircle = !!hit && id === hit.circleId;
      let isHoveredRim = false;
      if (isHoveredCircle && hit) {
        if (!hit.layerOpt || hit.layerOpt.wide) {
          // Single-layer or wide turn: highlight every rim of this circle (signals outer drags inner)
          isHoveredRim = true;
        } else if (hit.layerOpt.layer !== undefined) {
          isHoveredRim = layerNum === hit.layerOpt.layer;
        }
      }

      if (isHoveredRim && hoveredFree) {
        rim.style.stroke = 'rgba(255, 255, 255, 0.8)';
        rim.style.strokeWidth = '0.048';
      } else if (isHoveredRim && !hoveredFree) {
        rim.style.stroke = 'rgba(244, 63, 94, 0.8)';
        rim.style.strokeWidth = '0.044';
      } else {
        rim.style.stroke = '';
        rim.style.strokeWidth = '';
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
    this.previewLayer.innerHTML = '';
    if (!preview || !preview.ok || !this.currentState) return;

    if (preview.blocked) {
      const target = this.currentSpec?.circles.find((c) => c.id === preview.blocked!.circleId);
      if (target) {
        this.previewLayer.appendChild(
          svgEl('circle', {
            cx: target.cx,
            cy: -target.cy,
            r: target.r,
            fill: 'none',
            stroke: '#f43f5e',
            'stroke-width': 0.06,
            'stroke-dasharray': '0.12 0.08',
            opacity: 0.9,
          }),
        );
      }
      return;
    }

    const fmt = (n: number) => Number(n.toFixed(4)).toString();
    // Smoothly slim down arrows when many active pieces move at once so dense macros stay readable
    const activeArrowCount = preview.arrows.filter((a) => !a.dimmed).length;
    const denseScale = activeArrowCount > 14 ? 0.62 : activeArrowCount > 8 ? 0.78 : 1.0;
    const baseOpacity = activeArrowCount > 14 ? 0.78 : activeArrowCount > 8 ? 0.88 : 0.96;

    // Draw dimmed (unselected in focus-pick mode) arrows underneath bright focused ones
    const orderedArrows = [
      ...preview.arrows.filter((a) => a.dimmed),
      ...preview.arrows.filter((a) => !a.dimmed),
    ];

    for (const arrow of orderedArrows) {
      const x1 = arrow.from.x;
      const y1 = -arrow.from.y;
      const x2 = arrow.to.x;
      const y2 = -arrow.to.y;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) continue;

      const scale = arrow.dimmed ? Math.min(denseScale, 0.7) : denseScale;
      const opacity = arrow.dimmed ? 0.24 : baseOpacity;

      // Arch slightly to the right of chord so 2-cycles form clean non-overlapping lenses
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      const bend = Math.min(0.28, Math.max(0.08, len * 0.16));
      const cx = (x1 + x2) / 2 + nx * bend;
      const cy = (y1 + y2) / 2 + ny * bend;

      // Trim start/end slightly so dots and arrowheads sit cleanly inside pieces
      const trimEnd = Math.min(0.09, len * 0.18);
      const tx = x2 - cx;
      const ty = y2 - cy;
      const tLen = Math.hypot(tx, ty) || 1;
      const tux = tx / tLen;
      const tuy = ty / tLen;
      const tipX = x2 - tux * (trimEnd * 0.35);
      const tipY = y2 - tuy * (trimEnd * 0.35);
      const shaftEndX = tipX - tux * (0.075 * scale);
      const shaftEndY = tipY - tuy * (0.075 * scale);

      const dCurve = `M ${fmt(x1)} ${fmt(y1)} Q ${fmt(cx)} ${fmt(cy)} ${fmt(shaftEndX)} ${fmt(shaftEndY)}`;

      // Dark casing underneath so arrows pop crisply over bright yellow/white/orange pieces
      this.previewLayer.appendChild(
        svgEl('path', {
          d: dCurve,
          fill: 'none',
          stroke: 'rgba(9, 14, 28, 0.82)',
          'stroke-width': fmt(0.068 * scale),
          'stroke-linecap': 'round',
          opacity: arrow.dimmed ? 0.25 : 1,
        }),
      );
      this.previewLayer.appendChild(
        svgEl('path', {
          d: dCurve,
          fill: 'none',
          stroke: arrow.color,
          'stroke-width': fmt(0.036 * scale),
          'stroke-linecap': 'round',
          opacity,
        }),
      );

      // Origin dot
      this.previewLayer.appendChild(
        svgEl('circle', {
          cx: fmt(x1),
          cy: fmt(y1),
          r: fmt(0.042 * scale),
          fill: arrow.color,
          stroke: '#090e1c',
          'stroke-width': fmt(0.018 * scale),
          opacity,
        }),
      );

      // Crisp geometric arrowhead aligned with tangent at tip
      const headLen = 0.12 * scale;
      const headHalfW = 0.068 * scale;
      const baseX = tipX - tux * headLen;
      const baseY = tipY - tuy * headLen;
      const pnx = -tuy;
      const pny = tux;
      const leftX = baseX + pnx * headHalfW;
      const leftY = baseY + pny * headHalfW;
      const rightX = baseX - pnx * headHalfW;
      const rightY = baseY - pny * headHalfW;

      this.previewLayer.appendChild(
        svgEl('path', {
          d: `M ${fmt(tipX)} ${fmt(tipY)} L ${fmt(leftX)} ${fmt(leftY)} L ${fmt(rightX)} ${fmt(rightY)} Z`,
          fill: arrow.color,
          stroke: '#090e1c',
          'stroke-width': fmt(0.016 * scale),
          'stroke-linejoin': 'round',
          opacity,
        }),
      );
    }

    // Crisp directional circular arc + arrowhead + angle badge for in-place rotations
    const orderedSpins = [
      ...preview.spins.filter((s) => s.dimmed),
      ...preview.spins.filter((s) => !s.dimmed),
    ];
    for (const spin of orderedSpins) {
      const sx = spin.point.x;
      const sy = -spin.point.y;
      const cw = spin.angleDeg >= 0;
      const spinOpacity = spin.dimmed ? 0.25 : 1;
      const r = Math.min(0.24, Math.max(0.15, Math.sqrt(Math.max(spin.area, 0.04) / Math.PI) * 0.62));
      const startRad = cw ? (-125 * Math.PI) / 180 : (-55 * Math.PI) / 180;
      const sweepRad = cw ? (260 * Math.PI) / 180 : (-260 * Math.PI) / 180;
      const endRad = startRad + sweepRad;
      const ax1 = sx + r * Math.cos(startRad);
      const ay1 = sy + r * Math.sin(startRad);
      const ax2 = sx + r * Math.cos(endRad);
      const ay2 = sy + r * Math.sin(endRad);
      const sweepFlag = cw ? 1 : 0;
      const arcD = `M ${fmt(ax1)} ${fmt(ay1)} A ${fmt(r)} ${fmt(r)} 0 1 ${sweepFlag} ${fmt(ax2)} ${fmt(ay2)}`;

      const spinG = svgEl('g', { opacity: spinOpacity });
      spinG.appendChild(
        svgEl('path', {
          d: arcD,
          fill: 'none',
          stroke: 'rgba(9, 14, 28, 0.9)',
          'stroke-width': 0.068,
          'stroke-linecap': 'round',
        }),
      );
      spinG.appendChild(
        svgEl('path', {
          d: arcD,
          fill: 'none',
          stroke: spin.color,
          'stroke-width': 0.036,
          'stroke-linecap': 'round',
        }),
      );

      // Directional arrowhead tangent to end of circular arc
      const tanRad = endRad + (cw ? Math.PI / 2 : -Math.PI / 2);
      const tux = Math.cos(tanRad);
      const tuy = Math.sin(tanRad);
      const tipX = ax2 + tux * 0.04;
      const tipY = ay2 + tuy * 0.04;
      const headLen = 0.115;
      const headHalfW = 0.065;
      const baseX = tipX - tux * headLen;
      const baseY = tipY - tuy * headLen;
      const pnx = -tuy;
      const pny = tux;
      spinG.appendChild(
        svgEl('path', {
          d: `M ${fmt(tipX)} ${fmt(tipY)} L ${fmt(baseX + pnx * headHalfW)} ${fmt(baseY + pny * headHalfW)} L ${fmt(baseX - pnx * headHalfW)} ${fmt(baseY - pny * headHalfW)} Z`,
          fill: spin.color,
          stroke: '#090e1c',
          'stroke-width': 0.016,
          'stroke-linejoin': 'round',
        }),
      );

      // Clean center angle badge (e.g. "72°" or "144°")
      const labelTxt = `${Math.abs(Math.round(spin.angleDeg))}°`;
      spinG.appendChild(
        svgEl('rect', {
          x: fmt(sx - 0.145),
          y: fmt(sy - 0.085),
          width: 0.29,
          height: 0.17,
          rx: 0.075,
          fill: 'rgba(9, 14, 28, 0.92)',
          stroke: spin.color,
          'stroke-width': 0.018,
        }),
      );
      const degEl = svgEl('text', {
        x: fmt(sx),
        y: fmt(sy),
        class: 'spin-angle-text',
      });
      degEl.textContent = labelTxt;
      spinG.appendChild(degEl);
      this.previewLayer.appendChild(spinG);
    }
  }

  public cancelAnimation(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.flashTimerId !== null) {
      clearTimeout(this.flashTimerId);
      this.flashTimerId = null;
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
    this.cancelAnimation();
    this.scrubCache = null;
    this.currentSpec = state.spec;
    this.currentState = state;
    this.currentStatuses = statuses ?? getAllCircleStatuses(state);
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
    this.cancelAnimation();
    const u = Math.max(0, Math.min(1, frac));
    if (step.fastForwarded) {
      this.render(u >= 0.5 ? step.stateAfter : fromState, {}, statuses);
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
    this.cancelAnimation();
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
    this.render(
      flashedState,
      {
        blockedCircleId: circleId,
        blockingPieceIds,
      },
      flashedStatuses,
    );
    this.flashTimerId = window.setTimeout(() => {
      this.flashTimerId = null;
      if (this.currentState === flashedState) {
        this.render(flashedState, {}, flashedStatuses);
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
    this.piecesLayer.innerHTML = '';
    this.movingLayer.innerHTML = '';
    this.movingLayer.removeAttribute('transform');

    // Draw larger pieces first, smaller pieces on top for clean crisp strokes
    const sorted = [...state.pieces].sort((a, b) => b.area - a.area);
    const deferredBlocking: SVGElement[] = [];

    for (const p of sorted) {
      const isBlocking = blockingIds.has(p.id);
      const el = this.buildPieceElement(p, isBlocking);

      if (movingIds && movingIds.has(p.id)) {
        this.movingLayer.appendChild(el);
      } else if (isBlocking) {
        deferredBlocking.push(el);
      } else {
        this.piecesLayer.appendChild(el);
      }
    }

    // Place blocking pieces on top so their glowing highlight isn't occluded
    for (const el of deferredBlocking) {
      this.piecesLayer.appendChild(el);
    }
  }

  private drawRimsAndLabels(
    spec: PuzzleSpec,
    statuses: Record<string, CircleStatus>,
    blockedCircleId?: string,
  ): void {
    this.rimsLayer.innerHTML = '';
    this.labelsLayer.innerHTML = '';

    const symCenter = spec.symmetryCenter ?? { x: 0, y: 0 };

    for (const c of spec.circles) {
      const st = statuses[c.id];
      const isTargetBlocked = c.id === blockedCircleId;
      // Discovered grips stay completely hidden while blocked (unless explicitly targeted by a blocked move)
      if (c.discovered && st?.blocked && !isTargetBlocked) continue;

      const rimClass = isTargetBlocked
        ? 'circle-rim target-blocked'
        : c.discovered
          ? 'circle-rim discovered-free'
          : st?.blocked
            ? 'circle-rim blocked'
            : 'circle-rim free';

      const radii = c.layerRadii && c.layerRadii.length > 1 ? c.layerRadii : [c.r];
      for (let ri = 0; ri < radii.length; ri++) {
        const r = radii[ri];
        const isInner = ri < radii.length - 1;
        const rim = svgEl('circle', {
          cx: c.cx,
          cy: -c.cy,
          r,
          class: rimClass,
          'data-rim-id': c.id,
          'data-rim-layer': String(ri + 1),
          ...(isInner ? { 'stroke-dasharray': '0.07 0.045' } : {}),
        });
        this.rimsLayer.appendChild(rim);
      }

      // Position label cleanly outside this circle without landing inside any sibling circle
      const { lx, ly } = computeCircleLabelPosition(c, spec, symCenter);

      const g = svgEl('g', {
        class: 'circle-label-group',
        'data-circle-id': c.id,
      });

      const title = svgEl('title');
      if (st?.blocked) {
        title.textContent = `${c.discovered ? 'Discovered grip' : 'Circle'} ${c.id} — BLOCKED by ${st.blockingPieceIds.length} piece(s)`;
      } else if (c.discovered) {
        title.textContent = `Discovered grip ${c.id} — Unlocked! (click: CW, shift/right-click: CCW)`;
      } else if (c.turnRegion === 'outside') {
        title.textContent = `Circle ${c.id} (exterior turn) — Free (click outer frame or badge: CW, shift/right-click: CCW)`;
      } else if (c.layerRadii && c.layerRadii.length > 1) {
        title.textContent = `Circle ${c.id} (multi-layer) — click inner for ${c.id}, outer ring or badge for wide ${c.id.toLowerCase()} (drags inner), Alt+click outer ring for slice 2${c.id}`;
      } else {
        title.textContent = `Circle ${c.id} — Free (click: CW, shift/right-click: CCW)`;
      }
      g.appendChild(title);

      const bg = svgEl('circle', {
        cx: lx,
        cy: ly,
        r: 0.175,
        class: c.discovered ? 'circle-label-bg discovered' : 'circle-label-bg',
        stroke: isTargetBlocked
          ? '#f43f5e'
          : c.discovered
            ? '#fbbf24'
            : st?.blocked
              ? '#475569'
              : c.color,
        opacity: st?.blocked && !isTargetBlocked ? 0.65 : 1,
      });
      const txt = svgEl('text', {
        x: lx,
        y: ly,
        class: 'circle-label-text',
        opacity: st?.blocked && !isTargetBlocked ? 0.55 : 1,
      });
      txt.textContent = c.id;

      g.append(bg, txt);
      this.labelsLayer.appendChild(g);
    }

    this.updateHoverRing();
  }
}
