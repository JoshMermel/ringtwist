import { MoveLayerSpec, formatMoveToken } from '../puzzle/engine.ts';
import { PuzzleSpec } from '../puzzle/types.ts';

export interface CoalesceResult {
  nextText: string;
  nextCursor: number;
  action: 'appended' | 'merged' | 'cancelled';
  /** Start offset in the original text of the preceding token that was merged or cancelled. */
  replacedStart?: number;
  /** Resulting merged move token when `action === 'merged'`. */
  mergedToken?: string;
}

type ParsedSimpleMove =
  | { kind: 'circle'; circleId: string; steps: number; layerOpt?: MoveLayerSpec }
  | { kind: 'next'; circleId: string; steps: number; layerOpt?: MoveLayerSpec }
  | { kind: 'rot'; steps: number }
  | { kind: 'flip'; axis: 'x' | 'y'; count: number };

function sameLayerOpt(a: MoveLayerSpec | undefined, b: MoveLayerSpec | undefined, numLayers: number): boolean {
  const wideA = Boolean(a?.wide);
  const wideB = Boolean(b?.wide);
  if (wideA !== wideB) return false;
  const effA = wideA ? (a?.layer ?? numLayers) : (a?.layer ?? 1);
  const effB = wideB ? (b?.layer ?? numLayers) : (b?.layer ?? 1);
  return effA === effB;
}

