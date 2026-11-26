import { regionSilhouetteKey } from '../geom/arcRegion.ts';
import {
  MoveResult,
  formatMoveToken,
  hashPuzzleShape,
  hashPuzzleState,
  isPuzzleSolved,
  rotateWholePuzzle,
  turnCircleBySteps,
  turnCircleNextUnblocked,
} from '../puzzle/engine.ts';
import { Piece, PuzzleState } from '../puzzle/types.ts';
import { ExprNode, ParseError, Span } from './ast.ts';
import { invertExpr, parseAlgorithm } from './parser.ts';

export interface MacroLibraryEntry {
  name: string;
  body: string;
  note?: string;
}

export interface ExecutedStep {
  index: number;
  moveLabel: string;
  /** Span of the atomic move inside its defining source (or top-level). */
  span: Span;
  /** Span in the top-level editor text (for cursor-sync and highlighting). */
  topSpan: Span;
  macroStack: string[];
  angleDeg: number;
  pivot: { x: number; y: number };
  movedPieceIds: number[];
  /** True if this step was computed via group-theory / cycle-detection fast-forward. */
  fastForwarded?: boolean;
  stateAfter: PuzzleState;
}

export interface BlockedError {
  stepIndex: number;
  moveLabel: string;
  circleId: string;
  blockingPieceIds: number[];
  reason: string;
  span: Span;
  topSpan: Span;
  macroStack: string[];
  stateBefore: PuzzleState;
}

export interface EvaluationResult {
  initialState: PuzzleState;
  steps: ExecutedStep[];
  finalState: PuzzleState;
  solved: boolean;
  parseErrors: ParseError[];
  runtimeError?: { message: string; span: Span };
  blocked?: BlockedError;
  /** Inline macros defined in the editor script. */
  inlineMacros: Record<string, string>;
  /** True if group-theory or cycle fast-forward accelerated any huge repeat. */
  usedFastForward: boolean;
}

export interface EvaluateOptions {
  /** Max individual atomic steps before engaging fast-forward on large repeats (default 1500). */
  maxExpandedSteps?: number;
  /** Solved reference state (defaults to initialState). */
  solvedReference?: PuzzleState;
}

type MacroEnv = Map<string, { expr: ExprNode; source: string }>;

/**
 * Given two states with identical piece silhouettes (shape-preserving move),
 * extract the permutation `perm[i] = j` meaning the piece at index `i` in `before`
 * moved to occupy the silhouette of index `j` in `before` (i.e. `after.pieces[i]`
 * now sits at `before.pieces[j]`'s position).
 * Returns null if silhouettes aren't a clean 1-to-1 bijection.
 */
function extractShapePermutation(
  before: PuzzleState,
  after: PuzzleState,
): number[] | null {
  const n = before.pieces.length;
  if (after.pieces.length !== n) return null;
  // Pieces with multi-color orientation stickers can twist in place without changing
  // silhouette, so defer to exact state-hash cycle detection when present.
  if (before.pieces.some((p) => p.stickers && p.stickers.length > 0)) return null;

  // Map silhouette key -> list of piece indices in `before`
  const beforeMap = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const key = regionSilhouetteKey(before.pieces[i].region);
    let list = beforeMap.get(key);
    if (!list) {
      list = [];
      beforeMap.set(key, list);
    }
    list.push(i);
  }

  // Only unambiguous when every silhouette key is unique (true for all non-overlapping pieces)
  const perm = new Array<number>(n);
  const used = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const key = regionSilhouetteKey(after.pieces[i].region);
    const matches = beforeMap.get(key);
    if (!matches || matches.length !== 1) return null;
    const j = matches[0];
    if (used[j]) return null;
    used[j] = 1;
    perm[i] = j;
  }

  return perm;
}

/** Compute `perm^k` in O(n) via cycle decomposition (works for huge k!). */
function powPermutation(perm: number[], k: number): number[] {
  const n = perm.length;
  const result = new Array<number>(n);
  const visited = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const cycle: number[] = [];
    let cur = i;
    while (!visited[cur]) {
      visited[cur] = 1;
      cycle.push(cur);
      cur = perm[cur];
    }
    const len = cycle.length;
    const shift = ((k % len) + len) % len;
    for (let idx = 0; idx < len; idx++) {
      result[cycle[idx]] = cycle[(idx + shift) % len];
    }
  }
  return result;
}

