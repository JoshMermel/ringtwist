import { MacroLibraryEntry } from './evaluator.ts';
import { parseAlgorithm } from './parser.ts';

/**
 * Parsing and serialization of plain-text macro sheets (`name = expr`,
 * `// === Section ===`, `// @hide`, `// @show`, `// @focus ...`, and notes).
 *
 * Supported directives:
 *   1. Section-level directives (apply to macros below until changed):
 *        // === Phase 1: Kites (15) ===
 *        // @hide              (tuck helpers behind "Show hidden helpers")
 *        // @show              (resume visible macros)
 *        // @focus kite, small_pent
 *        // @focus all         (reset focus back to showing all piece types)
 *
 *   2. Per-macro trailing overrides:
 *        big3 = g4             // @focus big_pent — 4t: BigPent(3)
 *        tmp  = g4             // @hide — scratch helper
 */

const RESET_TOKENS = new Set(['all', 'none', 'clear', '*']);

/** Split a line into `[codePart, commentPrefix, commentBody]` (or `['', '', '']` if no comment). */
function splitLineComment(line: string): {
  code: string;
  prefix: '//' | '#' | null;
  comment: string;
} {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '/' && line[i + 1] === '/') {
      return { code: line.slice(0, i), prefix: '//', comment: line.slice(i + 2) };
    }
    if (line[i] === '#') {
      return { code: line.slice(0, i), prefix: '#', comment: line.slice(i + 1) };
    }
  }
  return { code: line, prefix: null, comment: '' };
}

interface ParsedFocusDirective {
  /** Index inside `comment` where `@focus` starts. */
  start: number;
  /** Index inside `comment` where the `@focus <tokens>` slice ends (before any prose delimiter). */
  end: number;
  /** True when the directive resets focus (`all` / `none` / `clear` / `*` / empty). */
  isReset: boolean;
  /** Normalized piece-type IDs (empty when `isReset`). */
  tokens: string[];
}

/**
 * Extract an `@focus ...` directive from the body of a line comment (after `//` or `#`).
 * Stops collecting piece-type identifiers at prose delimiters (`—`, `--`, `|`, `;`, `:`, `(`, `//`, `#`).
 */
function extractFocusDirective(comment: string): ParsedFocusDirective | null {
  const match = /@focus\b/i.exec(comment);
  if (!match) return null;
  const start = match.index;
  let i = start + match[0].length;
  const n = comment.length;

  // Optional single ':' immediately after @focus (e.g. `@focus: big_pent, kite`)
  while (i < n && (comment[i] === ' ' || comment[i] === '\t')) i++;
  if (i < n && comment[i] === ':') i++;

  const tokens: string[] = [];
  const seen = new Set<string>();
  let lastTokenEnd = i;
  let isReset = false;

  while (i < n) {
    // Skip spaces, tabs, and commas between identifiers
    while (i < n && (comment[i] === ' ' || comment[i] === '\t' || comment[i] === ',')) {
      i++;
    }
    if (i >= n) break;

    // Stop at prose separators (e.g. `— 4t: BigPent(3)`, `-- note`, `| ...`, `(...)`)
    const ch = comment[i];
    if (ch === '*') {
      isReset = true;
      i++;
      lastTokenEnd = i;
      break;
    }
    if (!/[A-Za-z0-9_-]/.test(ch) || (ch === '-' && comment[i + 1] === '-')) {
      break;
    }

    const tokStart = i;
    while (i < n && /[A-Za-z0-9_-]/.test(comment[i])) {
      // Stop before a `--` dash separator
      if (comment[i] === '-' && comment[i + 1] === '-') break;
      i++;
    }
    const rawTok = comment.slice(tokStart, i);
    if (!rawTok) break;
    const norm = rawTok.toLowerCase();
    lastTokenEnd = i;
    if (RESET_TOKENS.has(norm)) {
      isReset = true;
      tokens.length = 0;
      break;
    }
    if (!seen.has(norm)) {
      seen.add(norm);
      tokens.push(norm);
    }
  }

  if (tokens.length === 0) isReset = true;
  return { start, end: lastTokenEnd, isReset, tokens };
}

const MACRO_DEF_LINE_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const HIDE_DIRECTIVE_RE = /@hide\b/i;
const SHOW_DIRECTIVE_RE = /@show\b/i;

export interface InlineMacroMeta {
  /** Map from inline macro name -> list of piece-type IDs (lowercased) from `@focus`. */
  focus: Record<string, string[]>;
  /** Set of inline macro names hidden from the Macro Library via `@hide` / `@show`. */
  hidden: Set<string>;
}

