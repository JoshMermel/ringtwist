import { MacroLibraryEntry } from '../lang/evaluator.ts';
import {
  parseMacroLibraryText,
  serializeMacroLibraryToText,
} from '../lang/focusDirectives.ts';
import { isReservedMoveName, parseAlgorithm } from '../lang/parser.ts';
import {
  CyclePreviewResult,
  computeMacroCyclePreview,
  resolveFocusTypeSet,
  toggleFocusType,
  toggleFocusTypeAtPoint,
} from '../puzzle/cyclePreview.ts';
import { PuzzleSpec, PuzzleState } from '../puzzle/types.ts';
import { saveMacros } from './storage.ts';
import { PuzzleSvgRenderer, renderPieceSilhouetteSvg } from './svgRenderer.ts';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function stripCommentsAndFlatten(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/(?:\/\/|#).*$/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
  }
  return Promise.resolve(false);
}

export interface MacroLibraryHost {
  getSpec: () => PuzzleSpec;
  getSolvedState: () => PuzzleState;
  getDisplayedState: () => PuzzleState;
  getMacros: () => MacroLibraryEntry[];
  setMacros: (next: MacroLibraryEntry[]) => void;
  getEditorSelectionOrAll: () => string;
  getEditorValue: () => string;
  setEditorValue: (text: string) => void;
  insertMacroToken: (token: string) => void;
  prepareForFocusPick: () => void;
  onMacrosChanged: (jumpToEnd: boolean) => void;
  onFocusTypesChanged: () => void;
  showToast: (msg: string) => void;
}

/**
 * Owns the Macro Library panel: List/Text views, on-demand `+ Save Macro` bar,
 * plain-text sheet apply/copy, hidden helpers toggle, hover cycle previews (LRU cached),
 * and interactive per-macro piece-type Focus Pick Mode.
 */
export class MacroLibraryPanel {
  private renderer: PuzzleSvgRenderer;
  private host: MacroLibraryHost;

  private saveMacroBarEl: HTMLFormElement;
  private saveMacroNameInput: HTMLInputElement;
  private saveMacroBodyInput: HTMLInputElement;
  private macroListPanelEl: HTMLElement;
  private macroTextPanelEl: HTMLElement;
  private macroTextAreaEl: HTMLTextAreaElement;
  private macroTextErrorEl: HTMLElement;
  private macroListEl: HTMLElement;
  private viewToggleBtns: NodeListOf<HTMLButtonElement>;
  private cyclePreviewPillEl: HTMLElement;
  private focusPickBarEl: HTMLElement;

  private view: 'list' | 'text' = 'list';
  private showHiddenMacros = false;
  private editingFocusMacroName: string | null = null;
  private cyclePreviewCache = new WeakMap<PuzzleState, Map<string, CyclePreviewResult>>();
  private lastMacroListKey = '';

  constructor(root: HTMLElement, renderer: PuzzleSvgRenderer, host: MacroLibraryHost) {
    this.renderer = renderer;
    this.host = host;

    this.saveMacroBarEl = root.querySelector('#save-macro-bar')!;
    this.saveMacroNameInput = root.querySelector('#save-macro-name')!;
    this.saveMacroBodyInput = root.querySelector('#save-macro-body')!;
    this.macroListPanelEl = root.querySelector('#macro-list-panel')!;
    this.macroTextPanelEl = root.querySelector('#macro-text-panel')!;
    this.macroTextAreaEl = root.querySelector('#macro-text-area')!;
    this.macroTextErrorEl = root.querySelector('#macro-text-error')!;
    this.macroListEl = root.querySelector('#macro-list')!;
    this.viewToggleBtns = root.querySelectorAll<HTMLButtonElement>(
      '#macro-view-toggle .preview-mode-btn',
    );
    this.cyclePreviewPillEl = root.querySelector('#cycle-preview-pill')!;
    this.focusPickBarEl = root.querySelector('#focus-pick-bar')!;

    this.bindEvents(root);
  }

