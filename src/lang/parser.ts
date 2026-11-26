import {
  CircleMoveNode,
  ExprNode,
  GroupNode,
  MacroCallNode,
  NextUnblockedMoveNode,
  ParseError,
  ProgramAST,
  RotationMoveNode,
  SequenceNode,
  Span,
  Statement,
} from './ast.ts';

type TokenKind =
  | 'IDENT'
  | 'NUMBER'
  | 'PRIME'
  | 'GT'
  | 'LT'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'COMMA'
  | 'COLON'
  | 'EQUALS'
  | 'SEMI'
  | 'NEWLINE'
  | 'EOF';

interface Token {
  kind: TokenKind;
  value: string;
  start: number;
  end: number;
}

function tokenize(source: string): { tokens: Token[]; errors: ParseError[] } {
  const tokens: Token[] = [];
  const errors: ParseError[] = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];

    // Spaces and tabs
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }

    // Newlines (significant for ending macro definitions)
    if (ch === '\n') {
      tokens.push({ kind: 'NEWLINE', value: '\n', start: i, end: i + 1 });
      i++;
      continue;
    }

    // Line comments: // ... or # ...
    if (ch === '#' || (ch === '/' && source[i + 1] === '/')) {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }

    // Single-character punctuation
    const singleMap: Record<string, TokenKind> = {
      "'": 'PRIME',
      '’': 'PRIME',
      '>': 'GT',
      '<': 'LT',
      '(': 'LPAREN',
      ')': 'RPAREN',
      '[': 'LBRACKET',
      ']': 'RBRACKET',
      ',': 'COMMA',
      ':': 'COLON',
      '=': 'EQUALS',
      ';': 'SEMI',
    };
    if (singleMap[ch]) {
      tokens.push({ kind: singleMap[ch], value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    // Numbers
    if (ch >= '0' && ch <= '9') {
      const start = i;
      while (i < n && source[i] >= '0' && source[i] <= '9') i++;
      tokens.push({ kind: 'NUMBER', value: source.slice(start, i), start, end: i });
      continue;
    }

    // Identifiers (circle letters, 'r', or macro names)
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_]/.test(source[i])) i++;
      // Special split: if token looks like a single uppercase circle + digits (e.g. A2, B10)
      // or 'r' + digits (e.g. r2, r3), split the trailing digits into a separate NUMBER token
      // ONLY if it's NOT followed by '=' (macro def like `s2 = ...`).
      const raw = source.slice(start, i);
      const lookahead = source.slice(i).match(/^[ \t]*=/);
      if (!lookahead && /^([A-Z]|r)(\d+)$/.test(raw)) {
        const letter = raw[0];
        const digits = raw.slice(1);
        tokens.push({ kind: 'IDENT', value: letter, start, end: start + 1 });
        tokens.push({ kind: 'NUMBER', value: digits, start: start + 1, end: i });
      } else {
        tokens.push({ kind: 'IDENT', value: raw, start, end: i });
      }
      continue;
    }

    errors.push({
      message: `Unexpected character "${ch}"`,
      span: { start: i, end: i + 1 },
    });
    i++;
  }

  tokens.push({ kind: 'EOF', value: '', start: n, end: n });
  return { tokens, errors };
}

class Parser {
  private pos = 0;
  private tokens: Token[];
  private source: string;
  private validCircles: Set<string>;
  public errors: ParseError[];

