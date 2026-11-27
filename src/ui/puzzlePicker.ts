import { PuzzleSpec, PuzzleState } from '../puzzle/types.ts';
import { renderStaticPuzzleSvg } from './svgRenderer.ts';

export interface PuzzlePickerOptions {
  getPuzzles: () => PuzzleSpec[];
  isCustomPuzzle: (id: string) => boolean;
  getOrBuildPuzzle: (spec: PuzzleSpec) => PuzzleState;
  getCurrentPuzzleId: () => string;
  onSelect: (puzzleId: string) => void;
  onOpenStudio: (forkSpec?: PuzzleSpec) => void;
  onDeleteCustom: (puzzleId: string) => void;
}

export interface PuzzlePickerController {
  open: () => void;
  close: () => void;
  invalidateThumb: (puzzleId: string) => void;
}

function describeStops(spec: PuzzleSpec): string {
  const stops = spec.circles[0]?.stopsDeg ?? [];
  if (stops.length === 0) return '';
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
  'Designer & Exotic':
    'Community and boutique 2D twisty puzzles from James Li, Dmitry Andreev (Pluton), El Cubitero, Galen Ivanov, Hooshang Cohan, Cube4you, and ThinkFun.',
  'Classic Circles':
    'Unbandaged and concentric 2-, 3-, 4-, 6-, and 7-circle puzzles great for exploring commutators, conjugates, and symmetries.',
  Custom:
    'Your custom RingTwist v1 JSON puzzles (saved locally in this browser and shareable via URL).',
};

/**
 * Masyu-inspired visual puzzle picker modal with live cached SVG thumbnails,
 * category tabs, JSON Studio fork/import buttons, and keyboard support.
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
          <div class="bp-subtitle">Select any 2D twisty circle puzzle — or inspect/design one in RingTwist JSON</div>
        </div>
        <div class="bp-header-actions">
          <button type="button" class="btn btn-primary btn-sm" id="bp-new-custom" title="Design or import a custom ringtwist/v1 JSON puzzle">+ Custom JSON</button>
          <button class="btn btn-sm" id="bp-close" aria-label="Close puzzle picker">✕ Close</button>
        </div>
      </div>
      <div class="bp-filter-bar" id="bp-filter-bar"></div>
      <div class="modal-body bp-body" id="bp-body"></div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const filterBar = backdrop.querySelector<HTMLElement>('#bp-filter-bar')!;
  const body = backdrop.querySelector<HTMLElement>('#bp-body')!;
  const closeBtn = backdrop.querySelector<HTMLButtonElement>('#bp-close')!;
  const newCustomBtn = backdrop.querySelector<HTMLButtonElement>('#bp-new-custom')!;

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

  const getCategories = (puzzles: PuzzleSpec[]): string[] => [
    'All',
    ...Array.from(new Set(puzzles.map((p) => p.category))),
  ];

  const renderFilters = () => {
    const puzzles = options.getPuzzles();
    const categories = getCategories(puzzles);
    if (!categories.includes(activeCategory)) activeCategory = 'All';

    filterBar.innerHTML = '';
    for (const cat of categories) {
      const count =
        cat === 'All'
          ? puzzles.length
          : puzzles.filter((p) => p.category === cat).length;
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
    const puzzles = options.getPuzzles();
    const categories = getCategories(puzzles);
    const currentId = options.getCurrentPuzzleId();
    const visibleCategories =
      activeCategory === 'All'
        ? categories.filter((c) => c !== 'All')
        : [activeCategory];

    for (const cat of visibleCategories) {
      const specs = puzzles.filter((p) => p.category === cat);
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
        const isCustom = options.isCustomPuzzle(spec.id);
        const { svgHtml, pieceCount } = getThumbInfo(spec);

        const cardWrap = document.createElement('div');
        cardWrap.className = `bp-card-wrap${isCurrent ? ' bp-current' : ''}`;

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
        const primaryCount = spec.circles.filter((c) => !c.discovered).length;
        const discoveredCount = spec.circles.length - primaryCount;
        const circleDesc =
          discoveredCount > 0
            ? `${primaryCount} circles + ${discoveredCount} discovered`
            : `${primaryCount} circles`;
        const parts = [circleDesc, `${pieceCount} pieces`, stopDesc].filter(Boolean);
        metaEl.textContent = parts.join(' · ');

        info.append(nameRow, blurbEl, metaEl);
        card.append(thumbWrap, info);

        card.addEventListener('click', () => {
          close();
          if (spec.id !== options.getCurrentPuzzleId()) {
            options.onSelect(spec.id);
          }
        });

        const actions = document.createElement('div');
        actions.className = 'bp-card-actions';

        const jsonBtn = document.createElement('button');
        jsonBtn.type = 'button';
        jsonBtn.className = 'bp-icon-btn';
        jsonBtn.textContent = '{ }';
        jsonBtn.title = isCustom
          ? `Edit ${spec.name} JSON`
          : `Inspect or fork ${spec.name} as RingTwist JSON`;
        jsonBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          close();
          options.onOpenStudio(spec);
        });
        actions.appendChild(jsonBtn);

        if (isCustom) {
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'bp-icon-btn bp-icon-btn-danger';
          delBtn.textContent = '×';
          delBtn.title = `Delete custom puzzle "${spec.name}"`;
          delBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            thumbHtmlCache.delete(spec.id);
            options.onDeleteCustom(spec.id);
            renderFilters();
            renderGrid();
          });
          actions.appendChild(delBtn);
        }

        cardWrap.append(card, actions);
        grid.appendChild(cardWrap);
      }

      sec.appendChild(grid);
      body.appendChild(sec);
    }
  };

  newCustomBtn.addEventListener('click', () => {
    close();
    options.onOpenStudio();
  });

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

  return {
    open,
    close,
    invalidateThumb: (id: string) => {
      thumbHtmlCache.delete(id);
    },
  };
}
