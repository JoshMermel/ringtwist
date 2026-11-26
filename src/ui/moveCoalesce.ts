import { MoveLayerSpec, formatMoveToken } from '../puzzle/engine.ts';
import { PuzzleSpec } from '../puzzle/types.ts';

export interface CoalesceResult {
  nextText: string;
  nextCursor: number;
  action: 'appended' | 'merged' | 'cancelled';
}

type ParsedSimpleMove =
  | { kind: 'circle'; circleId: string; steps: number; layerOpt?: MoveLayerSpec }
  | { kind: 'next'; circleId: string; steps: number; layerOpt?: MoveLayerSpec }
  | { kind: 'rot'; steps: number }
  | { kind: 'flip'; axis: 'x' | 'y'; count: number };

function sameLayerOpt(a?: MoveLayerSpec, b?: MoveLayerSpec): boolean {
  return (a?.layer ?? 1) === (b?.layer ?? 1) && Boolean(a?.wide) === Boolean(b?.wide);
}

function parseSimpleInteractiveMove(token: string, spec: PuzzleSpec): ParsedSimpleMove | null {
  const trimmed = token.trim();
  const nextMatch = trimmed.match(/^(\d*)([A-Za-w])([><])(\d*)$/);
  if (nextMatch) {
    const rawLetter = nextMatch[2];
    const isLower = rawLetter >= 'a' && rawLetter <= 'w';
    const circleId = rawLetter.toUpperCase();
    const cDef = spec.circles.find((c) => c.id === circleId);
    if (!cDef) return null;
    if (isLower && !(cDef.layerRadii && cDef.layerRadii.length > 1)) return null;
    const layer = nextMatch[1] ? parseInt(nextMatch[1], 10) : undefined;
    const layerOpt: MoveLayerSpec | undefined =
      layer !== undefined || isLower ? { ...(layer ? { layer } : {}), ...(isLower ? { wide: true } : {}) } : undefined;
    const count = nextMatch[4] ? parseInt(nextMatch[4], 10) : 1;
    if (count === 0) return null;
    return { kind: 'next', circleId, steps: nextMatch[3] === '>' ? count : -count, layerOpt };
  }

  const rotMatch = trimmed.match(/^z(\d*)('?)$/);
  if (rotMatch && spec.symmetryStepDeg > 0) {
    const count = rotMatch[1] ? parseInt(rotMatch[1], 10) : 1;
    if (count === 0) return null;
    return { kind: 'rot', steps: rotMatch[2] === "'" ? -count : count };
  }

  const flipMatch = trimmed.match(/^([xy])(\d*)('?)$/);
  if (flipMatch) {
    const count = flipMatch[2] ? parseInt(flipMatch[2], 10) : 1;
    if (count === 0) return null;
    return { kind: 'flip', axis: flipMatch[1] as 'x' | 'y', count };
  }

  const circleMatch = trimmed.match(/^(\d*)([A-Za-w])(\d*)('?)$/);
  if (circleMatch) {
    const rawLetter = circleMatch[2];
    const isLower = rawLetter >= 'a' && rawLetter <= 'w';
    const circleId = rawLetter.toUpperCase();
    const cDef = spec.circles.find((c) => c.id === circleId);
    if (!cDef) return null;
    if (isLower && !(cDef.layerRadii && cDef.layerRadii.length > 1)) return null;
    const layer = circleMatch[1] ? parseInt(circleMatch[1], 10) : undefined;
    const layerOpt: MoveLayerSpec | undefined =
      layer !== undefined || isLower ? { ...(layer ? { layer } : {}), ...(isLower ? { wide: true } : {}) } : undefined;
    const count = circleMatch[3] ? parseInt(circleMatch[3], 10) : 1;
    if (count === 0) return null;
    return { kind: 'circle', circleId, steps: circleMatch[4] === "'" ? -count : count, layerOpt };
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

function formatNextToken(circleId: string, steps: number, layerOpt?: MoveLayerSpec): string {
  const abs = Math.abs(steps);
  const dir = steps > 0 ? '>' : '<';
  const base = layerOpt?.wide
    ? `${layerOpt.layer && layerOpt.layer > 2 ? layerOpt.layer : ''}${circleId.toLowerCase()}`
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
    if (
      parsedPrev.circleId !== parsedNew.circleId ||
      !sameLayerOpt(parsedPrev.layerOpt, parsedNew.layerOpt)
    ) {
      return fallbackAppend();
    }
    const circle = spec.circles.find((c) => c.id === parsedPrev.circleId);
    const modulus = circle?.stopsDeg.length ?? 0;
    const combined = shortestSignedMod(parsedPrev.steps + parsedNew.steps, modulus);
    replacement =
      combined === 0 ? null : formatMoveToken(parsedPrev.circleId, combined, parsedPrev.layerOpt);
  } else if (parsedPrev.kind === 'next' && parsedNew.kind === 'next') {
    if (
      parsedPrev.circleId !== parsedNew.circleId ||
      !sameLayerOpt(parsedPrev.layerOpt, parsedNew.layerOpt)
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
