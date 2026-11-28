import { CyclePreviewResult } from '../puzzle/cyclePreview.ts';
import { PuzzleSpec } from '../puzzle/types.ts';
import { svgEl } from './svgStatic.ts';

/**
 * Render live piece-cycle arrows and in-place spin badges into `layer` (or clear when `preview` is null).
 */
export function renderCyclePreviewOverlay(
  layer: SVGGElement,
  preview: CyclePreviewResult | null,
  spec: PuzzleSpec | null,
): void {
  layer.innerHTML = '';
  if (!preview || !preview.ok) return;

  if (preview.blocked) {
    const target = spec?.circles.find((c) => c.id === preview.blocked!.circleId);
    if (target) {
      layer.appendChild(
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
    layer.appendChild(
      svgEl('path', {
        d: dCurve,
        fill: 'none',
        stroke: 'rgba(9, 14, 28, 0.82)',
        'stroke-width': fmt(0.068 * scale),
        'stroke-linecap': 'round',
        opacity: arrow.dimmed ? 0.25 : 1,
      }),
    );
    layer.appendChild(
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
    layer.appendChild(
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

    layer.appendChild(
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
    layer.appendChild(spinG);
  }
}
