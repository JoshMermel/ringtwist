/**
 * Parsing and editing of plain-text `// @focus ...` directives for inline macros.
 *
 * Supported forms:
 *   1. Section-level directive (applies to all inline macros below until the next `@focus`):
 *        // @focus kite, small_pent
 *        // @focus all          (resets section focus back to showing all piece types)
 *
 *   2. Per-macro trailing directive (overrides any section focus for that macro line only):
 *        big3 = g4              // @focus big_pent — 4t: BigPent(3)
 *        sep  = s9b [z2': s10b'] // @focus kite, small_pent
 *        noop = g4              // @focus all
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

/**
 * Parse all active `@focus` directives for inline macros in `source`.
 * Returns a map from inline macro name -> list of piece-type IDs (lowercased).
 */
export function parseInlineMacroFocus(source: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let sectionFocus: string[] | null = null;
  const lines = source.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const { code, prefix, comment } = splitLineComment(line);
    const trimmedCode = code.trim();

    if (trimmedCode.length === 0) {
      // Pure comment (or blank) line: check for section-level `// @focus ...`
      if (prefix !== null) {
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
    const lineDir = prefix !== null ? extractFocusDirective(comment) : null;
    if (lineDir) {
      if (lineDir.isReset) {
        delete out[macroName];
      } else {
        out[macroName] = [...lineDir.tokens];
      }
    } else if (sectionFocus && sectionFocus.length > 0) {
      out[macroName] = [...sectionFocus];
    } else {
      delete out[macroName];
    }
  }

  return out;
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
