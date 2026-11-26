import { PUZZLE_CATALOG } from '../puzzle/catalog.ts';
import { PuzzleSpec, PuzzleState } from '../puzzle/types.ts';
import { renderStaticPuzzleSvg } from './svgRenderer.ts';

export interface PuzzlePickerOptions {
  getOrBuildPuzzle: (spec: PuzzleSpec) => PuzzleState;
  getCurrentPuzzleId: () => string;
  onSelect: (puzzleId: string) => void;
}

export interface PuzzlePickerController {
  open: () => void;
  close: () => void;
}

function describeStops(spec: PuzzleSpec): string {
  const stops = spec.circles[0]?.stopsDeg ?? [];
  if (stops.length === 0) return '';
  // Check if every circle has the same even stop spacing
  const step = 360 / stops.length;
  const allSameEven = spec.circles.every(
    (c) =>
      c.stopsDeg.length === stops.length &&
      c.stopsDeg.every((a, i) => Math.abs(a - i * step) < 1e-3),
  );
  if (allSameEven) {
    return `${Math.round(step)}° stops`;
  }
  return 'uneven stops';
}

const CATEGORY_BLURBS: Record<string, string> = {
  'Geranium Family':
    'Authentic VeryPuzzle Geranium puzzles with golden-ratio circle spacing, blocking cuts, and unbandaged Plus variants.',
  'Classic Circles':
    'Unbandaged and concentric 2-, 4-, and 6-circle puzzles great for exploring commutators, conjugates, and symmetries.',
};

/**
 * Masyu-inspired visual puzzle picker modal with live cached SVG thumbnails,
 * category tabs, piece/circle metadata, and keyboard support.
 */
export function createPuzzlePickerModal(options: PuzzlePickerOptions): PuzzlePickerController {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'puzzle-picker-modal';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'bp-modal-title');

  backdrop.innerHTML = `
    <div class="modal bp-modal">
      <div class="modal-header">
        <div>
          <h2 id="bp-modal-title">Choose a Puzzle</h2>
          <div class="bp-subtitle">Select any 2D twisty circle puzzle — all geometry is computed analytically</div>
        </div>
        <button class="btn btn-sm" id="bp-close" aria-label="Close puzzle picker">✕ Close</button>
      </div>
      <div class="bp-filter-bar" id="bp-filter-bar"></div>
      <div class="modal-body bp-body" id="bp-body"></div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const filterBar = backdrop.querySelector<HTMLElement>('#bp-filter-bar')!;
  const body = backdrop.querySelector<HTMLElement>('#bp-body')!;
  const closeBtn = backdrop.querySelector<HTMLButtonElement>('#bp-close')!;

  // Cache rendered thumbnail SVG strings so reopening is instantaneous
  const thumbHtmlCache = new Map<string, { svgHtml: string; pieceCount: number }>();
  let activeCategory = 'All';

  const getThumbInfo = (spec: PuzzleSpec): { svgHtml: string; pieceCount: number } => {
    const cached = thumbHtmlCache.get(spec.id);
    if (cached) return cached;
    const state = options.getOrBuildPuzzle(spec);
    const svg = renderStaticPuzzleSvg(state, {
      showLabels: false,
      compact: true,
      className: 'bp-thumb-svg',
    });
    const info = { svgHtml: svg.outerHTML, pieceCount: state.pieces.length };
    thumbHtmlCache.set(spec.id, info);
    return info;
  };

  const categories = ['All', ...Array.from(new Set(PUZZLE_CATALOG.map((p) => p.category)))];

  const renderFilters = () => {
    filterBar.innerHTML = '';
    for (const cat of categories) {
      const count =
        cat === 'All'
          ? PUZZLE_CATALOG.length
          : PUZZLE_CATALOG.filter((p) => p.category === cat).length;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `bp-filter-pill ${activeCategory === cat ? 'active' : ''}`;
      pill.textContent = `${cat} (${count})`;
      pill.addEventListener('click', () => {
        activeCategory = cat;
        renderFilters();
        renderGrid();
      });
      filterBar.appendChild(pill);
    }
  };

  const renderGrid = () => {
    body.innerHTML = '';
    const currentId = options.getCurrentPuzzleId();
    const visibleCategories =
      activeCategory === 'All'
        ? categories.filter((c) => c !== 'All')
        : [activeCategory];

    for (const cat of visibleCategories) {
      const specs = PUZZLE_CATALOG.filter((p) => p.category === cat);
      if (specs.length === 0) continue;

      const sec = document.createElement('section');
      sec.className = 'bp-section';

      const head = document.createElement('div');
      head.className = 'bp-section-head';
      const title = document.createElement('h3');
      title.className = 'bp-title';
      title.textContent = cat;
      head.appendChild(title);
      if (CATEGORY_BLURBS[cat]) {
        const blurb = document.createElement('p');
        blurb.className = 'bp-blurb';
        blurb.textContent = CATEGORY_BLURBS[cat];
        head.appendChild(blurb);
      }
      sec.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'bp-cards';

      for (const spec of specs) {
        const isCurrent = spec.id === currentId;
        const { svgHtml, pieceCount } = getThumbInfo(spec);

        const card = document.createElement('button');
        card.type = 'button';
        card.className = `bp-card${isCurrent ? ' bp-current' : ''}`;
        card.dataset.puzzleId = spec.id;
        if (isCurrent) card.setAttribute('aria-current', 'true');

        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'bp-thumb';
        thumbWrap.innerHTML = svgHtml;

        const info = document.createElement('div');
        info.className = 'bp-card-info';

        const nameRow = document.createElement('div');
        nameRow.className = 'bp-card-name-row';
        const nameEl = document.createElement('span');
        nameEl.className = 'bp-card-name';
        nameEl.textContent = spec.name;
        nameRow.appendChild(nameEl);
        if (isCurrent) {
          const badge = document.createElement('span');
          badge.className = 'bp-current-badge';
          badge.textContent = 'Active';
          nameRow.appendChild(badge);
        }

        const blurbEl = document.createElement('span');
        blurbEl.className = 'bp-card-blurb';
        blurbEl.textContent = spec.description;

        const metaEl = document.createElement('span');
        metaEl.className = 'bp-card-meta';
        const stopDesc = describeStops(spec);
        const parts = [
          `${spec.circles.length} circles`,
          `${pieceCount} pieces`,
          stopDesc,
        ].filter(Boolean);
        metaEl.textContent = parts.join(' · ');

        info.append(nameRow, blurbEl, metaEl);
        card.append(thumbWrap, info);

        card.addEventListener('click', () => {
          close();
          if (spec.id !== options.getCurrentPuzzleId()) {
            options.onSelect(spec.id);
          }
        });

        grid.appendChild(card);
      }

      sec.appendChild(grid);
      body.appendChild(sec);
    }
  };

  const open = () => {
    renderFilters();
    renderGrid();
    backdrop.classList.add('open');
    requestAnimationFrame(() => {
      const cur = body.querySelector<HTMLElement>('.bp-card.bp-current');
      cur?.scrollIntoView({ block: 'nearest' });
      cur?.focus();
    });
  };

  const close = () => {
    backdrop.classList.remove('open');
  };

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) {
      close();
    }
  });

  return { open, close };
}
