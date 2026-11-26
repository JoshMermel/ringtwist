export interface SolveMilestone {
  label: string;
  alg: string;
}

export interface ParsedSolveTranscript {
  milestones: SolveMilestone[];
  activeAlg: string;
}

/**
 * Serialize a Solve Mode milestone stack plus any uncommitted active scratchpad
 * into a single unambiguous, standard RingTwist comment-annotated transcript.
 *
 * Every `// @milestone` and `// @active` header is an ordinary line comment, so
 * the transcript can be pasted directly into Explorer Mode or shared via URL.
 */
export function serializeSolveTranscript(
  milestones: SolveMilestone[],
  activeAlg: string,
): string {
  const blocks: string[] = [];
  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    const lbl = m.label.trim() || `Milestone ${i + 1}`;
    const body = m.alg.trim();
    if (!body) continue;
    blocks.push(`// @milestone ${lbl}\n${body}`);
  }
  const activeTrim = activeAlg.trim();
  if (activeTrim.length > 0) {
    if (blocks.length > 0) {
      blocks.push(`// @active\n${activeTrim}`);
    } else {
      blocks.push(activeTrim);
    }
  }
  return blocks.join('\n\n');
}

/**
 * Hydrate a shared/imported Solve Mode transcript back into committed milestones
 * and active scratchpad moves.
 */
export function parseSolveTranscript(src: string): ParsedSolveTranscript {
  const trimmed = src.trim();
  if (!trimmed) return { milestones: [], activeAlg: '' };

  const lines = src.split(/\r?\n/);
  const hasMilestoneHeader = lines.some((l) => /^\s*(?:\/\/|#)\s*@milestone\b/i.test(l));
  if (!hasMilestoneHeader) {
    return { milestones: [], activeAlg: trimmed };
  }

  const milestones: SolveMilestone[] = [];
  let activeLines: string[] = [];
  let mode: 'preamble' | 'milestone' | 'active' = 'preamble';
  let currentLabel = '';
  let currentLines: string[] = [];

  const flushMilestone = () => {
    const body = currentLines.join('\n').trim();
    if (body.length > 0) {
      milestones.push({
        label: currentLabel || `Milestone ${milestones.length + 1}`,
        alg: body,
      });
    }
    currentLabel = '';
    currentLines = [];
  };

  for (const line of lines) {
    const mMatch = /^\s*(?:\/\/|#)\s*@milestone(?:\s+(.*?))?\s*$/i.exec(line);
    if (mMatch) {
      if (mode === 'milestone') flushMilestone();
      else if (mode === 'preamble' && currentLines.join('\n').trim()) {
        milestones.push({
          label: 'Milestone 1',
          alg: currentLines.join('\n').trim(),
        });
        currentLines = [];
      }
      mode = 'milestone';
      currentLabel = (mMatch[1] ?? '').trim();
      continue;
    }

    if (/^\s*(?:\/\/|#)\s*@active\b/i.test(line)) {
      if (mode === 'milestone') flushMilestone();
      mode = 'active';
      continue;
    }

    if (mode === 'active') {
      activeLines.push(line);
    } else {
      currentLines.push(line);
    }
  }

  if (mode === 'milestone') flushMilestone();
  else if (mode === 'preamble') activeLines = currentLines;

  return {
    milestones,
    activeAlg: activeLines.join('\n').trim(),
  };
}
