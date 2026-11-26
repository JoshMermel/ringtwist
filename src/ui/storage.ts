import { MacroLibraryEntry } from '../lang/evaluator.ts';

const STORAGE_PREFIX = 'ringtwist:macros:v1:';
const LEGACY_STORAGE_PREFIX = 'circle-sim:macros:v1:';

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
      return parsed.filter(
        (m): m is MacroLibraryEntry =>
          typeof m?.name === 'string' && typeof m?.body === 'string',
      );
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
  macros?: MacroLibraryEntry[];
}

export function encodeShareHash(payload: SharedPayload): string {
  const params = new URLSearchParams();
  params.set('p', payload.puzzleId);
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
    const alg = algRaw ? fromBase64Url(algRaw) : '';
    let macros: MacroLibraryEntry[] | undefined;
    if (macrosRaw) {
      const parsed = JSON.parse(fromBase64Url(macrosRaw));
      if (Array.isArray(parsed)) {
        macros = parsed.filter(
          (m): m is MacroLibraryEntry =>
            typeof m?.name === 'string' && typeof m?.body === 'string',
        );
      }
    }
    return { puzzleId, alg, macros };
  } catch {
    return null;
  }
}
