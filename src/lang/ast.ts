export interface Span {
  start: number;
  end: number;
}

export type ExprNode =
  | SequenceNode
  | CircleMoveNode
  | NextUnblockedMoveNode
  | RotationMoveNode
  | MacroCallNode
  | GroupNode
  | CommutatorNode
  | ConjugateNode;

export interface SequenceNode {
  kind: 'sequence';
  items: ExprNode[];
  span: Span;
}

export interface CircleMoveNode {
  kind: 'circleMove';
  circleId: string;
  /** Signed stop steps (+ CW, - CCW). */
  steps: number;
  span: Span;
}

export interface NextUnblockedMoveNode {
  kind: 'nextUnblocked';
  circleId: string;
  direction: 1 | -1; // 1 for '>', -1 for '<'
  count: number;
  span: Span;
}

export interface RotationMoveNode {
  kind: 'rotation';
  /** Signed symmetry steps (+ CW, - CCW). */
  steps: number;
  span: Span;
}

export interface MacroCallNode {
  kind: 'macroCall';
  name: string;
  repeat: number;
  invert: boolean;
  span: Span;
}

export interface GroupNode {
  kind: 'group';
  body: ExprNode;
  repeat: number;
  invert: boolean;
  span: Span;
}

export interface CommutatorNode {
  kind: 'commutator';
  a: ExprNode;
  b: ExprNode;
  repeat: number;
  invert: boolean;
  span: Span;
}

export interface ConjugateNode {
  kind: 'conjugate';
  a: ExprNode;
  b: ExprNode;
  repeat: number;
  invert: boolean;
  span: Span;
}

export interface MacroDefStmt {
  kind: 'macroDef';
  name: string;
  body: ExprNode;
  bodySource: string;
  span: Span;
}

export interface ExprStmt {
  kind: 'exprStmt';
  expr: ExprNode;
  span: Span;
}

export type Statement = MacroDefStmt | ExprStmt;

export interface ParseError {
  message: string;
  span: Span;
}

export interface ProgramAST {
  statements: Statement[];
  errors: ParseError[];
}
