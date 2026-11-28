import { MacroLibraryEntry } from '../lang/evaluator.ts';
import { RingTwistPuzzleDoc, validateRingTwistDoc } from '../puzzle/format.ts';
import { SolveMilestone } from '../puzzle/solveStack.ts';

const STORAGE_PREFIX = 'ringtwist:macros:v1:';
const LEGACY_STORAGE_PREFIX = 'circle-sim:macros:v1:';
const CUSTOM_PUZZLES_KEY = 'ringtwist:custom-puzzles:v1';
const EXPLORE_SESSION_PREFIX = 'ringtwist:explore:v1:';
const SOLVE_SESSION_PREFIX = 'ringtwist:solve:v1:';
const UI_MODE_KEY = 'ringtwist:ui-mode:v1';
const LAST_PUZZLE_KEY = 'ringtwist:last-puzzle:v1';
const MACRO_HOVER_ENABLED_KEY = 'ringtwist:macro-hover:v1';

export type UiMode = 'explorer' | 'solve';

/** Sanitize an optional list of congruent piece shape-type IDs for per-macro hover focus. */
export function sanitizeFocusTypes(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.length > 0 ? out : undefined;
}

export function sanitizeMacroEntries(raw: unknown): MacroLibraryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: MacroLibraryEntry[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const rec = m as Record<string, unknown>;
    if (typeof rec.name !== 'string' || typeof rec.body !== 'string') continue;
    const focusTypes = sanitizeFocusTypes(rec.focusTypes);
    const note = typeof rec.note === 'string' && rec.note.trim() ? rec.note.trim() : undefined;
    const section =
      typeof rec.section === 'string' && rec.section.trim() ? rec.section.trim() : undefined;
    const sectionNote =
      typeof rec.sectionNote === 'string' && rec.sectionNote.trim()
        ? rec.sectionNote.trim()
        : undefined;
    const hidden = rec.hidden === true ? true : undefined;
    out.push({
      name: rec.name,
      body: rec.body,
      ...(note ? { note } : {}),
      ...(focusTypes ? { focusTypes } : {}),
      ...(hidden ? { hidden } : {}),
      ...(section ? { section } : {}),
      ...(sectionNote ? { sectionNote } : {}),
    });
  }
  return out;
}

export interface ExploreSession {
  alg: string;
}

export interface SolveSession {
  seed: string;
  scrambleMoves: number;
  milestones: SolveMilestone[];
  activeAlg: string;
  elapsedMs: number;
  solved: boolean;
}

const DEFAULT_MACROS: Record<string, MacroLibraryEntry[]> = {
  'geranium-plus': [
    { name: 'conj', body: '[A: D3]', note: '36° setup + 108° exchange on D' },
    { name: 'stepD', body: 'A> D3', note: 'Snap A to 36° (unblocks D) then turn D 108°' },
  ],
  geranium: [
    { name: 'pair', body: 'A2 E2', note: '108° exchange across A and E' },
  ],
  'two-circle': [
    { name: 'comm', body: '[A, B]', note: '120° commutator across the unbandaged Mandorla lens' },
  ],
};

export function loadMacros(puzzleId: string): MacroLibraryEntry[] {
  try {
    const raw =
      localStorage.getItem(STORAGE_PREFIX + puzzleId) ??
      localStorage.getItem(LEGACY_STORAGE_PREFIX + puzzleId);
    if (!raw) return [...(DEFAULT_MACROS[puzzleId] ?? [])];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return sanitizeMacroEntries(parsed);
    }
  } catch {
    // Ignore storage errors (private browsing, quota, etc.)
  }
  return [...(DEFAULT_MACROS[puzzleId] ?? [])];
}

export function saveMacros(puzzleId: string, macros: MacroLibraryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + puzzleId, JSON.stringify(macros));
  } catch {
    // Ignore storage errors
  }
}

export function loadCustomPuzzles(): RingTwistPuzzleDoc[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PUZZLES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: RingTwistPuzzleDoc[] = [];
    for (const item of parsed) {
      const check = validateRingTwistDoc(item);
      if (check.ok) valid.push(check.doc);
    }
    return valid;
  } catch {
    return [];
  }
}

export function saveCustomPuzzles(docs: RingTwistPuzzleDoc[]): void {
  try {
    localStorage.setItem(CUSTOM_PUZZLES_KEY, JSON.stringify(docs));
  } catch {
    // Ignore storage errors
  }
}

export function loadUiMode(): UiMode {
  try {
    const raw = localStorage.getItem(UI_MODE_KEY);
    if (raw === 'solve' || raw === 'explorer') return raw;
  } catch {
    // Ignore storage errors
  }
  return 'explorer';
}

export function saveUiMode(mode: UiMode): void {
  try {
    localStorage.setItem(UI_MODE_KEY, mode);
  } catch {
    // Ignore storage errors
  }
}

export function loadLastPuzzleId(): string | null {
  try {
    const raw = localStorage.getItem(LAST_PUZZLE_KEY);
    return raw && raw.trim().length > 0 ? raw.trim() : null;
  } catch {
    return null;
  }
}

export function saveLastPuzzleId(puzzleId: string): void {
  try {
    localStorage.setItem(LAST_PUZZLE_KEY, puzzleId);
  } catch {
    // Ignore storage errors
  }
}