  constructor(
    source: string,
    tokens: Token[],
    errors: ParseError[],
    validCircleIds?: string[],
  ) {
    this.source = source;
    this.tokens = tokens;
    this.errors = [...errors];
    this.validCircles = new Set(
      validCircleIds ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    );
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private advance(): Token {
    const t = this.peek();
    if (t.kind !== 'EOF') this.pos++;
    return t;
  }

  private skipLineSeparators(): void {
    while (this.peek().kind === 'NEWLINE' || this.peek().kind === 'SEMI') {
      this.advance();
    }
  }

  private skipNewlines(): void {
    while (this.peek().kind === 'NEWLINE') {
      this.advance();
    }
  }

  public parseProgram(): ProgramAST {
    const statements: Statement[] = [];
    this.skipLineSeparators();

    while (this.peek().kind !== 'EOF') {
      // Check for macro definition: IDENT '=' <expr until newline/semi/EOF>
      if (this.peek().kind === 'IDENT' && this.peek(1).kind === 'EQUALS') {
        const nameTok = this.advance();
        this.advance(); // '='
        if (this.validCircles.has(nameTok.value) || nameTok.value === 'r') {
          this.errors.push({
            message: `Cannot name macro "${nameTok.value}" (reserved move name)`,
            span: { start: nameTok.start, end: nameTok.end },
          });
        }
        const bodyStart = this.peek().start;
        const body = this.parseSequence(new Set(['NEWLINE', 'SEMI', 'EOF']));
        const bodyEnd = body.span.end;
        const bodySource = this.source.slice(bodyStart, bodyEnd).trim();
        statements.push({
          kind: 'macroDef',
          name: nameTok.value,
          body,
          bodySource,
          span: { start: nameTok.start, end: bodyEnd },
        });
      } else {
        const expr = this.parseSequence(new Set(['NEWLINE', 'SEMI', 'EOF']));
        if (expr.items.length > 0) {
          statements.push({
            kind: 'exprStmt',
            expr,
            span: expr.span,
          });
        } else if (this.peek().kind !== 'EOF' && this.peek().kind !== 'NEWLINE' && this.peek().kind !== 'SEMI') {
          // Consume stray token to prevent infinite loop
          const bad = this.advance();
          this.errors.push({
            message: `Unexpected token "${bad.value}"`,
            span: { start: bad.start, end: bad.end },
          });
        }
      }
      this.skipLineSeparators();
    }

    return { statements, errors: this.errors };
  }

  private parseSequence(stopKinds: Set<TokenKind>): SequenceNode {
    const items: ExprNode[] = [];
    const start = this.peek().start;

    while (!stopKinds.has(this.peek().kind) && this.peek().kind !== 'EOF') {
      if (this.peek().kind === 'NEWLINE') {
        // Inside () or [], newlines are whitespace; stopKinds handles top-level
        this.advance();
        continue;
      }
      const item = this.parseAtom();
      if (item) {
        items.push(item);
      } else {
        break;
      }
    }

    const end = items.length > 0 ? items[items.length - 1].span.end : start;
    return { kind: 'sequence', items, span: { start, end } };
  }

  /** Parse optional repeat count and/or prime suffix, e.g. `2`, `'`, `2'`, `'2`. */
  private parseModifierSuffix(baseEnd: number): {
    repeat: number;
    invert: boolean;
    end: number;
  } {
    let repeat = 1;
    let invert = false;
    let end = baseEnd;

    // Allow number and prime in either order (e.g. A2' or A'2), only if adjacent or immediate
    for (let k = 0; k < 2; k++) {
      const next = this.peek();
      if (next.kind === 'NUMBER' && next.start === end) {
        this.advance();
        repeat = Math.max(0, parseInt(next.value, 10));
        end = next.end;
      } else if (next.kind === 'PRIME' && next.start === end) {
        this.advance();
        invert = !invert;
        end = next.end;
      } else {
        break;
      }
    }

    return { repeat, invert, end };
  }

  private parseAtom(): ExprNode | null {
    const tok = this.peek();

    // Group: ( expr ) [count][']
    if (tok.kind === 'LPAREN') {
      this.advance();
      const body = this.parseSequence(new Set(['RPAREN', 'EOF']));
      let end = body.span.end;
      if (this.peek().kind === 'RPAREN') {
        end = this.advance().end;
      } else {
        this.errors.push({
          message: 'Unclosed "("',
          span: { start: tok.start, end },
        });
      }
      const mod = this.parseModifierSuffix(end);
      const node: GroupNode = {
        kind: 'group',
        body,
        repeat: mod.repeat,
        invert: mod.invert,
        span: { start: tok.start, end: mod.end },
      };
      return node;
    }

    // Commutator [A, B] or Conjugate [A: B]
    if (tok.kind === 'LBRACKET') {
      this.advance();
      const first = this.parseSequence(new Set(['COMMA', 'COLON', 'RBRACKET', 'EOF']));
      const sep = this.peek();
      if (sep.kind !== 'COMMA' && sep.kind !== 'COLON') {
        let end = first.span.end;
        if (this.peek().kind === 'RBRACKET') end = this.advance().end;
        this.errors.push({
          message: 'Expected "," (commutator) or ":" (conjugate) inside [...]',
          span: { start: tok.start, end },
        });
        return first;
      }
      this.advance(); // ',' or ':'
      this.skipNewlines();
      const second = this.parseSequence(new Set(['RBRACKET', 'EOF']));
      let end = second.span.end;
      if (this.peek().kind === 'RBRACKET') {
        end = this.advance().end;
      } else {
        this.errors.push({
          message: 'Unclosed "["',
          span: { start: tok.start, end },
        });
      }
      const mod = this.parseModifierSuffix(end);
      const span: Span = { start: tok.start, end: mod.end };
      if (sep.kind === 'COMMA') {
        return {
          kind: 'commutator',
          a: first,
          b: second,
          repeat: mod.repeat,
          invert: mod.invert,
          span,
        };
      } else {
        return {
          kind: 'conjugate',
          a: first,
          b: second,
          repeat: mod.repeat,
          invert: mod.invert,
          span,
        };
      }
    }

    // Identifier: whole-puzzle rotation 'r', circle move 'A'..'Z', or macro call
    if (tok.kind === 'IDENT') {
      this.advance();

      // Whole-puzzle rotation: r, r', r2, r2'
      if (tok.value === 'r') {
        const mod = this.parseModifierSuffix(tok.end);
        const node: RotationMoveNode = {
          kind: 'rotation',
          steps: mod.invert ? -mod.repeat : mod.repeat,
          span: { start: tok.start, end: mod.end },
        };
        return node;
      }

      // Single uppercase letter => circle move (or next-unblocked A> / A<)
      if (/^[A-Z]$/.test(tok.value)) {
        const next = this.peek();
        if ((next.kind === 'GT' || next.kind === 'LT') && next.start === tok.end) {
          this.advance();
          let count = 1;
          let end = next.end;
          let invert = false;
          const after = this.peek();
          if (after.kind === 'NUMBER' && after.start === end) {
            this.advance();
            count = Math.max(1, parseInt(after.value, 10));
            end = after.end;
          }
          if (this.peek().kind === 'PRIME' && this.peek().start === end) {
            this.advance();
            invert = true;
            end = this.peek(-1).end;
          }
          const dir: 1 | -1 = (next.kind === 'GT' ? 1 : -1) * (invert ? -1 : 1) as 1 | -1;
          const node: NextUnblockedMoveNode = {
            kind: 'nextUnblocked',
            circleId: tok.value,
            direction: dir,
            count,
            span: { start: tok.start, end },
          };
          return node;
        }

        const mod = this.parseModifierSuffix(tok.end);
        const node: CircleMoveNode = {
          kind: 'circleMove',
          circleId: tok.value,
          steps: mod.invert ? -mod.repeat : mod.repeat,
          span: { start: tok.start, end: mod.end },
        };
        return node;
      }

      // Macro invocation
      const mod = this.parseModifierSuffix(tok.end);
      const node: MacroCallNode = {
        kind: 'macroCall',
        name: tok.value,
        repeat: mod.repeat,
        invert: mod.invert,
        span: { start: tok.start, end: mod.end },
      };
      return node;
    }

    // Unexpected token inside expression
    this.errors.push({
      message: `Unexpected token "${tok.value}"`,
      span: { start: tok.start, end: tok.end },
    });
    this.advance();
    return null;
  }
}

export function parseAlgorithm(source: string, validCircleIds?: string[]): ProgramAST {
  const { tokens, errors } = tokenize(source);
  const parser = new Parser(source, tokens, errors, validCircleIds);
  return parser.parseProgram();
}

/**
 * Invert an AST expression algebraically:
 *   (A B)'     => B' A'
 *   (A)'       => A'
 *   [A, B]'    => [B, A]  (or B A B' A')
 *   [A: B]'    => [A: B']
 */
export function invertExpr(node: ExprNode): ExprNode {
  switch (node.kind) {
    case 'sequence':
      return {
        kind: 'sequence',
        items: [...node.items].reverse().map(invertExpr),
        span: node.span,
      };
    case 'circleMove':
      return { ...node, steps: -node.steps };
    case 'nextUnblocked':
      return { ...node, direction: (node.direction === 1 ? -1 : 1) };
    case 'rotation':
      return { ...node, steps: -node.steps };
    case 'macroCall':
      return { ...node, invert: !node.invert };
    case 'group':
      return { ...node, invert: !node.invert };
    case 'commutator':
      return { ...node, invert: !node.invert };
    case 'conjugate':
      return { ...node, invert: !node.invert };
  }
}