/**
 * Parse all `@focus`, `@hide`, and `@show` directives for inline macros in `source`.
 * Both section-level comment lines (`// @hide`, `// @show`, `// @focus ...`) and
 * per-macro trailing comment overrides are supported.
 */
export function parseInlineMacroMeta(source: string): InlineMacroMeta {
  const focus: Record<string, string[]> = {};
  const hidden = new Set<string>();
  let sectionFocus: string[] | null = null;
  let sectionHidden = false;
  const lines = source.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const { code, prefix, comment } = splitLineComment(line);
    const trimmedCode = code.trim();

    if (trimmedCode.length === 0) {
      // Pure comment (or blank) line: check for section-level directives
      if (prefix !== null) {
        if (HIDE_DIRECTIVE_RE.test(comment)) sectionHidden = true;
        if (SHOW_DIRECTIVE_RE.test(comment)) sectionHidden = false;
        const dir = extractFocusDirective(comment);
        if (dir) {
          sectionFocus = dir.isReset ? null : [...dir.tokens];
        }
      }
      continue;
    }

    const m = MACRO_DEF_LINE_RE.exec(code);
    if (!m) continue;
    const macroName = m[1];

    // Visibility (@hide / @show)
    const hasLineHide = prefix !== null && HIDE_DIRECTIVE_RE.test(comment);
    const hasLineShow = prefix !== null && SHOW_DIRECTIVE_RE.test(comment);
    if (hasLineShow) {
      hidden.delete(macroName);
    } else if (hasLineHide || sectionHidden) {
      hidden.add(macroName);
    } else {
      hidden.delete(macroName);
    }

    // Focus (@focus)
    const lineDir = prefix !== null ? extractFocusDirective(comment) : null;
    if (lineDir) {
      if (lineDir.isReset) {
        delete focus[macroName];
      } else {
        focus[macroName] = [...lineDir.tokens];
      }
    } else if (sectionFocus && sectionFocus.length > 0) {
      focus[macroName] = [...sectionFocus];
    } else {
      delete focus[macroName];
    }
  }

  return { focus, hidden };
}

/**
 * Parse all active `@focus` directives for inline macros in `source`.
 * Returns a map from inline macro name -> list of piece-type IDs (lowercased).
 */
export function parseInlineMacroFocus(source: string): Record<string, string[]> {
  return parseInlineMacroMeta(source).focus;
}

/**
 * Parse all inline macro names hidden from the Macro Library via `// @hide` / `// @show`.
 */
export function parseInlineMacroHidden(source: string): Set<string> {
  return parseInlineMacroMeta(source).hidden;
}

/**
 * Update (or insert/remove) the trailing `// @focus ...` directive on an inline macro's
 * definition line in `source`, preserving any existing prose comments and line endings.
 */
