import { MacroLibraryEntry } from './evaluator.ts';
import { isReservedMoveName, parseAlgorithm } from './parser.ts';

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

const HIDE_DIRECTIVE_RE = /@hide\b/i;
const SHOW_DIRECTIVE_RE = /@show\b/i;

// ---------------------------------------------------------------------------
// Plain-Text Macro Library Sheet Parser & Serializer
// ---------------------------------------------------------------------------

const SECTION_HEADING_RE = /^\s*(?:={2,}|-{3,})\s*(.+?)\s*(?:={2,}|-{3,})?\s*$/;
const SECTION_RESET_RE = /@section\s+(?:none|clear|off)\b/i;

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
  // Strip leading/trailing separator punctuation (`—`, `--`, `|`, `:`, `;`, or `- ` before text),
  // while preserving leading negative signs like `-36° setup` and avoiding ES2018 lookbehind.
  text = text
    .replace(/^(?:\s*(?:—|--|\||:|;|-(?=\s|$)))+\s*/, '')
    .replace(/(?:\s+-|\s*(?:—|--|\||:|;))+\s*$/, '')
    .trim();
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

  const validCircleSet = new Set(options.validCircleIds ?? []);
  const multiLayerSet = new Set(options.multiLayerCircleIds ?? []);
  const isNameReserved = (name: string): boolean => {
    if (options.reservedNames?.has(name)) return true;
    return isReservedMoveName(name, validCircleSet, multiLayerSet);
  };

  // Auto-detect legacy JSON array format only when not extracting from mixed scripts
  // and input actually begins like a JSON array of objects (`[{...}]` or `[]`),
  // so commutators/conjugates like `[A, B]` or `[A: B]` are never misread as JSON.
  if (!options.allowNonMacroLines && /^\[\s*(?:\{|\]|$)/.test(trimmedAll)) {
    try {
      const parsed = JSON.parse(trimmedAll);
      if (!Array.isArray(parsed)) {
        return { entries: [], errors: ['Expected a JSON array of macro objects'], remainingText: '' };
      }
      const entriesByName = new Map<string, MacroLibraryEntry>();
      const errors: string[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const rec = parsed[i];
        if (!rec || typeof rec !== 'object') {
          errors.push(`JSON item #${i + 1}: expected object { name, body }`);
          continue;
        }
        const name = typeof rec.name === 'string' ? rec.name.trim() : '';
        const body = typeof rec.body === 'string' ? rec.body.replace(/\s+/g, ' ').trim() : '';
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          errors.push(`JSON item #${i + 1}: invalid macro name "${name}"`);
          continue;
        }
        if (isNameReserved(name)) {
          errors.push(`JSON item #${i + 1}: "${name}" is a reserved move name`);
          continue;
        }
        if (!body) {
          errors.push(`Macro "${name}": body cannot be empty`);
          continue;
        }
        const check = parseAlgorithm(body, options.validCircleIds, options.multiLayerCircleIds);
        if (check.errors.length > 0) {
          errors.push(`Macro "${name}": ${check.errors[0].message}`);
          continue;
        }
        if (check.statements.some((s) => s.kind === 'macroDef')) {
          errors.push(`Macro "${name}": nested "=" is not allowed inside a macro body`);
          continue;
        }
        if (!check.statements.some((s) => s.kind === 'exprStmt')) {
          errors.push(`Macro "${name}": body must contain at least one move`);
          continue;
        }
        const focusTypes: string[] | undefined = Array.isArray(rec.focusTypes)
          ? Array.from(
              new Set<string>(
                rec.focusTypes
                  .filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
                  .map((s: string) => s.trim().toLowerCase()),
              ),
            )
          : undefined;
        entriesByName.set(name, {
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
      return { entries: Array.from(entriesByName.values()), errors, remainingText: '' };
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
  let pendingSectionRawLines: string[] = [];
  let sectionNoteOpen = false;
  let pendingMacroNoteLines: string[] = [];
  let pendingMacroNoteRawLines: string[] = [];
  let sectionHidden = false;
  let sectionFocus: string[] | undefined;

  const flushUnusedMacroCommentLines = (): void => {
    if (options.allowNonMacroLines && pendingMacroNoteRawLines.length > 0) {
      remainingLines.push(...pendingMacroNoteRawLines);
    }
    pendingMacroNoteLines = [];
    pendingMacroNoteRawLines = [];
  };

  const flushUnusedSectionLines = (): void => {
    if (options.allowNonMacroLines && pendingSectionRawLines.length > 0) {
      remainingLines.push(...pendingSectionRawLines);
    }
    pendingSectionRawLines = [];
  };

  const flushAllUnusedInOrder = (): void => {
    flushUnusedSectionLines();
    flushUnusedMacroCommentLines();
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const { code, prefix, comment } = splitLineComment(line);
    const trimmedCode = code.trim();

    if (trimmedCode.length === 0) {
      if (prefix !== null) {
        let isDirectiveLine = false;
        if (HIDE_DIRECTIVE_RE.test(comment)) {
          if (pendingMacroNoteRawLines.length > 0) flushAllUnusedInOrder();
          sectionHidden = true;
          sectionNoteOpen = false;
          isDirectiveLine = true;
        }
        if (SHOW_DIRECTIVE_RE.test(comment)) {
          if (pendingMacroNoteRawLines.length > 0) flushAllUnusedInOrder();
          sectionHidden = false;
          sectionNoteOpen = false;
          isDirectiveLine = true;
        }
        if (SECTION_RESET_RE.test(comment)) {
          flushAllUnusedInOrder();
          currentSection = undefined;
          pendingSectionNoteLines = [];
          sectionNoteOpen = false;
          isDirectiveLine = true;
        }
        const dir = extractFocusDirective(comment);
        if (dir) {
          if (pendingMacroNoteRawLines.length > 0) flushAllUnusedInOrder();
          sectionFocus = dir.isReset ? undefined : [...dir.tokens];
          sectionNoteOpen = false;
          isDirectiveLine = true;
        }
        const heading = extractSectionHeading(comment);
        if (heading) {
          flushAllUnusedInOrder();
          currentSection = heading;
          pendingSectionNoteLines = [];
          pendingSectionRawLines = options.allowNonMacroLines ? [rawLine] : [];
          sectionNoteOpen = true;
          isDirectiveLine = true;
        }
        if (!isDirectiveLine) {
          const prose = comment.trim();
          // Ignore pure decorative divider bars like `// ========`
          if (prose.length > 0 && !/^[=\-]+$/.test(prose)) {
            if (sectionNoteOpen) {
              pendingSectionNoteLines.push(prose);
              if (options.allowNonMacroLines) pendingSectionRawLines.push(rawLine);
            } else {
              pendingMacroNoteLines.push(prose);
              pendingMacroNoteRawLines.push(rawLine);
            }
          } else if (options.allowNonMacroLines) {
            if (pendingMacroNoteRawLines.length > 0) {
              flushAllUnusedInOrder();
              remainingLines.push(rawLine);
            } else if (pendingSectionRawLines.length > 0) {
              pendingSectionRawLines.push(rawLine);
            } else if (!sectionNoteOpen) {
              remainingLines.push(rawLine);
            }
          }
        }
      } else {
        // Blank line closes section-note capture and flushes any unattached macro comments in exact order
        sectionNoteOpen = false;
        if (pendingMacroNoteRawLines.length > 0) {
          flushAllUnusedInOrder();
          if (options.allowNonMacroLines) remainingLines.push(rawLine);
        } else {
          pendingMacroNoteLines = [];
          if (options.allowNonMacroLines) {
            if (pendingSectionRawLines.length > 0) {
              pendingSectionRawLines.push(rawLine);
            } else {
              remainingLines.push(rawLine);
            }
          }
        }
      }
      continue;
    }

    sectionNoteOpen = false;
    // Handle semicolon-separated statements on a single line (e.g. `m1 = A B; m1` or `m1 = A B; m2 = C D`)
    // so macro extraction never swallows trailing calls or rejects multi-definition lines.
    const rawSegments = code.includes(';') ? code.split(';') : [code];
    const nonEmptySegments = rawSegments.map((s) => s.trim()).filter((s) => s.length > 0);
    const remainingOnLine: string[] = [];

    for (let si = 0; si < nonEmptySegments.length; si++) {
      const seg = nonEmptySegments[si];
      const isLastSeg = si === nonEmptySegments.length - 1;
      const segPrefix = isLastSeg ? prefix : null;
      const segComment = isLastSeg ? comment : '';

      const eqMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(seg);
      if (!eqMatch) {
        if (options.allowNonMacroLines) {
          remainingOnLine.push(seg);
        } else {
          errors.push(`Line ${i + 1}: expected "name = moves" (got "${seg}")`);
        }
        continue;
      }

      const name = eqMatch[1];
      const body = eqMatch[2].trim();
      if (isNameReserved(name)) {
        pendingMacroNoteLines = [];
        pendingMacroNoteRawLines = [];
        errors.push(`Line ${i + 1}: "${name}" is a reserved move name`);
        continue;
      }
      if (!body) {
        pendingMacroNoteLines = [];
        pendingMacroNoteRawLines = [];
        errors.push(`Line ${i + 1}: macro "${name}" has an empty body`);
        continue;
      }

      // Syntax-check macro body using the exact algorithm parser
      const check = parseAlgorithm(body, options.validCircleIds, options.multiLayerCircleIds);
      if (check.errors.length > 0) {
        pendingMacroNoteLines = [];
        pendingMacroNoteRawLines = [];
        errors.push(`Line ${i + 1} (${name}): ${check.errors[0].message}`);
        continue;
      }
      if (check.statements.some((s) => s.kind === 'macroDef')) {
        pendingMacroNoteLines = [];
        pendingMacroNoteRawLines = [];
        errors.push(`Line ${i + 1} (${name}): nested "=" is not allowed inside a macro body`);
        continue;
      }
      const exprCount = check.statements.filter((s) => s.kind === 'exprStmt').length;
      if (exprCount === 0) {
        pendingMacroNoteLines = [];
        pendingMacroNoteRawLines = [];
        errors.push(`Line ${i + 1} (${name}): macro body must contain at least one move`);
        continue;
      }
      if (exprCount > 1) {
        pendingMacroNoteLines = [];
        pendingMacroNoteRawLines = [];
        errors.push(`Line ${i + 1} (${name}): multiple statements are not allowed inside a macro body`);
        continue;
      }

      // Resolve visibility
      const hasLineHide = segPrefix !== null && HIDE_DIRECTIVE_RE.test(segComment);
      const hasLineShow = segPrefix !== null && SHOW_DIRECTIVE_RE.test(segComment);
      const hidden = hasLineShow ? false : hasLineHide || sectionHidden;

      // Resolve focus types
      const lineDir = segPrefix !== null ? extractFocusDirective(segComment) : null;
      const focusTypes = lineDir
        ? lineDir.isReset
          ? undefined
          : [...lineDir.tokens]
        : sectionFocus
          ? [...sectionFocus]
          : undefined;

      const trailingNote = segPrefix !== null ? extractCleanNote(segComment) : undefined;
      const noteLines = [...pendingMacroNoteLines];
      if (trailingNote) noteLines.push(trailingNote);
      const note = noteLines.length > 0 ? noteLines.join('\n') : undefined;
      pendingMacroNoteLines = [];
      pendingMacroNoteRawLines = [];

      const sectionNote =
        pendingSectionNoteLines.length > 0 ? pendingSectionNoteLines.join('\n') : undefined;
      if (sectionNote) pendingSectionNoteLines = [];
      pendingSectionRawLines = [];

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

    if (options.allowNonMacroLines && remainingOnLine.length > 0) {
      flushUnusedSectionLines();
      flushUnusedMacroCommentLines();
      if (remainingOnLine.length === nonEmptySegments.length) {
        // Pure non-macro line: preserve exact original formatting & comment
        remainingLines.push(rawLine);
      } else {
        const suffix = prefix !== null ? ` ${prefix}${comment}` : '';
        remainingLines.push(`${remainingOnLine.join('; ')}${suffix}`);
      }
    }
  }

  flushUnusedSectionLines();
  flushUnusedMacroCommentLines();

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
      } else if (curSection !== undefined) {
        lines.push('// @section none');
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
