import { regionSignedArea } from '../geom/arcRegion.ts';
import { sliceCircles } from '../geom/slicer.ts';
import { detectMirrorAxes } from './engine.ts';
import { Piece, PuzzleSpec, PuzzleState } from './types.ts';

/**
 * Construct the initial (solved) PuzzleState from a PuzzleSpec.
 */
export function buildPuzzle(spec: PuzzleSpec): PuzzleState {
  const pieces: Piece[] = spec.customBuilder
    ? spec.customBuilder(spec)
    : sliceCircles(spec.circles).map((region, id) => {
        const color = spec.circles[0]?.color ?? '#38bdf8';
        return {
          id,
          region,
          color,
          homeColor: color,
          area: regionSignedArea(region.edges),
        };
      });

  const circleStopIndex: Record<string, number> = {};
  for (const c of spec.circles) {
    circleStopIndex[c.id] = 0;
  }

  return {
    spec,
    pieces,
    circleStopIndex,
    puzzleRotationDeg: 0,
    mirrorAxes: detectMirrorAxes(spec, pieces),
  };
}
