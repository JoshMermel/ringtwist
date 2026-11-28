import { MacroLibraryEntry } from '../lang/evaluator.ts';

const STORAGE_PREFIX = 'ringtwist:macros:v1:';
const LEGACY_STORAGE_PREFIX = 'circle-sim:macros:v1:';
const SESSION_PREFIX = 'ringtwist:session:v1:';
const LEGACY_EXPLORE_PREFIX = 'ringtwist:explore:v1:';
const LAST_PUZZLE_KEY = 'ringtwist:last-puzzle:v1';

/** Sanitize an optional list of congruent piece shape-type IDs for per-macro hover focus. */
export function sanitizeFocusTypes(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const norm = item.trim().toLowerCase();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out.length > 0 ? out : undefined;
}

export function sanitizeMacroEntries(raw: unknown): MacroLibraryEntry[] {
  if (!Array.isArray(raw)) return [];
  const byName = new Map<string, MacroLibraryEntry>();
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const rec = m as Record<string, unknown>;
    if (typeof rec.name !== 'string' || typeof rec.body !== 'string') continue;
    const name = rec.name.trim();
    const body = rec.body.replace(/[\r\n]+/g, ' ').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !body) continue;
    const focusTypes = sanitizeFocusTypes(rec.focusTypes);
    const note = typeof rec.note === 'string' && rec.note.trim() ? rec.note.trim() : undefined;
    const section =
      typeof rec.section === 'string' && rec.section.trim() ? rec.section.trim() : undefined;
    const sectionNote =
      typeof rec.sectionNote === 'string' && rec.sectionNote.trim()
        ? rec.sectionNote.trim()
        : undefined;
    const hidden = rec.hidden === true ? true : undefined;
    byName.set(name, {
      name,
      body,
      ...(note ? { note } : {}),
      ...(focusTypes ? { focusTypes } : {}),
      ...(hidden ? { hidden } : {}),
      ...(section ? { section } : {}),
      ...(sectionNote ? { sectionNote } : {}),
    });
  }
  return Array.from(byName.values());
}

export interface PuzzleSession {
  alg: string;
  scrambleSeed?: string;
  scrambleMoves?: number;
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

export function loadSession(puzzleId: string): PuzzleSession | null {
  try {
    const raw =
      localStorage.getItem(SESSION_PREFIX + puzzleId) ??
      localStorage.getItem(LEGACY_EXPLORE_PREFIX + puzzleId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.alg !== 'string') return null;
    const seed =
      typeof parsed.scrambleSeed === 'string' && parsed.scrambleSeed.trim().length > 0
        ? parsed.scrambleSeed.trim()
        : undefined;
    const moves =
      typeof parsed.scrambleMoves === 'number' && Number.isFinite(parsed.scrambleMoves)
        ? Math.max(1, Math.min(1000, Math.round(parsed.scrambleMoves)))
        : undefined;
    return {
      alg: parsed.alg,
      ...(seed ? { scrambleSeed: seed, scrambleMoves: moves ?? 20 } : {}),
    };
  } catch {
    return null;
  }
}

export function saveSession(puzzleId: string, session: PuzzleSession): void {
  try {
    localStorage.setItem(SESSION_PREFIX + puzzleId, JSON.stringify(session));
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
  scrambleSeed?: string;
  scrambleMoves?: number;
}

export function encodeShareHash(payload: SharedPayload): string {
  const params = new URLSearchParams();
  params.set('p', payload.puzzleId);
  if (payload.scrambleSeed && payload.scrambleSeed.trim().length > 0) {
    params.set('s', payload.scrambleSeed.trim());
    if (payload.scrambleMoves && Number.isFinite(payload.scrambleMoves)) {
      const clamped = Math.max(1, Math.min(1000, Math.round(payload.scrambleMoves)));
      params.set('n', String(clamped));
    }
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
    const seedRaw = params.get('s')?.trim();
    const movesRaw = params.get('n');

    let alg = '';
    let hasSharedAlg = false;
    if (algRaw !== null) {
      try {
        alg = algRaw ? fromBase64Url(algRaw) : '';
        hasSharedAlg = true;
      } catch {
        // Ignore corrupt `a=` parameter without discarding the rest of the shared link
      }
    }

    let macros: MacroLibraryEntry[] | undefined;
    if (macrosRaw) {
      try {
        const parsed = JSON.parse(fromBase64Url(macrosRaw));
        if (Array.isArray(parsed)) {
          macros = sanitizeMacroEntries(parsed);
        }
      } catch {
        // Ignore truncated or corrupt `m=` parameter without discarding `p`/`s`/`n`/`a`
      }
    }

    const parsedMoves = movesRaw ? parseInt(movesRaw, 10) : NaN;
    const scrambleMoves = Number.isFinite(parsedMoves)
      ? Math.max(1, Math.min(1000, Math.round(parsedMoves)))
      : undefined;
    return {
      puzzleId,
      alg,
      ...(hasSharedAlg ? { hasSharedAlg: true } : {}),
      macros,
      ...(seedRaw ? { scrambleSeed: seedRaw } : {}),
      ...(seedRaw && scrambleMoves !== undefined ? { scrambleMoves } : {}),
    };
  } catch {
    return null;
  }
}
