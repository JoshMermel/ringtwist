import { Span } from '../lang/ast.ts';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface EditorHighlightState {
  activeSpan?: Span;
  errorSpans: Span[];
}

/**
 * Lightweight syntax-highlighted algorithm editor using a synchronized
 * transparent textarea over a highlighted `<pre>` backdrop.
 * Zero external dependencies; preserves 100% native selection, copy/paste, and undo/redo.
 */
export class AlgorithmEditor {
  public readonly textarea: HTMLTextAreaElement;
  private backdrop: HTMLPreElement;
  private highlightState: EditorHighlightState = { errorSpans: [] };
  private lastBackdropKey = '';

  constructor(
    container: HTMLElement,
    callbacks: {
      onChange: (value: string) => void;
      onCursorMove: (cursorPos: number) => void;
    },
  ) {
    const wrap = document.createElement('div');
    wrap.className = 'code-editor-wrap';

    this.backdrop = document.createElement('pre');
    this.backdrop.className = 'code-backdrop';
    this.backdrop.setAttribute('aria-hidden', 'true');

    this.textarea = document.createElement('textarea');
    this.textarea.className = 'code-textarea';
    this.textarea.spellcheck = false;
    this.textarea.autocomplete = 'off';
    this.textarea.autocapitalize = 'off';
    this.textarea.placeholder =
      '// Type moves, e.g. [A: D3], A>, z, or define macros:\nconj = [A: D3]\n[z: conj]';

    wrap.append(this.backdrop, this.textarea);
    container.appendChild(wrap);

    this.textarea.addEventListener('input', () => {
      this.renderBackdrop();
      callbacks.onChange(this.textarea.value);
    });

    this.textarea.addEventListener('scroll', () => {
      this.backdrop.scrollTop = this.textarea.scrollTop;
      this.backdrop.scrollLeft = this.textarea.scrollLeft;
    });

    const emitCursor = () => {
      callbacks.onCursorMove(this.textarea.selectionStart ?? 0);
    };
    this.textarea.addEventListener('click', emitCursor);
    this.textarea.addEventListener('keyup', emitCursor);
    this.textarea.addEventListener('select', emitCursor);
  }

  public getValue(): string {
    return this.textarea.value;
  }

  public setValue(text: string): void {
    this.textarea.value = text;
    this.renderBackdrop();
  }

  public getSelection(): { start: number; end: number; text: string } {
    const start = this.textarea.selectionStart ?? 0;
    const end = this.textarea.selectionEnd ?? 0;
    return { start, end, text: this.textarea.value.slice(start, end) };
  }

  public insertAtCursor(snippet: string): void {
    const val = this.textarea.value;
    const start = this.textarea.selectionStart ?? val.length;
    const end = this.textarea.selectionEnd ?? val.length;
    const needLeadingSpace =
      start > 0 && !/[\s([:,;]/.test(val[start - 1]) && !/^\s/.test(snippet);
    const needTrailingSpace =
      end < val.length && !/[\s)\]:,;]/.test(val[end]) && !/\s$/.test(snippet);
    const inserted =
      (needLeadingSpace ? ' ' : '') + snippet + (needTrailingSpace ? ' ' : '');

    this.textarea.value = val.slice(0, start) + inserted + val.slice(end);
    const nextPos = start + inserted.length;
    this.textarea.selectionStart = nextPos;
    this.textarea.selectionEnd = nextPos;
    this.renderBackdrop();
    this.textarea.focus();
  }

  public setHighlights(state: EditorHighlightState): void {
    this.highlightState = state;
    this.renderBackdrop();
  }

  private renderBackdrop(): void {
    const src = this.textarea.value;
    const act = this.highlightState.activeSpan;
    const errs = this.highlightState.errorSpans;
    const errKey = errs.length === 0 ? '' : errs.map((s) => `${s.start}:${s.end}`).join(',');
    const key = `${act ? `${act.start}:${act.end}` : ''}|${errKey}|${src}`;
    if (key === this.lastBackdropKey) {
      this.backdrop.scrollTop = this.textarea.scrollTop;
      this.backdrop.scrollLeft = this.textarea.scrollLeft;
      return;
    }
    this.lastBackdropKey = key;

    if (!src) {
      this.backdrop.innerHTML = '';
      return;
    }

    // Build per-character class tags for overlays (errors & active step)
    const n = src.length;
    const errMask = new Uint8Array(n);
    const activeMask = new Uint8Array(n);

    for (const sp of this.highlightState.errorSpans) {
      const s = Math.max(0, Math.min(n, sp.start));
      const e = Math.max(s + 1, Math.min(n, sp.end));
      for (let i = s; i < e && i < n; i++) errMask[i] = 1;
    }
    if (this.highlightState.activeSpan) {
      const s = Math.max(0, Math.min(n, this.highlightState.activeSpan.start));
      const e = Math.max(s, Math.min(n, this.highlightState.activeSpan.end));
      for (let i = s; i < e && i < n; i++) activeMask[i] = 1;
    }

    // Lightweight syntax token classification per character
    const syntax = new Array<string>(n).fill('');
    let i = 0;
    while (i < n) {
      const ch = src[i];
      if (ch === '#' || (ch === '/' && src[i + 1] === '/')) {
        while (i < n && src[i] !== '\n') {
          syntax[i++] = 'tok-comment';
        }
        continue;
      }
      if (ch === '[' || ch === ']' || ch === ',' || ch === ':') {
        syntax[i++] = 'tok-bracket';
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        const start = i;
        while (i < n && /[A-Za-z0-9_<>'’]/.test(src[i])) i++;
        const word = src.slice(start, i);
        // Check if followed by '=' (macro def) without O(n^2) string slicing
        let j = i;
        while (j < n && (src[j] === ' ' || src[j] === '\t')) j++;
        let cls = '';
        if (src[j] === '=') cls = 'tok-macro-def';
        else if (/^z(?:\d*['’]?|['’]\d*)$/.test(word)) cls = 'tok-rot';
        else if (/^[A-Za-y][<>](?:\d*['’]?|['’]\d*)$/.test(word)) cls = 'tok-next';
        for (let k = start; k < i; k++) syntax[k] = cls;
        continue;
      }
      i++;
    }

    // Emit contiguous runs of identical classes
    const parts: string[] = [];
    let runStart = 0;
    const classAt = (idx: number): string => {
      const list: string[] = [];
      if (syntax[idx]) list.push(syntax[idx]);
      if (activeMask[idx]) list.push('tok-active');
      if (errMask[idx]) list.push('tok-error');
      return list.join(' ');
    };

    let curCls = classAt(0);
    for (let idx = 1; idx <= n; idx++) {
      const nextCls = idx < n ? classAt(idx) : '__END__';
      if (nextCls !== curCls) {
        const chunk = escapeHtml(src.slice(runStart, idx));
        if (curCls) parts.push(`<span class="${curCls}">${chunk}</span>`);
        else parts.push(chunk);
        runStart = idx;
        curCls = nextCls;
      }
    }

    // Trailing newline ensures last empty line scrolls in lockstep with textarea
    this.backdrop.innerHTML = parts.join('') + '\n';
    this.backdrop.scrollTop = this.textarea.scrollTop;
    this.backdrop.scrollLeft = this.textarea.scrollLeft;
  }
}