/** Apply a silhouette permutation `perm` to `baseState` (moving piece i into slot perm[i]). */
function applyShapePermutation(
  baseState: PuzzleState,
  afterOneState: PuzzleState,
  permPow: number[],
  totalRotDeltaDeg: number,
  k: number,
): PuzzleState {
  const pieces: Piece[] = baseState.pieces.map((p, i) => ({
    ...p,
    region: baseState.pieces[permPow[i]].region,
  }));

  // Update circleStopIndex assuming uniform shift when shape-preserving
  const nextStops = { ...baseState.circleStopIndex };
  for (const c of baseState.spec.circles) {
    const n = c.stopsDeg.length;
    if (n > 0) {
      const d =
        (((afterOneState.circleStopIndex[c.id] ?? 0) -
          (baseState.circleStopIndex[c.id] ?? 0)) %
          n +
          n) %
        n;
      nextStops[c.id] = (((baseState.circleStopIndex[c.id] ?? 0) + d * k) % n + n) % n;
    }
  }

  return {
    ...baseState,
    pieces,
    circleStopIndex: nextStops,
    puzzleRotationDeg:
      (((baseState.puzzleRotationDeg + totalRotDeltaDeg * k) % 360) + 360) % 360,
  };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/**
 * Evaluate a full algorithm program against `initialState`.
 * Stops immediately on the first blocked move and surfaces full blocking diagnostics.
 */
export function evaluateProgram(
  initialState: PuzzleState,
  source: string,
  externalMacros: MacroLibraryEntry[] = [],
  options: EvaluateOptions = {},
): EvaluationResult {
  const maxExpandedSteps = options.maxExpandedSteps ?? 1500;
  const solvedRef = options.solvedReference ?? initialState;
  const validCircles = initialState.spec.circles.map((c) => c.id);

  // Build macro environment from external sidebar macros first
  const env: MacroEnv = new Map();
  for (const m of externalMacros) {
    const parsed = parseAlgorithm(m.body, validCircles);
    const exprs = parsed.statements
      .filter((s) => s.kind === 'exprStmt')
      .map((s) => s.expr);
    if (exprs.length > 0) {
      const combined: ExprNode =
        exprs.length === 1
          ? exprs[0]
          : {
              kind: 'sequence',
              items: exprs,
              span: { start: 0, end: m.body.length },
            };
      env.set(m.name, { expr: combined, source: m.body });
    }
  }

  const ast = parseAlgorithm(source, validCircles);
  const parseErrors: ParseError[] = [...ast.errors];
  const inlineMacros: Record<string, string> = {};

  const steps: ExecutedStep[] = [];
  let currentState = initialState;
  let blocked: BlockedError | undefined;
  let runtimeError: { message: string; span: Span } | undefined;
  let usedFastForward = false;

  const execMove = (
    res: MoveResult,
    moveLabel: string,
    circleId: string,
    span: Span,
    topSpan: Span,
    macroStack: string[],
    record: boolean,
  ): boolean => {
    if (!res.ok) {
      blocked = {
        stepIndex: steps.length,
        moveLabel,
        circleId: res.circleId || circleId,
        blockingPieceIds: res.blockingPieceIds,
        reason: res.reason,
        span,
        topSpan,
        macroStack: [...macroStack],
        stateBefore: currentState,
      };
      return false;
    }
    currentState = res.nextState;
    if (record) {
      steps.push({
        index: steps.length,
        moveLabel,
        span,
        topSpan,
        macroStack: [...macroStack],
        angleDeg: res.angleDeg,
        pivot: res.pivot,
        movedPieceIds: res.movedPieceIds,
        stateAfter: currentState,
      });
    }
    return true;
  };

  /**
   * Execute an expression node `repeat` times.
   * For large repeats (where expanding every step would exceed `maxExpandedSteps`),
   * automatically switches to Group-Theory shape-invariant permutation exponentiation
   * or state-hash cycle detection!
   */
  const evalRepeat = (
    body: ExprNode,
    repeat: number,
    invert: boolean,
    labelHint: string,
    topSpan: Span,
    macroStack: string[],
    recordSteps: boolean,
  ): boolean => {
    if (repeat <= 0) return true;
    const effective = invert ? invertExpr(body) : body;

    // Fast-forward threshold: huge repeat count
    if (repeat >= 25 || (recordSteps && steps.length + repeat > maxExpandedSteps)) {
      const state0 = currentState;
      const shape0 = hashPuzzleShape(state0);

      // Run 1 iteration silently (not recording intermediate steps)
      if (!evalNode(effective, topSpan, macroStack, false)) {
        return false;
      }
      const state1 = currentState;

      // Case 1: Shape-invariant! Acts as a pure permutation group element => O(n) exact jump!
      const rotDelta =
        (((state1.puzzleRotationDeg - state0.puzzleRotationDeg) % 360) + 360) % 360;
      const allCirclesEvenStops = state0.spec.circles.every((c) => {
        const len = c.stopsDeg.length;
        if (len === 0) return true;
        const step = 360 / len;
        return c.stopsDeg.every((a, idx) => Math.abs(a - idx * step) < 1e-4);
      });
      // When a sequence includes whole-puzzle rotation `r` on uneven-stop puzzles,
      // circleStopIndex permutes across circles rather than shifting uniformly; defer to exact cycle detection.
      if (hashPuzzleShape(state1) === shape0 && (rotDelta === 0 || allCirclesEvenStops)) {
        const perm = extractShapePermutation(state0, state1);
        if (perm) {
          const permPow = powPermutation(perm, repeat);
          currentState = applyShapePermutation(state0, state1, permPow, rotDelta, repeat);
          usedFastForward = true;
          if (recordSteps) {
            steps.push({
              index: steps.length,
              moveLabel: `${labelHint}×${repeat} (fast)`,
              span: topSpan,
              topSpan,
              macroStack: [...macroStack],
              angleDeg: 0,
              pivot: state0.spec.symmetryCenter ?? { x: 0, y: 0 },
              movedPieceIds: [],
              fastForwarded: true,
              stateAfter: currentState,
            });
          }
          return true;
        }
      }

      // Case 2: Non-shape-preserving repeat => state-hash cycle detection
      const seen = new Map<string, { rep: number; state: PuzzleState }>();
      seen.set(hashPuzzleState(state0), { rep: 0, state: state0 });
      const statesByRep: PuzzleState[] = [state0, state1];
      const h1 = hashPuzzleState(state1);

      if (seen.has(h1)) {
        // Period 1 (already returned to state0)
        currentState = state0;
        usedFastForward = true;
      } else {
        seen.set(h1, { rep: 1, state: state1 });
        let jumped = false;
        const maxCycleScan = Math.min(repeat, 2000);
        for (let r = 2; r <= maxCycleScan; r++) {
          if (!evalNode(effective, topSpan, macroStack, false)) {
            return false;
          }
          const h = hashPuzzleState(currentState);
          const prev = seen.get(h);
          if (prev) {
            const period = r - prev.rep;
            const targetIdx = prev.rep + ((repeat - prev.rep) % period);
            currentState = statesByRep[targetIdx];
            usedFastForward = true;
            jumped = true;
            break;
          }
          seen.set(h, { rep: r, state: currentState });
          statesByRep.push(currentState);
        }
        if (!jumped && maxCycleScan < repeat) {
          runtimeError = {
            message: `Repeat ×${repeat} exceeded safety limit without finding a cycle`,
            span: topSpan,
          };
          return false;
        }
      }

      if (recordSteps) {
        steps.push({
          index: steps.length,
          moveLabel: `${labelHint}×${repeat} (fast)`,
          span: topSpan,
          topSpan,
          macroStack: [...macroStack],
          angleDeg: 0,
          pivot: state0.spec.symmetryCenter ?? { x: 0, y: 0 },
          movedPieceIds: [],
          fastForwarded: true,
          stateAfter: currentState,
        });
      }
      return true;
    }

    // Normal step-by-step execution
    for (let k = 0; k < repeat; k++) {
      if (!evalNode(effective, topSpan, macroStack, recordSteps)) {
        return false;
      }
    }
    return true;
  };

  const evalNode = (
    node: ExprNode,
    topSpan: Span,
    macroStack: string[],
    recordSteps: boolean,
  ): boolean => {
    if (blocked || runtimeError) return false;
    if (recordSteps && steps.length >= maxExpandedSteps) {
      runtimeError = {
        message: `Execution exceeded ${maxExpandedSteps} steps`,
        span: topSpan,
      };
      return false;
    }

    switch (node.kind) {
      case 'sequence':
        for (const item of node.items) {
          const itemTopSpan = macroStack.length === 0 ? item.span : topSpan;
          if (!evalNode(item, itemTopSpan, macroStack, recordSteps)) return false;
        }
        return true;

      case 'circleMove': {
        if (node.steps === 0) return true;
        const label = formatMoveToken(node.circleId, node.steps);
        const res = turnCircleBySteps(currentState, node.circleId, node.steps);
        const spanToUse = macroStack.length === 0 ? node.span : topSpan;
        return execMove(res, label, node.circleId, node.span, spanToUse, macroStack, recordSteps);
      }

      case 'nextUnblocked': {
        const arrow = node.direction === 1 ? '>' : '<';
        const label = `${node.circleId}${arrow}${node.count === 1 ? '' : node.count}`;
        const res = turnCircleNextUnblocked(
          currentState,
          node.circleId,
          node.direction,
          node.count,
        );
        const spanToUse = macroStack.length === 0 ? node.span : topSpan;
        return execMove(res, label, node.circleId, node.span, spanToUse, macroStack, recordSteps);
      }

      case 'rotation': {
        if (node.steps === 0) return true;
        const abs = Math.abs(node.steps);
        const label = `r${abs === 1 ? '' : abs}${node.steps < 0 ? "'" : ''}`;
        const res = rotateWholePuzzle(currentState, node.steps);
        const spanToUse = macroStack.length === 0 ? node.span : topSpan;
        return execMove(res, label, 'r', node.span, spanToUse, macroStack, recordSteps);
      }

      case 'group': {
        const spanToUse = macroStack.length === 0 ? node.span : topSpan;
        return evalRepeat(
          node.body,
          node.repeat,
          node.invert,
          '(...)',
          spanToUse,
          macroStack,
          recordSteps,
        );
      }

      case 'commutator': {
        // [A, B] = A B A' B'
        const expanded: ExprNode = {
          kind: 'sequence',
          items: [node.a, node.b, invertExpr(node.a), invertExpr(node.b)],
          span: node.span,
        };
        const spanToUse = macroStack.length === 0 ? node.span : topSpan;
        return evalRepeat(
          expanded,
          node.repeat,
          node.invert,
          '[A,B]',
          spanToUse,
          macroStack,
          recordSteps,
        );
      }

      case 'conjugate': {
        // [A: B] = A B A'
        const expanded: ExprNode = {
          kind: 'sequence',
          items: [node.a, node.b, invertExpr(node.a)],
          span: node.span,
        };
        const spanToUse = macroStack.length === 0 ? node.span : topSpan;
        return evalRepeat(
          expanded,
          node.repeat,
          node.invert,
          '[A:B]',
          spanToUse,
          macroStack,
          recordSteps,
        );
      }

      case 'macroCall': {
        let entry = env.get(node.name);
        let resolvedName = node.name;
        let resolvedRepeat = node.repeat;
        // If `conj3` isn't a macro name itself, check if `conj` is a macro and `3` is a repeat count!
        if (!entry) {
          const m = node.name.match(/^([A-Za-z_][A-Za-z0-9_]*?)(\d+)$/);
          if (m && env.has(m[1])) {
            resolvedName = m[1];
            entry = env.get(resolvedName);
            resolvedRepeat = parseInt(m[2], 10) * node.repeat;
          }
        }
        const spanToUse = macroStack.length === 0 ? node.span : topSpan;
        if (!entry) {
          runtimeError = {
            message: `Unknown move or macro "${node.name}"`,
            span: spanToUse,
          };
          return false;
        }
        if (macroStack.includes(resolvedName)) {
          runtimeError = {
            message: `Recursive macro call detected: "${resolvedName}"`,
            span: spanToUse,
          };
          return false;
        }
        return evalRepeat(
          entry.expr,
          resolvedRepeat,
          node.invert,
          resolvedName,
          spanToUse,
          [...macroStack, resolvedName],
          recordSteps,
        );
      }
    }
  };

  for (const stmt of ast.statements) {
    if (stmt.kind === 'macroDef') {
      env.set(stmt.name, { expr: stmt.body, source: stmt.bodySource });
      inlineMacros[stmt.name] = stmt.bodySource;
    } else {
      if (!evalNode(stmt.expr, stmt.span, [], true)) {
        break;
      }
    }
  }

  return {
    initialState,
    steps,
    finalState: currentState,
    solved: isPuzzleSolved(currentState, solvedRef),
    parseErrors,
    runtimeError,
    blocked,
    inlineMacros,
    usedFastForward,
  };
}

export interface AlgorithmAnalysis {
  status: 'identity' | 'shape-preserving' | 'periodic' | 'blocked' | 'unbounded' | 'error';
  order?: number;
  blockedOnRep?: number;
  changedPieces: number;
  shapePreserving: boolean;
  cycleSummary?: string;
  message: string;
}

/**
 * Analyze the order & cycle structure of an algorithm starting from `state`.
 * Uses exact permutation cycle decomposition when shape-preserving, and state-hash
 * cycle detection otherwise!
 */
export function analyzeAlgorithm(
  state: PuzzleState,
  algSource: string,
  externalMacros: MacroLibraryEntry[] = [],
  maxReps = 200,
): AlgorithmAnalysis {
  const first = evaluateProgram(state, algSource, externalMacros);
  if (first.parseErrors.length > 0) {
    return {
      status: 'error',
      changedPieces: 0,
      shapePreserving: false,
      message: first.parseErrors[0].message,
    };
  }
  if (first.runtimeError) {
    return {
      status: 'error',
      changedPieces: 0,
      shapePreserving: false,
      message: first.runtimeError.message,
    };
  }
  if (first.blocked) {
    return {
      status: 'blocked',
      blockedOnRep: 1,
      changedPieces: 0,
      shapePreserving: false,
      message: `Blocks on rep 1 at ${first.blocked.moveLabel}: ${first.blocked.reason}`,
    };
  }

  const h0 = hashPuzzleState(state);
  const h1 = hashPuzzleState(first.finalState);
  if (h0 === h1) {
    return {
      status: 'identity',
      order: 1,
      changedPieces: 0,
      shapePreserving: true,
      message: 'Identity (order 1 — no visible change)',
    };
  }

  const shape0 = hashPuzzleShape(state);
  const shape1 = hashPuzzleShape(first.finalState);

  if (shape0 === shape1) {
    const perm = extractShapePermutation(state, first.finalState);
    if (perm) {
      // Compute cycle lengths of the permutation (and also check color-visible order)
      const visited = new Uint8Array(perm.length);
      const cycleLens: number[] = [];
      let changedPieces = 0;

      for (let i = 0; i < perm.length; i++) {
        if (visited[i]) continue;
        let len = 0;
        let cur = i;
        while (!visited[cur]) {
          visited[cur] = 1;
          len++;
          cur = perm[cur];
        }
        if (len > 1) {
          cycleLens.push(len);
          changedPieces += len;
        }
      }

      // Exact piece-permutation order = LCM of cycle lengths
      let permOrder = 1;
      for (const l of cycleLens) permOrder = lcm(permOrder, l);

      // Check smallest divisor of permOrder that restores visible colors
      let visibleOrder = permOrder;
      const divisors: number[] = [];
      for (let d = 1; d * d <= permOrder; d++) {
        if (permOrder % d === 0) {
          divisors.push(d);
          if (d * d !== permOrder) divisors.push(permOrder / d);
        }
      }
      divisors.sort((a, b) => a - b);
      const rotDelta =
        (((first.finalState.puzzleRotationDeg - state.puzzleRotationDeg) % 360) + 360) % 360;
      for (const d of divisors) {
        const pow = powPermutation(perm, d);
        const testState = applyShapePermutation(state, first.finalState, pow, rotDelta, d);
        if (hashPuzzleState(testState) === h0) {
          visibleOrder = d;
          break;
        }
      }

      // Summarize cycles (e.g. "2× 3-cycle, 1× 2-cycle")
      const counts = new Map<number, number>();
      for (const l of cycleLens) counts.set(l, (counts.get(l) ?? 0) + 1);
      const cycleSummary = [...counts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([len, cnt]) => (cnt > 1 ? `${cnt}×${len}-cycle` : `${len}-cycle`))
        .join(', ');

      return {
        status: 'shape-preserving',
        order: visibleOrder,
        changedPieces,
        shapePreserving: true,
        cycleSummary,
        message: `Order ${visibleOrder} (shape-preserving · ${changedPieces} pieces: ${cycleSummary || 'orientation only'})`,
      };
    }
  }

  // General non-shape-preserving repeat scan
  let cur = first.finalState;
  for (let rep = 2; rep <= maxReps; rep++) {
    const next = evaluateProgram(cur, algSource, externalMacros);
    if (next.blocked) {
      return {
        status: 'blocked',
        blockedOnRep: rep,
        changedPieces: -1,
        shapePreserving: false,
        message: `Shape-changing · blocks on repetition ${rep} at ${next.blocked.moveLabel}`,
      };
    }
    cur = next.finalState;
    if (hashPuzzleState(cur) === h0) {
      return {
        status: 'periodic',
        order: rep,
        changedPieces: -1,
        shapePreserving: false,
        message: `Order ${rep} (changes cut alignment mid-cycle)`,
      };
    }
  }

  return {
    status: 'unbounded',
    changedPieces: -1,
    shapePreserving: false,
    message: `Order > ${maxReps} (shape-changing)`,
  };
}
