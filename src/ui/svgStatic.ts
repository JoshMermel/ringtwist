import {
  ArcRegion,
  edgeEnd,
  edgePointAt,
  edgeStart,
  regionBounds,
  regionToSvgPath,
} from '../geom/arcRegion.ts';
import { CircleDef, Piece, PuzzleSpec, PuzzleState, StickerWedge } from '../puzzle/types.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

export function stickerWedgeToSvgPath(s: StickerWedge, decimals = 4): string {
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

export function buildPieceSvgNode(p: Piece, isBlocking: boolean, compact = false): SVGElement {
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

export function computeCircleLabelPosition(
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

  if (len < 1e-4) {
    return { lx: c.cx, ly: -c.cy };
  }
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