export function setInlineMacroFocusInSource(
  source: string,
  macroName: string,
  focusIds: string[],
): string {
  const cleanIds = Array.from(
    new Set(focusIds.map((s) => s.trim()).filter((s) => s.length > 0)),
  );
  const lines = source.split('\n');

  // Track active section focus at each macro line and locate the last definition of `macroName`
  let sectionFocus: string[] | null = null;
  let targetIdx = -1;
  let sectionAtTarget: string[] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const { code, prefix, comment } = splitLineComment(line);
    if (code.trim().length === 0) {
      if (prefix !== null) {
        const dir = extractFocusDirective(comment);
        if (dir) sectionFocus = dir.isReset ? null : [...dir.tokens];
      }
      continue;
    }
    const m = MACRO_DEF_LINE_RE.exec(code);
    if (m && m[1] === macroName) {
      targetIdx = i;
      sectionAtTarget = sectionFocus ? [...sectionFocus] : null;
    }
  }

  if (targetIdx < 0) return source;

  const rawLine = lines[targetIdx];
  const hasCR = rawLine.endsWith('\r');
  const line = hasCR ? rawLine.slice(0, -1) : rawLine;
  const { code, prefix, comment } = splitLineComment(line);
  const needsExplicitReset = cleanIds.length === 0 && sectionAtTarget !== null && sectionAtTarget.length > 0;
  const directiveText =
    cleanIds.length > 0
      ? `@focus ${cleanIds.join(', ')}`
      : needsExplicitReset
        ? '@focus all'
        : '';

  let nextLine: string;
  if (prefix === null) {
    // No existing comment on the macro line
    if (!directiveText) {
      nextLine = line;
    } else {
      const base = code.replace(/[ \t]+$/, '');
      nextLine = `${base} // ${directiveText}`;
    }
  } else {
    const existing = extractFocusDirective(comment);
    if (existing) {
      const before = comment.slice(0, existing.start);
      const after = comment.slice(existing.end);
      if (directiveText) {
        nextLine = `${code}${prefix}${before}${directiveText}${after}`;
      } else {
        // Remove the directive cleanly and tidy any leftover separator like `—` / `--` / `|`
        let merged = `${before}${after}`;
        if (before.trim().length === 0) {
          merged = merged.replace(/^\s*(?:—|--|\||;|:)\s*/, ' ');
        } else {
          merged = merged.replace(/\s*(?:—|--|\||;)\s*$/, '');
        }
        if (merged.trim().length === 0) {
          nextLine = code.replace(/[ \t]+$/, '');
        } else {
          const normalizedComment = merged.startsWith(' ') ? merged : ` ${merged.trimStart()}`;
          nextLine = `${code}${prefix}${normalizedComment}`;
        }
      }
    } else if (!directiveText) {
      nextLine = line;
    } else {
      // Existing prose comment without @focus: prepend `@focus ... — ` inside the comment
      const trimmedComment = comment.trim();
      nextLine = trimmedComment
        ? `${code}${prefix} ${directiveText} — ${trimmedComment}`
        : `${code}${prefix} ${directiveText}`;
    }
  }

  lines[targetIdx] = hasCR ? `${nextLine}\r` : nextLine;
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Plain-Text Macro Library Sheet Parser & Serializer
// ---------------------------------------------------------------------------

const SECTION_HEADING_RE = /^\s*(?:={2,}|-{3,})\s*(.+?)\s*(?:={2,}|-{3,})?\s*$/;

function extractSectionHeading(comment: string): string | null {
  const trimmed = comment.trim();
  // Ignore pure divider bars like `========` or `--------`
  if (/^[=\-]+$/.test(trimmed)) return null;
  const m = SECTION_HEADING_RE.exec(trimmed);
  if (!m) return null;
  const title = m[1].replace(/\s*[=\-]+$/, '').trim();
  return title.length > 0 ? title : null;
}

/** Strip `@focus ...`, `@hide`, `@show` directives from a comment body to recover the clean prose note. */
function extractCleanNote(comment: string): string | undefined {
  let text = comment;
  const focusDir = extractFocusDirective(text);
  if (focusDir) {
    text = text.slice(0, focusDir.start) + ' ' + text.slice(focusDir.end);
  }
  text = text.replace(/@hide\b/gi, ' ').replace(/@show\b/gi, ' ');
  text = text.replace(/^[\s—\-|:;]+/, '').replace(/[\s—\-|:;]+$/, '').trim();
  return text.length > 0 ? text : undefined;
}

export interface ParseMacroSheetOptions {
  /** Reserved circle/move names (e.g. A..E, x, y, z) that cannot be used as macro names. */
  reservedNames?: Set<string>;
  /** Valid circle IDs for syntax checking macro bodies. */
  validCircleIds?: string[];
  /** Multi-layer circle IDs for syntax checking wide turns. */
  multiLayerCircleIds?: string[];
  /**
   * When true, non-macro move lines are ignored and collected in `remainingText`
   * (used by the one-click "Move macros to Library" helper). When false (default),
   * unexpected non-macro lines are reported in `errors`.
   */
  allowNonMacroLines?: boolean;
}

export interface ParseMacroSheetResult {
  entries: MacroLibraryEntry[];
  errors: string[];
  /** Non-macro lines left over when `allowNonMacroLines: true`. */
  remainingText: string;
}

/**
 * Parse a plain-text Macro Library sheet (or legacy JSON array) into structured `MacroLibraryEntry[]`.
 * Supports `// === Section ===`, `// @hide`, `// @show`, `// @focus ...`, and trailing prose notes.
 */