function parseModifierPair(a: string, b: string): { count: number; invert: boolean } | null {
  const raw = a + b;
  if (!raw) return { count: 1, invert: false };
  const primeCount = raw.match(/'/g)?.length ?? 0;
  const invert = primeCount % 2 === 1;
  const digits = raw.replace(/'/g, '');
  const count = digits ? parseInt(digits, 10) : 1;
  if (!Number.isSafeInteger(count) || count <= 0) return null;
  return { count, invert };
}

function parseSimpleInteractiveMove(token: string, spec: PuzzleSpec): ParsedSimpleMove | null {
  const trimmed = token.trim().replace(/’/g, "'");
  const nextMatch = trimmed.match(/^(\d*)([A-Za-w])([><])(\d*|'?)(\d*|'?)$/);
  if (nextMatch) {
    const mod = parseModifierPair(nextMatch[4], nextMatch[5]);
    if (!mod) return null;
    const rawLetter = nextMatch[2];
    const isLower = rawLetter >= 'a' && rawLetter <= 'w';
    const circleId = rawLetter.toUpperCase();
    const cDef = spec.circles.find((c) => c.id === circleId);
    if (!cDef) return null;
    if (isLower && !(cDef.layerRadii && cDef.layerRadii.length > 1)) return null;
    const layer = nextMatch[1] ? parseInt(nextMatch[1], 10) : undefined;
    const layerOpt: MoveLayerSpec | undefined =
      layer !== undefined || isLower ? { ...(layer ? { layer } : {}), ...(isLower ? { wide: true } : {}) } : undefined;
    const dir = (nextMatch[3] === '>' ? 1 : -1) * (mod.invert ? -1 : 1);
    return { kind: 'next', circleId, steps: dir * mod.count, layerOpt };
  }

  const rotMatch = trimmed.match(/^z(\d*|'?)(\d*|'?)$/);
  if (rotMatch && spec.symmetryStepDeg > 0) {
    const mod = parseModifierPair(rotMatch[1], rotMatch[2]);
    if (!mod) return null;
    return { kind: 'rot', steps: mod.invert ? -mod.count : mod.count };
  }

  const flipMatch = trimmed.match(/^([xy])(\d*|'?)(\d*|'?)$/);
  if (flipMatch) {
    const mod = parseModifierPair(flipMatch[2], flipMatch[3]);
    if (!mod) return null;
    return { kind: 'flip', axis: flipMatch[1] as 'x' | 'y', count: mod.count };
  }

  const circleMatch = trimmed.match(/^(\d*)([A-Za-w])(\d*|'?)(\d*|'?)$/);
  if (circleMatch) {
    const mod = parseModifierPair(circleMatch[3], circleMatch[4]);
    if (!mod) return null;
    const rawLetter = circleMatch[2];
    const isLower = rawLetter >= 'a' && rawLetter <= 'w';
    const circleId = rawLetter.toUpperCase();
    const cDef = spec.circles.find((c) => c.id === circleId);
    if (!cDef) return null;
    if (isLower && !(cDef.layerRadii && cDef.layerRadii.length > 1)) return null;
    const layer = circleMatch[1] ? parseInt(circleMatch[1], 10) : undefined;
    const layerOpt: MoveLayerSpec | undefined =
      layer !== undefined || isLower ? { ...(layer ? { layer } : {}), ...(isLower ? { wide: true } : {}) } : undefined;
    return { kind: 'circle', circleId, steps: mod.invert ? -mod.count : mod.count, layerOpt };
  }

  return null;
}

function hasUnclosedBracketOnLine(line: string): boolean {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

function shortestSignedMod(sum: number, modulus: number): number {
  if (modulus <= 0) return sum;
  const mod = ((sum % modulus) + modulus) % modulus;
  if (mod === 0) return 0;
  return mod <= Math.floor(modulus / 2) ? mod : mod - modulus;
}

function formatRotationToken(steps: number): string {
  const abs = Math.abs(steps);
  const prime = steps < 0 ? "'" : '';
  return `z${abs === 1 ? '' : abs}${prime}`;
}

function formatNextToken(circleId: string, steps: number, layerOpt?: MoveLayerSpec): string {
  const abs = Math.abs(steps);
  const dir = steps > 0 ? '>' : '<';
  const base = layerOpt?.wide
    ? `${layerOpt.layer !== undefined ? layerOpt.layer : ''}${circleId.toLowerCase()}`
    : `${layerOpt?.layer && layerOpt.layer > 1 ? layerOpt.layer : ''}${circleId}`;
  return `${base}${dir}${abs === 1 ? '' : abs}`;
}

/**
 * Apply an interactive move (from mouse click, trackpad scroll, circle chip, or r button)
 * at `cursorPos`, coalescing or cancelling against an immediately preceding move on the
 * same circle / rotation on the same line:
 *   - `B` + `B'`   -> cancelled (removed)
 *   - `B` + `B`    -> `B2`
 *   - `B2` + `B'`  -> `B`
 *   - `B>` + `B<`  -> cancelled
 *   - `r` + `r'`   -> cancelled
 * Never crosses newlines or mutates comments / bracketed expressions.
 */
export function applyInteractiveMoveToText(
  text: string,
  cursorPos: number,
  newToken: string,
  spec: PuzzleSpec,
  allowCoalesce = true,
): CoalesceResult {
  const before = text.slice(0, cursorPos);
  const after = text.slice(cursorPos);

  const fallbackAppend = (): CoalesceResult => {
    const needSpaceBefore = before.length > 0 && !/[\s([{:=,]$/.test(before);
    const needSpaceAfter = after.length > 0 && !/^[\s)\]}:,]/.test(after);
    const inserted = `${needSpaceBefore ? ' ' : ''}${newToken}${needSpaceAfter ? ' ' : ''}`;
    const nextText = before + inserted + after;
    return {
      nextText,
      nextCursor: before.length + inserted.length,
      action: 'appended',
    };
  };

  // Only inspect the current line before the cursor (never cross a newline!)
  const lineStart = before.lastIndexOf('\n') + 1;
  const currentLine = before.slice(lineStart);

  // If the current line has a comment before the cursor, jump to end of that comment line
  // and append on a new line so we never split or insert into the middle of a comment.
  if (/(?:\/\/|#)/.test(currentLine)) {
    const nlInAfter = after.indexOf('\n');
    const restOfLine = nlInAfter >= 0 ? after.slice(0, nlInAfter) : after;
    const restAfterLine = nlInAfter >= 0 ? after.slice(nlInAfter) : '';
    const linePrefixWithComment = before + restOfLine;
    const inserted = `\n${newToken}`;
    return {
      nextText: linePrefixWithComment + inserted + restAfterLine,
      nextCursor: linePrefixWithComment.length + inserted.length,
      action: 'appended',
    };
  }

  if (!allowCoalesce) return fallbackAppend();

  // Do not coalesce if cursor is mid-token or inside/right before a closing bracketed group
  if (/^[A-Za-z0-9'’><)\]]/.test(after) || hasUnclosedBracketOnLine(currentLine)) {
    return fallbackAppend();
  }

  const parsedNew = parseSimpleInteractiveMove(newToken, spec);
  if (!parsedNew) return fallbackAppend();

  // Match the standalone token at the end of the current line (preceded by start-of-line or space/tab)
  const match = currentLine.match(/^(.*?)([ \t]*)([A-Za-z0-9'’><]+)([ \t]*)$/);
  if (!match) return fallbackAppend();

  const [, linePrefix, leadingSpaces, prevTok] = match;
  // Ensure `prevTok` was actually separated from `linePrefix` by whitespace (or start of line),
  // not glued onto `(`, `[`, `)`, `]`, etc.
  if (linePrefix.length > 0 && leadingSpaces.length === 0) {
    return fallbackAppend();
  }

  const parsedPrev = parseSimpleInteractiveMove(prevTok, spec);
  if (!parsedPrev || parsedPrev.kind !== parsedNew.kind) {
    return fallbackAppend();
  }

  let replacement: string | null = null;
  if (parsedPrev.kind === 'circle' && parsedNew.kind === 'circle') {
    const circle = spec.circles.find((c) => c.id === parsedPrev.circleId);
    const numLayers = circle?.layerRadii?.length ?? 1;
    if (
      parsedPrev.circleId !== parsedNew.circleId ||
      !sameLayerOpt(parsedPrev.layerOpt, parsedNew.layerOpt, numLayers)
    ) {
      return fallbackAppend();
    }
    const modulus = circle?.stopsDeg.length ?? 0;
    const combined = shortestSignedMod(parsedPrev.steps + parsedNew.steps, modulus);
    replacement =
      combined === 0 ? null : formatMoveToken(parsedPrev.circleId, combined, parsedPrev.layerOpt);
  } else if (parsedPrev.kind === 'next' && parsedNew.kind === 'next') {
    const circle = spec.circles.find((c) => c.id === parsedPrev.circleId);
    const numLayers = circle?.layerRadii?.length ?? 1;
    if (
      parsedPrev.circleId !== parsedNew.circleId ||
      !sameLayerOpt(parsedPrev.layerOpt, parsedNew.layerOpt, numLayers)
    ) {
      return fallbackAppend();
    }
    const combined = parsedPrev.steps + parsedNew.steps;
    replacement =
      combined === 0 ? null : formatNextToken(parsedPrev.circleId, combined, parsedPrev.layerOpt);
  } else if (parsedPrev.kind === 'rot' && parsedNew.kind === 'rot') {
    const symCount = Math.round(360 / spec.symmetryStepDeg);
    const combined = shortestSignedMod(parsedPrev.steps + parsedNew.steps, symCount);
    replacement = combined === 0 ? null : formatRotationToken(combined);
  } else if (parsedPrev.kind === 'flip' && parsedNew.kind === 'flip') {
    if (parsedPrev.axis !== parsedNew.axis) return fallbackAppend();
    const combined = (parsedPrev.count + parsedNew.count) % 2;
    replacement = combined === 0 ? null : parsedPrev.axis;
  } else {
    return fallbackAppend();
  }

  const prefixBeforeLine = before.slice(0, lineStart);
  const replacedStart = lineStart + linePrefix.length + leadingSpaces.length;

  if (replacement === null) {
    // Cancelled! Remove the token and its separating space (preserve indentation if first on line)
    const keepPrefix = linePrefix.length > 0 ? linePrefix : leadingSpaces;
    const nextBefore = prefixBeforeLine + keepPrefix;
    // Avoid double space if `after` starts with whitespace and `keepPrefix` ends with whitespace
    const cleanAfter =
      keepPrefix.length === 0 && /^[ \t]+/.test(after) ? after.replace(/^[ \t]+/, '') : after;
    return {
      nextText: nextBefore + cleanAfter,
      nextCursor: nextBefore.length,
      action: 'cancelled',
      replacedStart,
    };
  }

  // Merged! Replace `prevTok` with `replacement` cleanly
  const needSpaceAfter = after.length > 0 && !/^[\s)\]}:,]/.test(after);
  const nextBefore = prefixBeforeLine + linePrefix + leadingSpaces + replacement;
  return {
    nextText: nextBefore + (needSpaceAfter ? ' ' : '') + after,
    nextCursor: nextBefore.length,
    action: 'merged',
    replacedStart,
    mergedToken: replacement,
  };
}
