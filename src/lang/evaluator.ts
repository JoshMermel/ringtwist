import { regionSilhouetteKey } from '../geom/arcRegion.ts';
import {
  MoveResult,
  flipWholePuzzle,
  formatMoveToken,
  hashPuzzleShape,
  hashPuzzleState,
  isPuzzleSolved,
  pieceStickerKey,
  rotateWholePuzzle,
  turnCircleBySteps,
  turnCircleNextUnblocked,
} from '../puzzle/engine.ts';
import { MirrorAxis, Piece, PuzzleState } from '../puzzle/types.ts';
import { ExprNode, ParseError, ProgramAST, Span } from './ast.ts';
import { invertExpr, parseAlgorithm } from './parser.ts';

export interface MacroLibraryEntry {
  name: string;
  body: string;
  note?: string;
  /** Optional congruent piece shape-type IDs selecting which piece types to highlight on hover. */
  focusTypes?: string[];
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
  flipAxis?: MirrorAxis;
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

    // If a piece carries multi-color orientation stickers (e.g. Geranium center pentagon),
    // pure silhouette permutation is exact iff that sticker piece stayed fixed with the same orientation;
    // otherwise defer to exact state-hash cycle detection.
    const bp = before.pieces[i];
    if (bp.stickers && bp.stickers.length > 0) {
      if (j !== i || pieceStickerKey(after.pieces[i]) !== pieceStickerKey(bp)) {
        return null;
      }
    }
  }

  return perm;
}

/** Compute `perm^k` in O(n) via cycle decomposition (works for huge or BigInt k!). */
function powPermutation(perm: number[], k: number | bigint): number[] {
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
    const shift =
      typeof k === 'bigint'
        ? Number(((k % BigInt(len)) + BigInt(len)) % BigInt(len))
        : ((k % len) + len) % len;
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
  k: number | bigint,
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
      const kModN =
        typeof k === 'bigint'
          ? Number(((k % BigInt(n)) + BigInt(n)) % BigInt(n))
          : ((k % n) + n) % n;
      nextStops[c.id] = (((baseState.circleStopIndex[c.id] ?? 0) + d * kModN) % n + n) % n;
    }
  }

  const rotOffset =
    totalRotDeltaDeg === 0
      ? 0
      : totalRotDeltaDeg * (typeof k === 'bigint' ? Number(k % 360000n) : k);

  return {
    ...baseState,
    pieces,
    circleStopIndex: nextStops,
    puzzleRotationDeg: (((baseState.puzzleRotationDeg + rotOffset) % 360) + 360) % 360,
  };
}

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0n ? 1n : x;
}

function lcmBig(a: bigint, b: bigint): bigint {
  return (a / gcdBig(a, b)) * b;
}

interface CompiledProgram {
  ast: ProgramAST;
  baseEnv: MacroEnv;
  parseErrors: ParseError[];
}

function compileProgram(
  source: string,
  externalMacros: MacroLibraryEntry[],
  validCircles: string[],
  multiLayerCircles: string[],
): CompiledProgram {
  const baseEnv: MacroEnv = new Map();
  for (const m of externalMacros) {
    const parsed = parseAlgorithm(m.body, validCircles, multiLayerCircles);
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
      baseEnv.set(m.name, { expr: combined, source: m.body });
    }
  }
  const ast = parseAlgorithm(source, validCircles, multiLayerCircles);
  return { ast, baseEnv, parseErrors: [...ast.errors] };
}

interface RunCompiledOptions extends EvaluateOptions {
  recordSteps?: boolean;
  checkSolved?: boolean;
}