export function parseMacroLibraryText(
  source: string,
  options: ParseMacroSheetOptions = {},
): ParseMacroSheetResult {
  const trimmedAll = source.trim();
  if (!trimmedAll) {
    return { entries: [], errors: [], remainingText: '' };
  }

  // Auto-detect legacy JSON array format for seamless backwards compatibility
  if (trimmedAll.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmedAll);
      if (!Array.isArray(parsed)) {
        return { entries: [], errors: ['Expected a JSON array of macro objects'], remainingText: '' };
      }
      const entries: MacroLibraryEntry[] = [];
      const errors: string[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const rec = parsed[i];
        if (!rec || typeof rec !== 'object') {
          errors.push(`JSON item #${i + 1}: expected object { name, body }`);
          continue;
        }
        const name = typeof rec.name === 'string' ? rec.name.trim() : '';
        const body = typeof rec.body === 'string' ? rec.body.trim() : '';
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          errors.push(`JSON item #${i + 1}: invalid macro name "${name}"`);
          continue;
        }
        if (options.reservedNames?.has(name)) {
          errors.push(`JSON item #${i + 1}: "${name}" is a reserved move name`);
          continue;
        }
        if (!body) {
          errors.push(`Macro "${name}": body cannot be empty`);
          continue;
        }
        const focusTypes = Array.isArray(rec.focusTypes)
          ? rec.focusTypes
              .filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
              .map((s: string) => s.trim())
          : undefined;
        entries.push({
          name,
          body,
          ...(typeof rec.note === 'string' && rec.note.trim() ? { note: rec.note.trim() } : {}),
          ...(focusTypes && focusTypes.length > 0 ? { focusTypes } : {}),
          ...(rec.hidden === true ? { hidden: true } : {}),
          ...(typeof rec.section === 'string' && rec.section.trim()
            ? { section: rec.section.trim() }
            : {}),
          ...(typeof rec.sectionNote === 'string' && rec.sectionNote.trim()
            ? { sectionNote: rec.sectionNote.trim() }
            : {}),
        });
      }
      return { entries, errors, remainingText: '' };
    } catch (err) {
      return {
        entries: [],
        errors: [`Invalid JSON: ${(err as Error).message}`],
        remainingText: '',
      };
    }
  }

  const lines = source.split('\n');
  const entriesByName = new Map<string, MacroLibraryEntry>();
  const errors: string[] = [];
  const remainingLines: string[] = [];

  let currentSection: string | undefined;
  let pendingSectionNoteLines: string[] = [];
  let sectionNoteOpen = false;
  let pendingMacroNoteLines: string[] = [];
  let sectionHidden = false;
  let sectionFocus: string[] | undefined;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const { code, prefix, comment } = splitLineComment(line);
    const trimmedCode = code.trim();

    if (trimmedCode.length === 0) {
      if (prefix !== null) {
        let isDirectiveLine = false;
        if (HIDE_DIRECTIVE_RE.test(comment)) {
          sectionHidden = true;
          sectionNoteOpen = false;
          isDirectiveLine = true;
        }
        if (SHOW_DIRECTIVE_RE.test(comment)) {
          sectionHidden = false;
          sectionNoteOpen = false;
          isDirectiveLine = true;
        }
        const dir = extractFocusDirective(comment);
        if (dir) {
          sectionFocus = dir.isReset ? undefined : [...dir.tokens];
          sectionNoteOpen = false;
          isDirectiveLine = true;
        }
        const heading = extractSectionHeading(comment);
        if (heading) {
          currentSection = heading;
          pendingSectionNoteLines = [];
          pendingMacroNoteLines = [];
          sectionNoteOpen = true;
          isDirectiveLine = true;
        }
        if (!isDirectiveLine) {
          const prose = comment.trim();
          // Ignore pure decorative divider bars like `// ========`
          if (prose.length > 0 && !/^[=\-]+$/.test(prose)) {
            if (sectionNoteOpen) {
              pendingSectionNoteLines.push(prose);
            } else {
              pendingMacroNoteLines.push(prose);
            }
          }
          if (options.allowNonMacroLines) {
            remainingLines.push(rawLine);
          }
        }
      } else {
        // Blank line closes section-note capture and clears any unattached macro comment
        sectionNoteOpen = false;
        pendingMacroNoteLines = [];
        if (options.allowNonMacroLines) {
          remainingLines.push(rawLine);
        }
      }
      continue;
    }

    sectionNoteOpen = false;
    const eqMatch = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(code);
    if (!eqMatch) {
      pendingMacroNoteLines = [];
      if (options.allowNonMacroLines) {
        remainingLines.push(rawLine);
      } else {
        errors.push(`Line ${i + 1}: expected "name = moves" (got "${trimmedCode}")`);
      }
      continue;
    }

    const name = eqMatch[1];
    const body = eqMatch[2].trim();
    if (options.reservedNames?.has(name)) {
      pendingMacroNoteLines = [];
      errors.push(`Line ${i + 1}: "${name}" is a reserved move name`);
      continue;
    }
    if (!body) {
      pendingMacroNoteLines = [];
      errors.push(`Line ${i + 1}: macro "${name}" has an empty body`);
      continue;
    }

    // Syntax-check macro body using the exact algorithm parser
    const check = parseAlgorithm(body, options.validCircleIds, options.multiLayerCircleIds);
    if (check.errors.length > 0) {
      pendingMacroNoteLines = [];
      errors.push(`Line ${i + 1} (${name}): ${check.errors[0].message}`);
      continue;
    }
    if (check.statements.some((s) => s.kind === 'macroDef')) {
      pendingMacroNoteLines = [];
      errors.push(`Line ${i + 1} (${name}): nested "=" is not allowed inside a macro body`);
      continue;
    }

    // Resolve visibility
    const hasLineHide = prefix !== null && HIDE_DIRECTIVE_RE.test(comment);
    const hasLineShow = prefix !== null && SHOW_DIRECTIVE_RE.test(comment);
    const hidden = hasLineShow ? false : hasLineHide || sectionHidden;

    // Resolve focus types
    const lineDir = prefix !== null ? extractFocusDirective(comment) : null;
    const focusTypes = lineDir
      ? lineDir.isReset
        ? undefined
        : [...lineDir.tokens]
      : sectionFocus
        ? [...sectionFocus]
        : undefined;

    const trailingNote = prefix !== null ? extractCleanNote(comment) : undefined;
    const noteLines = [...pendingMacroNoteLines];
    if (trailingNote) noteLines.push(trailingNote);
    const note = noteLines.length > 0 ? noteLines.join('\n') : undefined;
    pendingMacroNoteLines = [];

    const sectionNote =
      pendingSectionNoteLines.length > 0 ? pendingSectionNoteLines.join('\n') : undefined;
    if (sectionNote) pendingSectionNoteLines = [];

    entriesByName.set(name, {
      name,
      body,
      ...(note ? { note } : {}),
      ...(focusTypes && focusTypes.length > 0 ? { focusTypes } : {}),
      ...(hidden ? { hidden: true } : {}),
      ...(currentSection ? { section: currentSection } : {}),
      ...(sectionNote ? { sectionNote } : {}),
    });
  }

  return {
    entries: Array.from(entriesByName.values()),
    errors,
    remainingText: remainingLines.join('\n').trim(),
  };
}