export function loadMacroHoverEnabled(): boolean {
  try {
    const raw = localStorage.getItem(MACRO_HOVER_ENABLED_KEY);
    if (raw === '0' || raw === 'false') return false;
  } catch {
    // Ignore storage errors
  }
  return true;
}

export function saveMacroHoverEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(MACRO_HOVER_ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage errors
  }
}

export function loadExploreSession(puzzleId: string): ExploreSession | null {
  try {
    const raw = localStorage.getItem(EXPLORE_SESSION_PREFIX + puzzleId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.alg !== 'string') return null;
    return { alg: parsed.alg };
  } catch {
    return null;
  }
}

export function saveExploreSession(puzzleId: string, session: ExploreSession): void {
  try {
    localStorage.setItem(EXPLORE_SESSION_PREFIX + puzzleId, JSON.stringify(session));
  } catch {
    // Ignore storage errors
  }
}

export function loadSolveSession(puzzleId: string): SolveSession | null {
  try {
    const raw = localStorage.getItem(SOLVE_SESSION_PREFIX + puzzleId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.seed !== 'string') return null;
    const milestones: SolveMilestone[] = Array.isArray(parsed.milestones)
      ? parsed.milestones
          .filter(
            (m: unknown): m is SolveMilestone =>
              !!m &&
              typeof m === 'object' &&
              typeof (m as SolveMilestone).label === 'string' &&
              typeof (m as SolveMilestone).alg === 'string',
          )
          .map((m: SolveMilestone) => ({ label: m.label, alg: m.alg }))
      : [];
    return {
      seed: parsed.seed,
      scrambleMoves:
        typeof parsed.scrambleMoves === 'number' && Number.isFinite(parsed.scrambleMoves)
          ? Math.max(1, Math.min(1000, Math.round(parsed.scrambleMoves)))
          : 20,
      milestones,
      activeAlg: typeof parsed.activeAlg === 'string' ? parsed.activeAlg : '',
      elapsedMs:
        typeof parsed.elapsedMs === 'number' && Number.isFinite(parsed.elapsedMs)
          ? Math.max(0, parsed.elapsedMs)
          : 0,
      solved: Boolean(parsed.solved),
    };
  } catch {
    return null;
  }
}

export function saveSolveSession(puzzleId: string, session: SolveSession): void {
  try {
    localStorage.setItem(SOLVE_SESSION_PREFIX + puzzleId, JSON.stringify(session));
  } catch {
    // Ignore storage errors
  }
}

/** UTF-8 safe base64url encode (zero external dependencies). */
function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const pad = encoded.length % 4 === 0 ? '' : '='.repeat(4 - (encoded.length % 4));
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export interface SharedPayload {
  puzzleId: string;
  alg: string;
  /** True only when the URL explicitly carried an `a=` algorithm parameter. */
  hasSharedAlg?: boolean;
  macros?: MacroLibraryEntry[];
  customDoc?: RingTwistPuzzleDoc;
  scrambleSeed?: string;
  scrambleMoves?: number;
}

export function encodeShareHash(payload: SharedPayload): string {
  const params = new URLSearchParams();
  params.set('p', payload.puzzleId);
  if (payload.scrambleSeed && payload.scrambleSeed.trim().length > 0) {
    params.set('s', payload.scrambleSeed.trim());
    if (payload.scrambleMoves && Number.isFinite(payload.scrambleMoves)) {
      params.set('n', String(Math.round(payload.scrambleMoves)));
    }
  }
  if (payload.customDoc) {
    params.set('d', toBase64Url(JSON.stringify(payload.customDoc)));
  }
  if (payload.alg.trim().length > 0) {
    params.set('a', toBase64Url(payload.alg));
  }
  if (payload.macros && payload.macros.length > 0) {
    params.set('m', toBase64Url(JSON.stringify(payload.macros)));
  }
  return '#' + params.toString();
}

export function decodeShareHash(hash: string): SharedPayload | null {
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!clean) return null;
  try {
    const params = new URLSearchParams(clean);
    const puzzleId = params.get('p');
    if (!puzzleId) return null;
    const algRaw = params.get('a');
    const macrosRaw = params.get('m');
    const docRaw = params.get('d');
    const seedRaw = params.get('s')?.trim();
    const movesRaw = params.get('n');
    const alg = algRaw ? fromBase64Url(algRaw) : '';
    let macros: MacroLibraryEntry[] | undefined;
    if (macrosRaw) {
      const parsed = JSON.parse(fromBase64Url(macrosRaw));
      if (Array.isArray(parsed)) {
        macros = sanitizeMacroEntries(parsed);
      }
    }
    let customDoc: RingTwistPuzzleDoc | undefined;
    if (docRaw) {
      const parsedDoc = JSON.parse(fromBase64Url(docRaw));
      const check = validateRingTwistDoc(parsedDoc);
      if (check.ok) customDoc = check.doc;
    }
    const parsedMoves = movesRaw ? parseInt(movesRaw, 10) : NaN;
    const scrambleMoves =
      Number.isFinite(parsedMoves) && parsedMoves >= 1 && parsedMoves <= 1000
        ? parsedMoves
        : undefined;
    return {
      puzzleId,
      alg,
      ...(algRaw !== null ? { hasSharedAlg: true } : {}),
      macros,
      customDoc,
      ...(seedRaw ? { scrambleSeed: seedRaw } : {}),
      ...(seedRaw && scrambleMoves !== undefined ? { scrambleMoves } : {}),
    };
  } catch {
    return null;
  }
}
