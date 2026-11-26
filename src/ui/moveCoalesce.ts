import { formatMoveToken } from '../puzzle/engine.ts';
import { PuzzleSpec } from '../puzzle/types.ts';

export interface CoalesceResult {
  nextText: string;
  nextCursor: number;
  action: 'appended' | 'merged' | 'cancelled';
}

type ParsedSimpleMove =
  | { kind: 'circle'; circleId: string; steps: number }
  | { kind: 'next'; circleId: string; steps: number }
  | { kind: 'rot'; steps: number };

function parseSimpleInteractiveMove(token: string, spec: PuzzleSpec): ParsedSimpleMove | null {
  const trimmed = token.trim();
  const nextMatch = trimmed.match(/^([A-Z])([><])(\d*)$/);
  if (nextMatch) {
    const circleId = nextMatch[1];
    if (!spec.circles.some((c) => c.id === circleId)) return null;
    const count = nextMatch[3] ? parseInt(nextMatch[3], 10) : 1;
    if (count === 0) return null;
    return { kind: 'next', circleId, steps: nextMatch[2] === '>' ? count : -count };
  }

  const circleMatch = trimmed.match(/^([A-Z])(\d*)('?)$/);
  if (circleMatch) {
    const circleId = circleMatch[1];
    if (!spec.circles.some((c) => c.id === circleId)) return null;
    const count = circleMatch[2] ? parseInt(circleMatch[2], 10) : 1;
    if (count === 0) return null;
    return { kind: 'circle', circleId, steps: circleMatch[3] === "'" ? -count : count };
  }

  const rotMatch = trimmed.match(/^z(\d*)('?)$/);
  if (rotMatch && spec.symmetryStepDeg > 0) {
    const count = rotMatch[1] ? parseInt(rotMatch[1], 10) : 1;
    if (count === 0) return null;
    return { kind: 'rot', steps: rotMatch[2] === "'" ? -count : count };
  }

  return null;
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

function formatNextToken(circleId: string, steps: number): string {
  const abs = Math.abs(steps);
  const dir = steps > 0 ? '>' : '<';
  return `${circleId}${dir}${abs === 1 ? '' : abs}`;
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

  if (!allowCoalesce) return fallbackAppend();

  // Do not coalesce if cursor is mid-token (immediately followed by token characters)
  if (/^[A-Za-z0-9'><]/.test(after)) {
    return fallbackAppend();
  }

  const parsedNew = parseSimpleInteractiveMove(newToken, spec);
  if (!parsedNew) return fallbackAppend();

  // Only inspect the current line before the cursor (never cross a newline!)
  const lineStart = before.lastIndexOf('\n') + 1;
  const currentLine = before.slice(lineStart);

  // If the current line has a comment before the cursor, append on a new line instead
  if (/(?:\/\/|#)/.test(currentLine)) {
    const inserted = `\n${newToken}`;
    const nextText = before + inserted + after;
    return {
      nextText,
      nextCursor: before.length + inserted.length,
      action: 'appended',
    };
  }

  // Match the standalone token at the end of the current line (preceded by start-of-line or space/tab)
  const match = currentLine.match(/^(.*?)([ \t]*)([A-Za-z0-9'><]+)([ \t]*)$/);
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
    if (parsedPrev.circleId !== parsedNew.circleId) return fallbackAppend();
    const circle = spec.circles.find((c) => c.id === parsedPrev.circleId);
    const modulus = circle?.stopsDeg.length ?? 0;
    const combined = shortestSignedMod(parsedPrev.steps + parsedNew.steps, modulus);
    replacement = combined === 0 ? null : formatMoveToken(parsedPrev.circleId, combined);
  } else if (parsedPrev.kind === 'next' && parsedNew.kind === 'next') {
    if (parsedPrev.circleId !== parsedNew.circleId) return fallbackAppend();
    const combined = parsedPrev.steps + parsedNew.steps;
    replacement = combined === 0 ? null : formatNextToken(parsedPrev.circleId, combined);
  } else if (parsedPrev.kind === 'rot' && parsedNew.kind === 'rot') {
    const symCount = Math.round(360 / spec.symmetryStepDeg);
    const combined = shortestSignedMod(parsedPrev.steps + parsedNew.steps, symCount);
    replacement = combined === 0 ? null : formatRotationToken(combined);
  } else {
    return fallbackAppend();
  }

  const prefixBeforeLine = before.slice(0, lineStart);

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
    };
  }

  // Merged! Replace `prevTok` with `replacement` cleanly
  const needSpaceAfter = after.length > 0 && !/^[\s)\]}:,]/.test(after);
  const nextBefore = prefixBeforeLine + linePrefix + leadingSpaces + replacement;
  return {
    nextText: nextBefore + (needSpaceAfter ? ' ' : '') + after,
    nextCursor: nextBefore.length,
    action: 'merged',
  };
}
