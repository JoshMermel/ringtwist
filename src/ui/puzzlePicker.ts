import { PuzzleSpec, PuzzleState } from '../puzzle/types.ts';
import { renderStaticPuzzleSvg } from './svgRenderer.ts';

export interface PuzzlePickerOptions {
  getPuzzles: () => PuzzleSpec[];
  getOrBuildPuzzle: (spec: PuzzleSpec) => PuzzleState;
  getCurrentPuzzleId: () => string;
  onSelect: (puzzleId: string) => void;
}

export interface PuzzlePickerController {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
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

function formatCircleMeta(spec: PuzzleSpec, pieceCount?: number): string {
  const stopDesc = describeStops(spec);
  const primaryCount = spec.circles.filter((c) => !c.discovered).length;
  const discoveredCount = spec.circles.length - primaryCount;
  const circleDesc =
    discoveredCount > 0
      ? `${primaryCount} circles + ${discoveredCount} discovered`
      : `${primaryCount} circles`;
  const parts = [
    circleDesc,
    pieceCount !== undefined ? `${pieceCount} pieces` : '',
    stopDesc,
  ].filter(Boolean);
  return parts.join(' · ');
}

const CATEGORY_BLURBS: Record<string, string> = {
  'Geranium Family':
    'Authentic VeryPuzzle Geranium puzzles with golden-ratio circle spacing, blocking cuts, and unbandaged Plus variants.',
  'Designer & Exotic':
    'Community and boutique 2D twisty puzzles from James Li, Dmitry Andreev (Pluton), El Cubitero, Galen Ivanov, Hooshang Cohan, Cube4you, and ThinkFun.',
  'Classic Circles':
    'Unbandaged and concentric 2-, 3-, 4-, 6-, and 7-circle puzzles great for exploring commutators, conjugates, and symmetries.',
};

interface CardRecord {
  spec: PuzzleSpec;
  card: HTMLButtonElement;
  thumbWrap: HTMLElement;
  nameRow: HTMLElement;
  metaEl: HTMLElement;
  hydrated: boolean;
}

/**
 * Visual puzzle picker modal with lazy viewport-driven SVG thumbnails and cached DOM cards.
 * Opens instantaneously without blocking the main thread to build all 41 puzzles upfront.
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
        <h2 id="bp-modal-title">Puzzles</h2>
        <button class="btn btn-sm btn-ghost" id="bp-close" aria-label="Close puzzle picker">Esc</button>
      </div>
      <div class="bp-filter-bar" id="bp-filter-bar"></div>
      <div class="modal-body bp-body" id="bp-body"></div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const filterBar = backdrop.querySelector<HTMLElement>('#bp-filter-bar')!;
  const body = backdrop.querySelector<HTMLElement>('#bp-body')!;
  const closeBtn = backdrop.querySelector<HTMLButtonElement>('#bp-close')!;

  let activeCategory = 'All';
  let mounted = false;
  const sectionsByCategory = new Map<string, HTMLElement>();
  const cardsById = new Map<string, CardRecord>();
  const pendingQueue: CardRecord[] = [];
  const queuedIds = new Set<string>();
  let hydrateRafId: number | null = null;

  const hydrateCard = (rec: CardRecord) => {
    if (rec.hydrated) return;
    rec.hydrated = true;
    const state = options.getOrBuildPuzzle(rec.spec);
    const svg = renderStaticPuzzleSvg(state, {
      showLabels: false,
      compact: true,
      className: 'bp-thumb-svg',
    });
    rec.thumbWrap.innerHTML = '';
    rec.thumbWrap.appendChild(svg);
    rec.metaEl.textContent = formatCircleMeta(rec.spec, state.pieces.length);
  };

  const pumpHydration = () => {
    hydrateRafId = null;
    if (!backdrop.classList.contains('open')) return;
    // Build at least 1 card per frame and cap work at ~8ms so modal scrolling stays 60fps
    const frameStart = performance.now();
    let processed = 0;
    while (pendingQueue.length > 0 && (processed === 0 || performance.now() - frameStart < 8)) {
      const rec = pendingQueue.shift()!;
      queuedIds.delete(rec.spec.id);
      if (rec.hydrated) continue;
      hydrateCard(rec);
      processed++;
      if (processed >= 3) break;
    }
    if (pendingQueue.length > 0) {
      hydrateRafId = requestAnimationFrame(pumpHydration);
    }
  };

  const enqueueCard = (rec: CardRecord, highPriority = false) => {
    if (rec.hydrated || queuedIds.has(rec.spec.id)) return;
    queuedIds.add(rec.spec.id);
    if (highPriority) pendingQueue.unshift(rec);
    else pendingQueue.push(rec);
    if (hydrateRafId === null && backdrop.classList.contains('open')) {
      hydrateRafId = requestAnimationFrame(pumpHydration);
    }
  };

  const observer =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const id = (entry.target as HTMLElement).dataset.puzzleId;
              if (!id) continue;
              const rec = cardsById.get(id);
              if (rec) {
                observer?.unobserve(entry.target);
                enqueueCard(rec, true);
              }
            }
          },
          { root: body, rootMargin: '180px 0px' },
        )
      : null;

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
        cat === 'All' ? puzzles.length : puzzles.filter((p) => p.category === cat).length;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `bp-filter-pill ${activeCategory === cat ? 'active' : ''}`;
      pill.textContent = `${cat} (${count})`;
      pill.addEventListener('click', () => {
        activeCategory = cat;
        renderFilters();
        applyCategoryFilter();
      });
      filterBar.appendChild(pill);
    }
  };

  const applyCategoryFilter = () => {
    for (const [cat, sec] of sectionsByCategory) {
      const visible = activeCategory === 'All' || activeCategory === cat;
      sec.hidden = !visible;
      if (visible && !observer) {
        sec.querySelectorAll<HTMLElement>('.bp-card').forEach((el) => {
          const rec = el.dataset.puzzleId ? cardsById.get(el.dataset.puzzleId) : undefined;
          if (rec) enqueueCard(rec);
        });
      }
    }
  };

  const syncCurrentHighlight = () => {
    const currentId = options.getCurrentPuzzleId();
    for (const rec of cardsById.values()) {
      const isCurrent = rec.spec.id === currentId;
      rec.card.classList.toggle('bp-current', isCurrent);
      if (isCurrent) {
        rec.card.setAttribute('aria-current', 'true');
        if (!rec.nameRow.querySelector('.bp-current-badge')) {
          const badge = document.createElement('span');
          badge.className = 'bp-current-badge';
          badge.textContent = 'Active';
          rec.nameRow.appendChild(badge);
        }
        // Current puzzle is already built in app cache — hydrate it immediately
        hydrateCard(rec);
      } else {
        rec.card.removeAttribute('aria-current');
        rec.nameRow.querySelector('.bp-current-badge')?.remove();
      }
    }
  };

  const mountCardsOnce = () => {
    if (mounted) return;
    mounted = true;
    const puzzles = options.getPuzzles();
    const categories = getCategories(puzzles).filter((c) => c !== 'All');

    for (const cat of categories) {
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
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'bp-card';
        card.dataset.puzzleId = spec.id;

        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'bp-thumb';

        const info = document.createElement('div');
        info.className = 'bp-card-info';

        const nameRow = document.createElement('div');
        nameRow.className = 'bp-card-name-row';
        const nameEl = document.createElement('span');
        nameEl.className = 'bp-card-name';
        nameEl.textContent = spec.name;
        nameRow.appendChild(nameEl);

        const blurbEl = document.createElement('span');
        blurbEl.className = 'bp-card-blurb';
        blurbEl.textContent = spec.description;

        const metaEl = document.createElement('span');
        metaEl.className = 'bp-card-meta';
        metaEl.textContent = formatCircleMeta(spec);

        info.append(nameRow, blurbEl, metaEl);
        card.append(thumbWrap, info);

        card.addEventListener('click', () => {
          close();
          if (spec.id !== options.getCurrentPuzzleId()) {
            options.onSelect(spec.id);
          }
        });

        grid.appendChild(card);

        const rec: CardRecord = { spec, card, thumbWrap, nameRow, metaEl, hydrated: false };
        cardsById.set(spec.id, rec);
        if (observer) {
          observer.observe(card);
        } else {
          enqueueCard(rec);
        }
      }

      sec.appendChild(grid);
      sectionsByCategory.set(cat, sec);
      body.appendChild(sec);
    }
  };

  const open = () => {
    mountCardsOnce();
    renderFilters();
    applyCategoryFilter();
    syncCurrentHighlight();
    backdrop.classList.add('open');
    if (pendingQueue.length > 0 && hydrateRafId === null) {
      hydrateRafId = requestAnimationFrame(pumpHydration);
    }
    requestAnimationFrame(() => {
      const cur = body.querySelector<HTMLElement>('.bp-card.bp-current');
      cur?.scrollIntoView({ block: 'nearest' });
      cur?.focus();
    });
  };

  const close = () => {
    backdrop.classList.remove('open');
    if (hydrateRafId !== null) {
      cancelAnimationFrame(hydrateRafId);
      hydrateRafId = null;
    }
  };
  const isOpen = () => backdrop.classList.contains('open');

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      close();
    }
  });

  return { open, close, isOpen };
}