  private bindEvents(root: HTMLElement): void {
    root.querySelector('#btn-save-sel')!.addEventListener('click', () => {
      const body = stripCommentsAndFlatten(this.host.getEditorSelectionOrAll());
      if (!body) {
        this.host.showToast('Select or type moves first');
        return;
      }
      this.setView('list');
      this.saveMacroBodyInput.value = body;
      this.saveMacroNameInput.value = '';
      this.saveMacroBarEl.hidden = false;
      this.saveMacroNameInput.focus();
    });

    root.querySelector('#btn-save-macro-cancel')!.addEventListener('click', () => {
      this.saveMacroBarEl.hidden = true;
    });

    this.saveMacroBarEl.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = this.saveMacroNameInput.value.trim();
      const body = stripCommentsAndFlatten(this.saveMacroBodyInput.value);
      if (!name || !body) {
        this.host.showToast('Macro name and moves are required');
        return;
      }
      const ctx = this.getMacroParseContext();
      if (
        isReservedMoveName(
          name,
          new Set(ctx.validCircleIds),
          new Set(ctx.multiLayerCircleIds),
        )
      ) {
        this.host.showToast(`"${name}" is a reserved move name`);
        return;
      }
      const parsed = parseAlgorithm(body, ctx.validCircleIds, ctx.multiLayerCircleIds);
      if (parsed.errors.length > 0) {
        this.host.showToast(`Invalid macro moves: ${parsed.errors[0].message}`);
        return;
      }
      if (parsed.statements.some((s) => s.kind === 'macroDef')) {
        this.host.showToast('Nested "=" is not allowed inside a macro body');
        return;
      }
      if (!parsed.statements.some((s) => s.kind === 'exprStmt')) {
        this.host.showToast('Macro body must contain at least one move');
        return;
      }
      if (this.editingFocusMacroName === name) {
        this.exitFocusPickMode();
      }
      const next = [...this.host.getMacros()];
      const idx = next.findIndex((m) => m.name === name);
      if (idx >= 0) next[idx] = { ...next[idx], body };
      else next.push({ name, body });
      this.host.setMacros(next);
      saveMacros(this.host.getSpec().id, next);
      this.cyclePreviewCache = new WeakMap();
      this.saveMacroBarEl.hidden = true;
      this.render(true);
      this.host.onMacrosChanged(false);
      this.host.showToast(`Saved macro "${name}"`);
    });

    this.viewToggleBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setView(btn.dataset.view === 'text' ? 'text' : 'list');
      });
    });

    root.querySelector('#btn-copy-macros')!.addEventListener('click', () => {
      const text =
        this.view === 'text'
          ? this.macroTextAreaEl.value
          : serializeMacroLibraryToText(this.host.getMacros());
      if (!text.trim()) {
        this.host.showToast('Macro Library is empty');
        return;
      }
      copyTextToClipboard(text).then((ok) => {
        if (ok) this.host.showToast('Copied Macro Library text to clipboard');
        else window.prompt('Copy Macro Library text:', text);
      });
    });

    root.querySelector('#btn-macro-text-cancel')!.addEventListener('click', () => {
      this.setView('list');
    });

    root.querySelector('#btn-macro-text-apply')!.addEventListener('click', () => {
      this.applyTextSheet();
    });

    this.macroTextAreaEl.addEventListener('keydown', (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
        ev.preventDefault();
        this.applyTextSheet();
      }
    });
  }

  public isEditingFocus(): boolean {
    return this.editingFocusMacroName !== null;
  }

  public isSaveBarOpen(): boolean {
    return !this.saveMacroBarEl.hidden;
  }

  public closeSaveBar(): void {
    this.saveMacroBarEl.hidden = true;
  }

  public clearCache(): void {
    this.cyclePreviewCache = new WeakMap();
  }

  public resetForPuzzleSwitch(): void {
    this.exitFocusPickMode();
    this.clearCyclePreview();
    this.saveMacroBarEl.hidden = true;
    this.showHiddenMacros = false;
    this.setView('list');
    this.cyclePreviewCache = new WeakMap();
    this.lastMacroListKey = '';
  }

  public setView(view: 'list' | 'text'): void {
    this.view = view;
    if (view === 'text') {
      this.exitFocusPickMode();
      this.clearCyclePreview();
      this.saveMacroBarEl.hidden = true;
      this.macroTextAreaEl.value = serializeMacroLibraryToText(this.host.getMacros());
      this.macroTextErrorEl.hidden = true;
      this.macroTextErrorEl.textContent = '';
    }
    this.macroListPanelEl.hidden = view !== 'list';
    this.macroTextPanelEl.hidden = view !== 'text';
    this.viewToggleBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    if (view === 'text') {
      this.macroTextAreaEl.focus();
    }
  }

  public moveEditorMacrosToLibrary(): void {
    const parsed = parseMacroLibraryText(this.host.getEditorValue(), {
      ...this.getMacroParseContext(),
      allowNonMacroLines: true,
    });
    if (parsed.errors.length > 0) {
      this.host.showToast(`Could not move macros: ${parsed.errors[0]}`);
      return;
    }
    if (parsed.entries.length === 0) return;
    this.exitFocusPickMode();

    const next = [...this.host.getMacros()];
    for (const entry of parsed.entries) {
      const idx = next.findIndex((m) => m.name === entry.name);
      if (idx >= 0) next[idx] = entry;
      else next.push(entry);
    }
    this.host.setMacros(next);
    saveMacros(this.host.getSpec().id, next);
    this.cyclePreviewCache = new WeakMap();

    this.host.setEditorValue(parsed.remainingText);
    this.setView('list');
    this.render(true);
    this.host.onMacrosChanged(true);
    this.host.showToast(
      `Moved ${parsed.entries.length} ${parsed.entries.length === 1 ? 'macro' : 'macros'} to Macro Library`,
    );
  }

  public clearCyclePreview(): void {
    if (this.editingFocusMacroName) return;
    this.renderer.setCyclePreview(null);
    this.cyclePreviewPillEl.hidden = true;
  }

  public exitFocusPickMode(): void {
    if (!this.editingFocusMacroName) return;
    this.editingFocusMacroName = null;
    this.renderer.setFocusPickHandler(null);
    this.renderer.setCyclePreview(null);
    this.focusPickBarEl.hidden = true;
    this.cyclePreviewPillEl.hidden = true;
    this.render(true);
  }

  public render(force = false): void {
    const macros = this.host.getMacros();
    const key = JSON.stringify([macros, this.showHiddenMacros, this.editingFocusMacroName]);
    if (!force && key === this.lastMacroListKey) return;
    this.lastMacroListKey = key;

    this.macroListEl.innerHTML = '';

    if (macros.length === 0) {
      this.macroListEl.innerHTML =
        '<div class="empty-state">No macros. Click <b>+ Macro</b> or switch to <b>Text</b>.</div>';
      return;
    }

    const visibleMacros = macros.filter((m) => !m.hidden);
    const hiddenMacros = macros.filter((m) => m.hidden);

    const addRow = (entry: MacroLibraryEntry, isHiddenHelper = false) => {
      const focusTypes = entry.focusTypes;
      const focusCount = focusTypes?.length ?? 0;
      const isEditingFocus = this.editingFocusMacroName === entry.name;
      const row = document.createElement('div');
      row.className = `macro-item${isHiddenHelper ? ' hidden-helper' : ''}${isEditingFocus ? ' editing-focus' : ''}`;
      row.innerHTML = `
        <div class="macro-item-top">
          <div class="macro-meta">
            <div class="macro-name-row">
              <span class="macro-name">${escapeHtml(entry.name)}</span>
              ${isHiddenHelper ? '<span class="macro-badge">helper</span>' : ''}
            </div>
            <div class="macro-body" title="${escapeHtml(entry.body)}">${escapeHtml(entry.body)}</div>
          </div>
          <div class="macro-btns">
            <button class="btn btn-sm btn-ghost" data-act="insert" title="Insert ${escapeHtml(entry.name)} at cursor">+</button>
            <button class="btn btn-sm btn-ghost" data-act="inv" title="Insert inverse ${escapeHtml(entry.name)}' at cursor">'</button>
            <button class="btn btn-sm btn-ghost macro-focus-btn${focusCount > 0 ? ' has-focus' : ''}${isEditingFocus ? ' active' : ''}" data-act="focus" title="${
              focusCount > 0
                ? `Focusing ${focusCount} piece ${focusCount === 1 ? 'type' : 'types'} on hover — click to edit (Alt-hover peeks all)`
                : 'Filter piece types highlighted on hover'
            }">◎${focusCount > 0 ? ` ${focusCount}` : ''}</button>
          </div>
        </div>
        ${entry.note ? `<div class="macro-note">${escapeHtml(entry.note)}</div>` : ''}
      `;

      const insertBtn = row.querySelector<HTMLButtonElement>('[data-act="insert"]')!;
      const invBtn = row.querySelector<HTMLButtonElement>('[data-act="inv"]')!;

      // Bind forward preview on the row container so moving across meta/note/Insert never flickers
      row.addEventListener('mouseenter', (ev) =>
        this.previewMacroCycles(entry.body, entry.name, focusTypes, (ev as MouseEvent).altKey),
      );
      row.addEventListener('mouseleave', () => this.clearCyclePreview());
      insertBtn.addEventListener('focus', () =>
        this.previewMacroCycles(entry.body, entry.name, focusTypes),
      );
      insertBtn.addEventListener('blur', () => this.clearCyclePreview());
      invBtn.addEventListener('mouseenter', (ev) =>
        this.previewMacroCycles(
          `${entry.name}'`,
          `${entry.name}'`,
          focusTypes,
          (ev as MouseEvent).altKey,
        ),
      );
      invBtn.addEventListener('mouseleave', (ev) => {
        if (row.contains(ev.relatedTarget as Node | null)) {
          this.previewMacroCycles(entry.body, entry.name, focusTypes, (ev as MouseEvent).altKey);
        }
      });
      invBtn.addEventListener('focus', () =>
        this.previewMacroCycles(`${entry.name}'`, `${entry.name}'`, focusTypes),
      );
      invBtn.addEventListener('blur', () => this.clearCyclePreview());

      insertBtn.addEventListener('click', () => {
        this.exitFocusPickMode();
        this.clearCyclePreview();
        this.host.insertMacroToken(entry.name);
      });
      invBtn.addEventListener('click', () => {
        this.exitFocusPickMode();
        this.clearCyclePreview();
        this.host.insertMacroToken(`${entry.name}'`);
      });
      row.querySelector('[data-act="focus"]')?.addEventListener('click', () => {
        this.enterFocusPickMode(entry.name);
      });

      this.macroListEl.appendChild(row);
    };

    // Preserve section notes even when the first macro in a section is marked `@hide`
    const sectionNoteBySection = new Map<string, string>();
    for (const m of macros) {
      if (m.section && m.sectionNote && !sectionNoteBySection.has(m.section)) {
        sectionNoteBySection.set(m.section, m.sectionNote);
      }
    }

    let lastSection: string | undefined;
    for (const m of visibleMacros) {
      if (m.section !== lastSection) {
        if (m.section) {
          const heading = document.createElement('div');
          heading.className = 'macro-section-heading';
          heading.textContent = m.section;
          this.macroListEl.appendChild(heading);
          const secNoteText = m.sectionNote ?? sectionNoteBySection.get(m.section);
          if (secNoteText) {
            const secNote = document.createElement('div');
            secNote.className = 'macro-section-note';
            secNote.textContent = secNoteText;
            this.macroListEl.appendChild(secNote);
          }
        } else if (lastSection !== undefined) {
          const heading = document.createElement('div');
          heading.className = 'macro-section-heading';
          heading.textContent = 'Other Macros';
          this.macroListEl.appendChild(heading);
        }
        lastSection = m.section;
      }
      addRow(m, false);
    }

    if (hiddenMacros.length > 0) {
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'macro-hidden-toggle';
      toggleBtn.id = 'btn-toggle-hidden-macros';
      const n = hiddenMacros.length;
      toggleBtn.textContent = this.showHiddenMacros
        ? `▾ Hide ${n} hidden ${n === 1 ? 'helper' : 'helpers'} (@hide)`
        : `▸ Show ${n} hidden ${n === 1 ? 'helper' : 'helpers'} (@hide)`;
      toggleBtn.addEventListener('click', () => {
        this.showHiddenMacros = !this.showHiddenMacros;
        this.render();
      });
      this.macroListEl.appendChild(toggleBtn);

      if (this.showHiddenMacros) {
        for (const m of hiddenMacros) addRow(m, true);
      }
    }
  }

  private getMacroParseContext(): {
    reservedNames: Set<string>;
    validCircleIds: string[];
    multiLayerCircleIds: string[];
  } {
    const spec = this.host.getSpec();
    const validCircleIds = spec.circles.map((c) => c.id);
    const multiLayerCircleIds = spec.circles
      .filter((c) => c.layerRadii && c.layerRadii.length > 1)
      .map((c) => c.id);
    return {
      reservedNames: new Set([
        ...validCircleIds,
        ...multiLayerCircleIds.map((id) => id.toLowerCase()),
        'x',
        'y',
        'z',
      ]),
      validCircleIds,
      multiLayerCircleIds,
    };
  }

  private applyTextSheet(): void {
    const parsed = parseMacroLibraryText(this.macroTextAreaEl.value, this.getMacroParseContext());
    if (parsed.errors.length > 0) {
      this.macroTextErrorEl.hidden = false;
      this.macroTextErrorEl.textContent = parsed.errors.slice(0, 3).join(' · ');
      return;
    }
    this.macroTextErrorEl.hidden = true;
    this.macroTextErrorEl.textContent = '';
    this.host.setMacros(parsed.entries);
    saveMacros(this.host.getSpec().id, parsed.entries);
    this.cyclePreviewCache = new WeakMap();
    this.setView('list');
    this.render(true);
    this.host.onMacrosChanged(false);
    this.host.showToast(
      `Updated Macro Library (${parsed.entries.length} ${parsed.entries.length === 1 ? 'macro' : 'macros'})`,
    );
  }

  private previewMacroCycles(
    algSource: string,
    label: string,
    focusTypes?: string[],
    ignoreFocus = false,
  ): void {
    if (this.editingFocusMacroName) return;
    const curState = this.host.getDisplayedState();
    const activeFocus = ignoreFocus ? undefined : focusTypes;
    const focusKey = activeFocus ? activeFocus.join(',') : '';
    const cacheKey = `${focusKey}|${algSource}`;
    let stateMap = this.cyclePreviewCache.get(curState);
    if (!stateMap) {
      stateMap = new Map();
      this.cyclePreviewCache.set(curState, stateMap);
    }
    let res = stateMap.get(cacheKey);
    if (!res) {
      res = computeMacroCyclePreview(curState, algSource, this.host.getMacros(), label, {
        focusTypes: activeFocus,
        solvedState: this.host.getSolvedState(),
      });
      if (stateMap.size >= 64) {
        const firstKey = stateMap.keys().next().value;
        if (firstKey !== undefined) stateMap.delete(firstKey);
      }
      stateMap.set(cacheKey, res);
    }
    this.renderer.setCyclePreview(res);
    this.cyclePreviewPillEl.hidden = false;
    this.cyclePreviewPillEl.className = `cycle-preview-pill${res.blocked ? ' blocked' : ''}`;
    this.cyclePreviewPillEl.textContent = `Preview ${label}: ${res.summary}`;
  }

  private enterFocusPickMode(macroName: string): void {
    if (this.editingFocusMacroName === macroName) {
      this.exitFocusPickMode();
      return;
    }
    if (!this.host.getMacros().some((m) => m.name === macroName)) return;
    this.host.prepareForFocusPick();
    this.editingFocusMacroName = macroName;
    this.renderer.setFocusPickHandler((pt) => this.handleFocusPickClick(pt));
    this.renderFocusPickOverlay();
    this.render(true);
  }

  private updateMacroFocusTypes(macroName: string, nextFocusTypes: string[]): void {
    const next = [...this.host.getMacros()];
    const idx = next.findIndex((m) => m.name === macroName);
    if (idx < 0) return;
    const entry = next[idx];
    if (nextFocusTypes.length > 0) {
      next[idx] = { ...entry, focusTypes: nextFocusTypes };
    } else {
      const { focusTypes: _removed, ...rest } = entry;
      next[idx] = rest;
    }
    this.host.setMacros(next);
    saveMacros(this.host.getSpec().id, next);
    this.host.onFocusTypesChanged();
    this.cyclePreviewCache = new WeakMap();
    this.renderFocusPickOverlay();
    this.render(true);
  }

  private handleFocusPickClick(pt: { x: number; y: number }): void {
    if (!this.editingFocusMacroName) return;
    const macros = this.host.getMacros();
    const entry = macros.find((m) => m.name === this.editingFocusMacroName);
    if (!entry) {
      this.exitFocusPickMode();
      return;
    }
    const curState = this.host.getDisplayedState();
    const solvedState = this.host.getSolvedState();
    const fullPreview = computeMacroCyclePreview(curState, entry.body, macros, entry.name, {
      solvedState,
    });
    if (!fullPreview.ok || fullPreview.blocked) return;

    const nextFocus = toggleFocusTypeAtPoint(
      entry.focusTypes,
      curState,
      fullPreview,
      pt,
      solvedState,
    );
    if (nextFocus === null) return;
    this.updateMacroFocusTypes(entry.name, nextFocus);
  }

  private renderFocusPickOverlay(): void {
    if (!this.editingFocusMacroName) return;
    const macros = this.host.getMacros();
    const entry = macros.find((m) => m.name === this.editingFocusMacroName);
    if (!entry) {
      this.exitFocusPickMode();
      return;
    }
    const curState = this.host.getDisplayedState();
    const solvedState = this.host.getSolvedState();
    const res = computeMacroCyclePreview(curState, entry.body, macros, entry.name, {
      focusTypes: entry.focusTypes,
      solvedState,
      includeDimmed: true,
    });
    this.renderer.setCyclePreview(res);

    const selectedShapes = resolveFocusTypeSet(solvedState, entry.focusTypes);
    const selCount = selectedShapes.size;
    this.focusPickBarEl.hidden = false;
    this.focusPickBarEl.innerHTML = `
      <div class="focus-pick-header">
        <span class="focus-pick-text">
          🎯 <strong>Focus “${escapeHtml(entry.name)}”</strong>: pick piece types below or click pieces on board
          ${
            selCount > 0
              ? `<span class="focus-pick-count">(${selCount} ${selCount === 1 ? 'type' : 'types'})</span>`
              : '<span class="focus-pick-count">(all shown)</span>'
          }
        </span>
        <div class="focus-pick-actions">
          ${selCount > 0 ? '<button type="button" class="btn btn-sm" id="btn-focus-clear">Clear</button>' : ''}
          <button type="button" class="btn btn-primary btn-sm" id="btn-focus-done">Done</button>
        </div>
      </div>
      <div class="focus-shape-chips" id="focus-shape-chips"></div>
    `;

    const chipsEl = this.focusPickBarEl.querySelector<HTMLElement>('#focus-shape-chips')!;
    if (res.pieceTypes.length === 0) {
      chipsEl.innerHTML = `<span class="focus-pick-count">${res.blocked ? escapeHtml(res.summary) : 'No pieces moved from current state'}</span>`;
    } else {
      for (const pt of res.pieceTypes) {
        const isSelected = selectedShapes.has(pt.shapeType);
        const isDimmed = selCount > 0 && !isSelected;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `focus-shape-chip${isSelected ? ' selected' : ''}${isDimmed ? ' dimmed' : ''}`;
        btn.title = `${isSelected ? 'Unfocus' : 'Focus'} ${pt.label} (@focus ${pt.id}) — ${pt.count} ${pt.count === 1 ? 'piece' : 'pieces'} affected`;
        btn.appendChild(renderPieceSilhouetteSvg(pt.sampleRegion));
        const nameSpan = document.createElement('span');
        nameSpan.className = 'focus-shape-name';
        nameSpan.textContent = pt.id;
        const countSpan = document.createElement('span');
        countSpan.className = 'focus-shape-count';
        countSpan.textContent = `×${pt.count}`;
        btn.append(nameSpan, countSpan);
        btn.addEventListener('click', () => {
          this.updateMacroFocusTypes(
            entry.name,
            toggleFocusType(entry.focusTypes, pt.id, solvedState),
          );
        });
        chipsEl.appendChild(btn);
      }
    }

    this.focusPickBarEl.querySelector('#btn-focus-clear')?.addEventListener('click', () => {
      this.updateMacroFocusTypes(entry.name, []);
    });
    this.focusPickBarEl.querySelector('#btn-focus-done')?.addEventListener('click', () => {
      this.exitFocusPickMode();
    });

    this.cyclePreviewPillEl.hidden = false;
    this.cyclePreviewPillEl.className = `cycle-preview-pill${res.blocked ? ' blocked' : ''}`;
    this.cyclePreviewPillEl.textContent = `Preview ${entry.name}: ${res.summary}`;
  }
}