/**
 * Serialize a Macro Library into a clean, copy-paste-ready plain-text macro sheet
 * (`// === Section ===`, section descriptions, `// @hide`/`// @show`, `// @focus ...`,
 * preceding/trailing macro comments, and `name = body`).
 * Round-trips losslessly through `parseMacroLibraryText`.
 */
export function serializeMacroLibraryToText(entries: MacroLibraryEntry[]): string {
  if (entries.length === 0) return '';
  const lines: string[] = [];
  let curSection: string | undefined;
  let curHidden = false;
  let curFocusKey = '';

  for (const entry of entries) {
    let justEmittedSection = false;
    if (entry.section !== curSection) {
      if (lines.length > 0) lines.push('');
      if (entry.section) {
        lines.push(`// === ${entry.section} ===`);
        justEmittedSection = true;
        if (entry.sectionNote) {
          for (const nl of entry.sectionNote.split('\n')) {
            lines.push(`// ${nl}`);
          }
        }
      }
      curSection = entry.section;
    }

    const isHidden = Boolean(entry.hidden);
    if (isHidden !== curHidden) {
      lines.push(isHidden ? '// @hide' : '// @show');
      curHidden = isHidden;
      justEmittedSection = false;
    }

    const focusKey =
      entry.focusTypes && entry.focusTypes.length > 0 ? entry.focusTypes.join(', ') : '';
    if (focusKey !== curFocusKey) {
      lines.push(focusKey ? `// @focus ${focusKey}` : '// @focus all');
      curFocusKey = focusKey;
      justEmittedSection = false;
    }

    if (entry.note && entry.note.includes('\n')) {
      if (justEmittedSection) lines.push('');
      for (const nl of entry.note.split('\n')) {
        lines.push(`// ${nl}`);
      }
      lines.push(`${entry.name} = ${entry.body}`);
    } else {
      const notePart = entry.note ? `  // ${entry.note}` : '';
      lines.push(`${entry.name} = ${entry.body}${notePart}`);
    }
  }

  return lines.join('\n');
}