function runCompiledProgram(
  initialState: PuzzleState,
  compiled: CompiledProgram,
  options: RunCompiledOptions = {},
): EvaluationResult {
  const maxExpandedSteps = options.maxExpandedSteps ?? 1500;
  const solvedRef = options.solvedReference ?? initialState;
  const shouldRecordSteps = options.recordSteps ?? true;
  const shouldCheckSolved = options.checkSolved ?? true;

  const env: MacroEnv = new Map(compiled.baseEnv);
  const parseErrors: ParseError[] = [...compiled.parseErrors];
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
        ...(res.flipAxis ? { flipAxis: res.flipAxis } : {}),
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
      // When a sequence includes whole-puzzle rotation `z` on uneven-stop puzzles or an odd number
      // of mirror flips (`x` / `y`), circleStopIndex permutes/reflects across circles rather than
      // shifting uniformly; defer to exact state-hash cycle detection.
      const flippedChanged = (state1.puzzleFlipped ?? false) !== (state0.puzzleFlipped ?? false);
      if (
        hashPuzzleShape(state1) === shape0 &&
        !flippedChanged &&
        (rotDelta === 0 || allCirclesEvenStops)
      ) {
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
        const layerOpt =
          node.layer !== undefined || node.wide
            ? { layer: node.layer, wide: node.wide }
            : undefined;
        const label = formatMoveToken(node.circleId, node.steps, layerOpt);
        const res = turnCircleBySteps(currentState, node.circleId, node.steps, layerOpt);
        const spanToUse = macroStack.length === 0 ? node.span : topSpan;
        return execMove(res, label, node.circleId, node.span, spanToUse, macroStack, recordSteps);
      }

      case 'nextUnblocked': {
        if (node.count <= 0) return true;
        const layerOpt =
          node.layer !== undefined || node.wide
            ? { layer: node.layer, wide: node.wide }
            : undefined;
        const arrow = node.direction === 1 ? '>' : '<';
        const base = node.wide
          ? `${node.layer && node.layer > 2 ? node.layer : ''}${node.circleId.toLowerCase()}`
          : `${node.layer && node.layer > 1 ? node.layer : ''}${node.circleId}`;
        const label = `${base}${arrow}${node.count === 1 ? '' : node.count}`;
        const res = turnCircleNextUnblocked(
          currentState,
          node.circleId,
          node.direction,
          node.count,
          layerOpt,
        );
        const spanToUse = macroStack.length === 0 ? node.span : topSpan;
        return execMove(res, label, node.circleId, node.span, spanToUse, macroStack, recordSteps);
      }

      case 'rotation': {
        if (node.steps === 0) return true;
        const abs = Math.abs(node.steps);
        const label = `z${abs === 1 ? '' : abs}${node.steps < 0 ? "'" : ''}`;
        const res = rotateWholePuzzle(currentState, node.steps);
        const spanToUse = macroStack.length === 0 ? node.span : topSpan;
        return execMove(res, label, 'z', node.span, spanToUse, macroStack, recordSteps);
      }

      case 'mirrorFlip': {
        if (node.count <= 0) return true;
        const spanToUse = macroStack.length === 0 ? node.span : topSpan;
        for (let k = 0; k < node.count; k++) {
          const res = flipWholePuzzle(currentState, node.axis);
          if (!execMove(res, node.axis, node.axis, node.span, spanToUse, macroStack, recordSteps)) {
            return false;
          }
        }
        return true;
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

  for (const stmt of compiled.ast.statements) {
    if (stmt.kind === 'macroDef') {
      env.set(stmt.name, { expr: stmt.body, source: stmt.bodySource });
      inlineMacros[stmt.name] = stmt.bodySource;
    } else {
      if (!evalNode(stmt.expr, stmt.span, [], shouldRecordSteps)) {
        break;
      }
    }
  }

  return {
    initialState,
    steps,
    finalState: currentState,
    solved: shouldCheckSolved ? isPuzzleSolved(currentState, solvedRef) : false,
    parseErrors,
    runtimeError,
    blocked,
    inlineMacros,
    usedFastForward,
  };
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
  const validCircles = initialState.spec.circles.map((c) => c.id);
  const multiLayerCircles = initialState.spec.circles
    .filter((c) => c.layerRadii && c.layerRadii.length > 1)
    .map((c) => c.id);
  const compiled = compileProgram(source, externalMacros, validCircles, multiLayerCircles);
  return runCompiledProgram(initialState, compiled, {
    ...options,
    recordSteps: true,
    checkSolved: true,
  });
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
  const validCircles = state.spec.circles.map((c) => c.id);
  const multiLayerCircles = state.spec.circles
    .filter((c) => c.layerRadii && c.layerRadii.length > 1)
    .map((c) => c.id);
  const compiled = compileProgram(algSource, externalMacros, validCircles, multiLayerCircles);
  const first = runCompiledProgram(state, compiled, {
    recordSteps: false,
    checkSolved: false,
  });
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
  const flippedChanged =
    (first.finalState.puzzleFlipped ?? false) !== (state.puzzleFlipped ?? false);

  if (shape0 === shape1 && !flippedChanged) {
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

      // Exact piece-permutation order = BigInt LCM of cycle lengths, plus its prime factors
      // (each cycle length <= piece count, so factoring is instant).
      let permOrder = 1n;
      const primeFactors = new Set<bigint>();
      for (const l of cycleLens) {
        permOrder = lcmBig(permOrder, BigInt(l));
        let m = l;
        for (let p = 2; p * p <= m; p++) {
          if (m % p === 0) {
            primeFactors.add(BigInt(p));
            while (m % p === 0) m /= p;
          }
        }
        if (m > 1) primeFactors.add(BigInt(m));
      }

      // Find exact smallest divisor of permOrder that restores visible colors in O(Omega(N))
      // via greedy prime-factor reduction (exact because {k : P^k preserves colors} is a subgroup of Z).
      let visibleOrder = permOrder;
      const rotDelta =
        (((first.finalState.puzzleRotationDeg - state.puzzleRotationDeg) % 360) + 360) % 360;
      for (const p of primeFactors) {
        while (visibleOrder % p === 0n) {
          const cand = visibleOrder / p;
          const pow = powPermutation(perm, cand);
          const testState = applyShapePermutation(state, first.finalState, pow, rotDelta, cand);
          if (hashPuzzleState(testState) === h0) {
            visibleOrder = cand;
          } else {
            break;
          }
        }
      }

      // Summarize cycles (e.g. "2× 3-cycle, 1× 2-cycle")
      const counts = new Map<number, number>();
      for (const l of cycleLens) counts.set(l, (counts.get(l) ?? 0) + 1);
      const cycleSummary = [...counts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([len, cnt]) => (cnt > 1 ? `${cnt}×${len}-cycle` : `${len}-cycle`))
        .join(', ');

      const safeOrder =
        visibleOrder <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(visibleOrder) : undefined;
      return {
        status: 'shape-preserving',
        order: safeOrder,
        changedPieces,
        shapePreserving: true,
        cycleSummary,
        message: `Order ${visibleOrder.toString()} (shape-preserving · ${changedPieces} pieces: ${cycleSummary || 'orientation only'})`,
      };
    }
  }

  // General non-shape-preserving repeat scan (reuses compiled AST, skips step recording & solved check)
  let cur = first.finalState;
  for (let rep = 2; rep <= maxReps; rep++) {
    const next = runCompiledProgram(cur, compiled, {
      recordSteps: false,
      checkSolved: false,
    });
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
