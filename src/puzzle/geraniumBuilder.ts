import {
  ArcRegion,
  classifyRegionAgainstCircle,
  regionSignedArea,
  rotateRegion,
} from '../geom/arcRegion.ts';
import { Circle, deg2rad } from '../geom/math.ts';
import { splitRegionByCircle } from '../geom/slicer.ts';
import {
  attachCenterPentagonStickers,
  buildFromGeraniumsPotScript,
} from './geraniumsPotScript.ts';
import { Piece, PuzzleSpec } from './types.ts';

/**
 * Exact VeryPuzzle Geranium / Geranium Plus circle radius ratio: 70 / 50 = 1.4
 * (with circle centers on the unit pentagon, radius 1.0).
 */
export const EXACT_GERANIUM_RADIUS = 1.4;

/** Golden ratio φ = (1 + √5) / 2, used for Super, Pocket, and Mini Geranium centers. */
export const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * Classic VeryPuzzle Geranium Plus 5-arm color palette (clockwise from top A..E):
 *   A (top):        Yellow (#facc15)
 *   B (upper-right): Light Blue (#38bdf8)
 *   C (lower-right): Purple (#9333ea)
 *   D (lower-left):  Red (#ef4444)
 *   E (upper-left):  Green (#16a34a)
 */
export const GERANIUM_PLUS_COLORS = ['#facc15', '#38bdf8', '#9333ea', '#ef4444', '#16a34a'];

/**
 * Standard Geranium 5-arm color palette (clockwise from top A..E):
 *   A (top):        Green (#16a34a)
 *   B (upper-right): Yellow (#facc15)
 *   C (lower-right): Light Blue (#38bdf8)
 *   D (lower-left):  Purple (#9333ea)
 *   E (upper-left):  Red (#ef4444)
 */
export const GERANIUM_STD_COLORS = ['#16a34a', '#facc15', '#38bdf8', '#9333ea', '#ef4444'];

const GERANIUM_STANDARD_SCRIPT = `
Param: pos_ring1, 50*sin(3*pi/10)
Param: pos_ring2, 50*cos(3*pi/10)
Param: pos_ring3, 50*sin(pi/10)
Param: pos_ring4, 50*cos(pi/10)
Param: radius, 70

Ring: 1, -pos_ring2, -pos_ring1, radius, (36,72,36,72,36,72,36)
Ring: 2,  pos_ring2, -pos_ring1, radius, (36,72,36,72,36,72,36)
Ring: 3, -pos_ring4,  pos_ring3, radius, (36,72,36,72,36,72,36)
Ring: 4,  pos_ring4,  pos_ring3, radius, (36,72,36,72,36,72,36)
Ring: 5,  0, 50, radius, (36,72,36,72,36,72,36)

AutoCutParts:
AutoCutParts: (1R2,5),(1L5,5),1R3, (2R2,3),(2L5,3),2R3, (4R2,1),(4L5,1),4R3, (5R2,2),(5L5,2),5R3, (3R2,4),(3L5,4),3R3

HideParts: 15,28
InvertAllParts
AutoCutParts: (1R,2),(1L2,3),1R
ShowAllParts
HideParts: 16,29
InvertAllParts
AutoCutParts: (2R,4),(2L2,1),2R
ShowAllParts
HideParts: 10
InvertAllParts
AutoCutParts: (3R,1),3L
ShowAllParts

RemoveParts: 1,2,4,5,6,8,20,21,27,28,35,36,40,41,39
CopyParts: (14,22,24,29,31,33),1R3, (16,18,14,23,22,24),1L3, (23,22,15,24,19,17),2R3, (23,30,32),2L3
CopyParts: (7,11,14,15,22,29),3L3, (29,30,32),3R3, (23,22,15,24,19,17),5L3, (16,18,23),5R3, (7,11,14),4R3, (29,31,33),4L3

AutoColorParts: 7, 10, 3, 6, 4
SetColorParts: (29,30,32,25,50,49,48),3, (23,18,16,9,62,64,65),4, (14,11,7,10,71,70,69),6
SetColorParts: (15,19,17,26,51,52,54),10, (24,31,33,34,40,42,39),7
`;

const SUPER_GERANIUM_SCRIPT = `
Param: pos_ring1, 50*sin(3*pi/10)
Param: pos_ring2, 50*cos(3*pi/10)
Param: pos_ring3, 50*sin(pi/10)
Param: pos_ring4, 50*cos(pi/10)
Param: radius, 70

Ring: 1, -pos_ring2, -pos_ring1, radius, (36,72,36,72,36,72,36)
Ring: 2,  pos_ring2, -pos_ring1, radius, (36,72,36,72,36,72,36)
Ring: 3, -pos_ring4,  pos_ring3, radius, (36,72,36,72,36,72,36)
Ring: 4,  pos_ring4,  pos_ring3, radius, (36,72,36,72,36,72,36)
Ring: 5,  0, 50, radius, (36,72,36,72,36,72,36)

AutoCutParts:
AutoCutParts: (1R2,5),(1L5,5),1R3, (2R2,3),(2L5,3),2R3, (4R2,1),(4L5,1),4R3, (5R2,2),(5L5,2),5R3, (3R2,4),(3L5,4),3R3

HideParts: 15,28
InvertAllParts
AutoCutParts: (1R,2),(1L2,3),1R
ShowAllParts
HideParts: 16,29
InvertAllParts
AutoCutParts: (2R,4),(2L2,1),2R
ShowAllParts
HideParts: 10
InvertAllParts
AutoCutParts: (3R,1),3L
ShowAllParts

RemoveParts: 1,2,4,5,6,8,20,21,27,28,35,36,40,41,39
CopyParts: (14,22,24,29,31,33),1R3, (16,18,14,23,22,24),1L3, (23,22,15,24,19,17),2R3, (23,30,32),2L3
CopyParts: (7,11,14,15,22,29),3L3, (29,30,32),3R3, (23,22,15,24,19,17),5L3, (16,18,23),5R3, (7,11,14),4R3, (29,31,33),4L3

CopyRing: 6, 1, (5,108), radius, (36,72,36,72,36,72,36)
CopyRing: 7, 3, (4,108), radius, (36,72,36,72,36,72,36)
CopyRing: 8, 5, (2,108), radius, (36,72,36,72,36,72,36)
CopyRing: 9, 4, (1,108), radius, (36,72,36,72,36,72,36)
CopyRing:10, 2, (3,108), radius, (36,72,36,72,36,72,36)

CopyParts: (30,32,25,37,34,47,46,45,44,43,41,50,49,48,42,40,39),(5,108)
CopyParts: (16,18,25,12,9,48,49,66,50,67,68,60,61,63,62,64,65),(4,108)
CopyParts: (7,11,9,3,10,62,64,77,65,76,75,74,73,71,72,70,69),(2,108)
CopyParts: (19,17,10,13,26,71,70,80,69,79,78,83,82,51,81,52,54),(1,108)
CopyParts: (31,33,34,26,38,51,52,54,53,55,56,42,40,93,57,39,58,59),(3,108)

AutoColorParts: 7,10,3,6,4, 4,6,10,7,3
SetColorParts: (29,30,32,25,50,49,48,60,61,63),3, (23,18,16,9,62,64,65,77,76,75,74,73,72),4, (14,83,82,81),6
SetColorParts: (15,19,17,26,51,52,54,53,55,56,57,58,59),10, (24,31,33,34,40,42,39,44,43,41,45,46,47),7

RotateAllParts: 36
`;

const SUPER_GERANIUM_PLUS_SCRIPT = `
Param: pos_ring1, 50*sin(3*pi/10)
Param: pos_ring2, 50*cos(3*pi/10)
Param: pos_ring3, 50*sin(pi/10)
Param: pos_ring4, 50*cos(pi/10)
Param: radius, 70

Ring: 1, -pos_ring2, -pos_ring1, radius, 36
Ring: 2,  pos_ring2, -pos_ring1, radius, 36
Ring: 3, -pos_ring4,  pos_ring3, radius, 36
Ring: 4,  pos_ring4,  pos_ring3, radius, 36
Ring: 5,  0, 50, radius, 36

AutoCutParts:
AutoCutParts: (1R3,5),(1L7,5),1R4, (2R3,3),(2L7,3),2R4, (4R3,1),(4L7,1),4R4, (5R3,2),(5L7,2),5R4, (3R3,4),(3L7,4),3R4

HideParts: 15,28
InvertAllParts
AutoCutParts: (1R,2),(1L2,3),1R
ShowAllParts
HideParts: 16,29
InvertAllParts
AutoCutParts: (2R,4),(2L2,1),2R
ShowAllParts
HideParts: 10
InvertAllParts
AutoCutParts: (3R,1),3L
ShowAllParts

RemoveParts: 1,2,4,5,6,8,20,21,27,28,35,36,40,41,39
CopyParts: (14,22,24,29,31,33),1R3, (16,18,14,23,22,24),1L3, (23,22,15,24,19,17),2R3, (23,30,32),2L3
CopyParts: (7,11,14,15,22,29),3L3, (29,30,32),3R3, (23,22,15,24,19,17),5L3, (16,18,23),5R3, (7,11,14),4R3, (29,31,33),4L3

HideParts: 9,34
InvertAllParts
AutoCutParts: (3R4,5),3L4, (5R3,4),5L3
AutoCutParts: (1R3,3),1L3, (2L3,4),2R3
ShowAllParts
HideParts: 43,22
InvertAllParts
AutoCutParts: (3L4,1),3R4, (1L3,2),1R3
AutoCutParts: (4L4,5),4R4, (5L3,3),5R3
ShowAllParts
HideParts: 47
InvertAllParts
AutoCutParts: (2L4,4),2R4, (4L3,5),4R3
ShowAllParts

RemoveParts: 5,28,29,71,72
CopyParts: (23,26),(5,108), (24,15),(4,108), (47,56),(3,108), (48,41),(2,108), (66,64),(1,108)

Renumbering

CopyRing: 6, 1, (5,108), radius, (36,72,36,72,36,72,36)
CopyRing: 7, 3, (4,108), radius, (36,72,36,72,36,72,36)
CopyRing: 8, 5, (2,108), radius, (36,72,36,72,36,72,36)
CopyRing: 9, 4, (1,108), radius, (36,72,36,72,36,72,36)
CopyRing:10, 2, (3,108), radius, (36,72,36,72,36,72,36)

CopyParts: (57,63,43,50,59,79,72,68,67,69, 45,54,61,62,70,77,83,81,74,85,76,75),(5,108)
CopyParts: (37,39,59,50,43,27,31,28,24,15, 62,54,45,52,41,33,20,18,9,13,22,10),(4,108)
CopyParts: (17,26,28,24,15,8,3,16,25,29, 22,13,6,10,4,1,2,5,11,7,14,23),(2,108)
CopyParts: (40,38,16,25,29,32,30,44,51,60, 11,14,12,23,19,21,36,42,53,46,55,65),(1,108)
CopyParts: (58,64,68,67,69,73,80,44,51,60, 46,55,65,66,71,78,84,82,86,75,76,74),(3,108)

AutoColorParts: 3,7,4,10,6, 6,10,7,3,4
SetColorParts: (49,58,64,68,67,69,74,76,75,61,70,77),3, (35,40,38,44,51,46,55,60,65,66,71,78,84,82,86),7, (48,2,5,7),6
SetColorParts: (43,45,50,54,62,59,63,57,56,52,41,33,20,18,9),4, (34,26,17,16,25,11,14,23,29,12,19,21,36,42,53),10

RotateAllParts: 36
`;

const POCKET_GERANIUM_SCRIPT = `
Param: golden, (1+sqrt(5))/2
Param: pos_ring1, 118-68*golden
Param: pos_ring2, 50+68*golden

Ring: 1,  50, 50, 50, (108,108,108,36)
Ring: 2, 118, 50, 50, (108,36,108,108)
Ring: 3, pos_ring2, 50, 50, (108,252)

AutoCutParts: 1R2,2L
Ring: 4, pos_ring1, 50, 50, 0, 1

AutoCutParts: 2R,(2R,1),(2R,1),2R

HideParts: 7,15
AutoCutParts: (1R,2),(1R,2)
ShowAllParts
AutoCutParts: 1R,1R
RemoveParts: 28,30,29,31,13
CopyParts: (1,5,7,14,16),1L, (2,6,10,15,19),2R, (5,7),1R
AutoCutParts: (1R2,2)
RemoveParts: 12,18,19,25,34
CopyParts: (22,24,28,32,37),1L4
AutoCutParts: (2R,1), (3R,2)

RemoveParts: 28
CopyParts: (22,30,27,35),2L
AutoCutParts: (3L,2), (2L,1)
CopyParts: (10,18),(3,-108)
AutoCutParts: (2R,1)

RemoveParts: 8
CopyParts: (44,41),(3,-108), (22,33),(3,108)

HideParts: 30
InvertAllParts
CopyParts: (30),(3,-108)
CutCircles: 2
RemoveParts: 18
ShowAllParts

HideParts: 6,17,46,27,5,28,45,16,9,26,44,25
InvertAllParts
MoveParts: (6),(3,-36), (46),(3,36)
CutCircles: 2
MoveParts: (7),(3,36), (43),(3,-36)
CopyParts: (2),(3,36), (48),(3,-36)
RemoveParts: 17,26
CopyParts: (7,49),(3,-108), (43,50),(3,-108)

MoveParts: (5),(2,36), (45),(2,-36)
CutCircles: 3
MoveParts: (8),(2,-36), (46),(2,36)
CopyParts: (1),(2,-36), (51),(2,36)
RemoveParts: 11,28,18,47,29
CopyParts: (46,54),(2,108), (46,54),(2,108,1,-108), (8,53),(2,108), (8,53),(2,-108,1,36), (8,53),(2,-108,1,144)

AutoCutParts: (1L2,2)
MoveParts: (26),(4,72)
CutCircles: 1
MoveParts: (50,57),(4,-72)
AutoCutParts: (1R2,2)
ShowAllParts

AutoColorParts: 4, 5, 3, 5,0,6
`;

const MINI_GERANIUM_BASE = `
Param: golden, (1+sqrt(5))/2
Param: pos_ring1, 118-68*golden
Param: pos_ring2, 50+68*golden

Ring: 1,  50, 50, 50, (108,36,108,108)
Ring: 2, 118, 50, 50, (108,108,36,108)
Ring: 3, pos_ring1, 50, 50, 0, 1
Ring: 4, pos_ring2, 50, 50, 0, 1

AutoCutParts: 2R,(2R,1),(2R,1),2R
HideParts: 7,14
AutoCutParts: (1R,2),(1R,2)
ShowAllParts
AutoCutParts: 1R,1R
RemoveParts: 27,29,28,30,13
CopyParts: (1,5,7,14,16),1L, (2,6,10,15,19),2R, (5,7),1R

HideParts: 16
RemoveParts: 31
InvertAllParts
MoveParts: (16),(1,-72)
CutCircles: 3
MoveParts: (33),(1,-36)
CopyParts: (35),(1,-36)
CopyParts: (33,37),(1,108)
ShowAllParts

HideParts: 17
InvertAllParts
MoveParts: (17),(3,72)
CutCircles: 1
MoveParts: (34,38),(3,-72)
ShowAllParts

RemoveParts: 19,36
CopyParts: (35,37),(1,-108)
MoveParts: (41,42),(2,144)
CopyParts: (41,42),(2,108)

HideParts: 3
InvertAllParts
MoveParts: (3),(1,-36)
CutCircles: 3
MoveParts: (4),(1,36)
CopyParts: (1),(1,36)

RemoveParts: 3,28
CopyParts: (4,43),(1,108)
CopyParts: (44,45),(2,108)

HideParts: 20
InvertAllParts
MoveParts: (20),(4,-72)
CutCircles: 2
MoveParts: (39,46),(4,72)
ShowAllParts
`;

const MINI_GERANIUM_SCRIPT = `
${MINI_GERANIUM_BASE}
AutoColorParts: 3, 3, 14
SetColorParts: (14,15,27,28,34,35),6,   (30,31,36,44,40,42,43,41,32,45,37,33),14
`;

const MINI_GERANIUM_PLUS_SCRIPT = `
${MINI_GERANIUM_BASE}
HideParts: 28
InvertAllParts
MoveParts: (28),(2,-144)
CutCircles: 4
MoveParts: (10,17),(2,144)
ShowAllParts
RemoveParts: 16,38
CopyParts: (17),(2,108)

HideParts: 10
InvertAllParts
MoveParts: (10),(4,144)
CutCircles: 2
MoveParts: (16,14),(4,-144)
ShowAllParts
CopyParts: (16,14),(2,108)
CopyParts: (16,14),(2,216)

HideParts: 31
InvertAllParts
MoveParts: (31),(1,144)
CutCircles: 3
MoveParts: (11,18),(1,-144)
ShowAllParts
RemoveParts: 17,42
CopyParts: (18),(1,-108)

HideParts: 11
InvertAllParts
MoveParts: (11),(3,-144)
CutCircles: 1
MoveParts: (15,17),(3,144)
ShowAllParts
CopyParts: (15,17),(1,-108)
CopyParts: (15,17),(1,-216)

Renumbering

AutoColorParts: 3, 3, 14
SetColorParts: (7,16,25,35,33,36,40,49),6, (8,17,26,41,50,37,34,38),6, (42,43,46,55,51,53),14, (54,52,56,44,47,45),14
`;

const TWIN_RINGS_SCRIPT = `
Ring: 1, 50, 50, 50, 90
Ring: 2, 108, 50, 50, 90
AutoCutParts: (1R,2R),7
Ring: 3, 50, 50, 34, 0,1
Ring: 4, 108, 50, 34, 0,1
CutCircles: 3,4
AutoColorParts: 6, 5, 5
SetColorParts: (14,17,23,24,32,37,10,39,26,15,20,28,29,38,35,42,13),0, (41,45,34,27,19,12),6
`;

const MANDORLA_SCRIPT = `
Ring: 1, 50, 50, 50, 120
Ring: 2, 100.1, 50, 50, 120
AutoCutParts: Random,30
AutoColorParts: 10, 4, 6
`;

const FOUR_CIRCLE_CLOVER_SCRIPT = `
Param: s, 38
Ring: 1,  s,  s, 50, 90
Ring: 2,  s, -s, 50, 90
Ring: 3, -s, -s, 50, 90
Ring: 4, -s,  s, 50, 90
AutoCutParts: (1R,2R,3R,4R),4
AutoColorParts: 3, 6, 4, 5
`;

const SIX_CIRCLE_HEX_SCRIPT = `
Param: h, 50*sqrt(3)/2
Ring: 1,  0,  50, 50, 60
Ring: 2,  h,  25, 50, 60
Ring: 3,  h, -25, 50, 60
Ring: 4,  0, -50, 50, 60
Ring: 5, -h, -25, 50, 60
Ring: 6, -h,  25, 50, 60
AutoCutParts: (1R,2R,3R,4R,5R,6R),6
AutoColorParts: 3, 9, 6, 4, 5, 7
`;

function cutRotated(
  reg: ArcRegion,
  home: Circle,
  cwDeg: number,
  cutter: Circle,
): ArcRegion[] {
  const rad = deg2rad(-cwDeg);
  const moved = rotateRegion(reg, home.cx, home.cy, rad);
  return splitRegionByCircle(moved, cutter).map((p) =>
    rotateRegion(p, home.cx, home.cy, -rad),
  );
}

/**
 * Build the 100%-exact physical VeryPuzzle Geranium (71 pieces) or Geranium Plus (86 pieces).
 */
export function buildExactGeraniumPieces(
  spec: PuzzleSpec,
  variant: 'plus' | 'standard',
): Piece[] {
  const stdPieces = buildFromGeraniumsPotScript(GERANIUM_STANDARD_SCRIPT, spec, {
    coordScale: 1 / 50,
    orientCenterPentagon: false,
  });

  if (variant === 'standard') {
    attachCenterPentagonStickers(stdPieces, spec);
    return stdPieces;
  }

  const colorRemap = new Map<string, string>();
  for (let i = 0; i < 5; i++) {
    colorRemap.set(GERANIUM_STD_COLORS[i], GERANIUM_PLUS_COLORS[i]);
  }
  const remap = (c: string) => colorRemap.get(c) ?? c;

  const circles = spec.circles;
  const plusList: { region: ArcRegion; color: string }[] = [];
  const splitShieldsByRing = new Map<number, ArcRegion[]>();

  for (const p of stdPieces) {
    const color = remap(p.color);
    const memberCount = circles.filter(
      (c) => classifyRegionAgainstCircle(p.region, c) === 'inside',
    ).length;

    // 1. Split each of the 5 large 2-circle overlap shields (area ≈ 0.5080) into 3 pieces
    if (memberCount === 2 && Math.abs(p.area - 0.508) < 0.005) {
      let matchedK = -1;
      for (let k = 0; k < 5; k++) {
        const cur = circles[k];
        const prev = circles[(k + 4) % 5];
        if (
          classifyRegionAgainstCircle(p.region, cur) === 'inside' &&
          classifyRegionAgainstCircle(p.region, prev) === 'inside'
        ) {
          matchedK = k;
          break;
        }
      }
      const cur = circles[matchedK];
      const prev = circles[(matchedK + 4) % 5];
      const next = circles[(matchedK + 1) % 5];

      let subs = cutRotated(p.region, prev, 144, cur);
      subs = subs.flatMap((s) => cutRotated(s, cur, 108, next));
      splitShieldsByRing.set(matchedK, subs);
      for (const s of subs) {
        plusList.push({ region: s, color });
      }
    } else if (memberCount === 1 && Math.abs(p.area - 0.3429) < 0.001) {
      continue;
    } else {
      plusList.push({ region: p.region, color });
    }
  }

  // 2. Replace each removed 0.3429 outer T-channel in circle k with its exact 2 unbandaged pieces
  for (let k = 0; k < 5; k++) {
    const cur = circles[k];
    const subs = splitShieldsByRing.get(k) ?? [];
    for (const s of subs) {
      const rot = rotateRegion(s, cur.cx, cur.cy, deg2rad(-108));
      const onlyInCur = circles.every((c, idx) =>
        idx === k
          ? classifyRegionAgainstCircle(rot, c) === 'inside'
          : classifyRegionAgainstCircle(rot, c) === 'outside',
      );
      if (onlyInCur) {
        plusList.push({ region: rot, color: cur.color });
      }
    }
  }

  const pieces: Piece[] = plusList.map((item, idx) => ({
    id: idx,
    region: item.region,
    color: item.color,
    homeColor: item.color,
    area: regionSignedArea(item.region.edges),
  }));

  attachCenterPentagonStickers(pieces, spec);
  return pieces;
}

/**
 * Build exact 10-circle Super Geranium (156 pieces) or Super Geranium Plus (196 pieces)
 * with 5-color oriented central pentagon and exact 5-arm coloring.
 */
export function buildExactSuperGeraniumPieces(
  spec: PuzzleSpec,
  variant: 'plus' | 'standard',
): Piece[] {
  const script = variant === 'plus' ? SUPER_GERANIUM_PLUS_SCRIPT : SUPER_GERANIUM_SCRIPT;
  const pieces = buildFromGeraniumsPotScript(script, spec, {
    coordScale: 1 / 50,
    orientCenterPentagon: false,
  });

  // In Super Geranium / Plus, the 5th arm's inner overlap pieces left uncolored by
  // AutoColorParts (non-center #f8fafc) belong to the yellow arm (#facc15).
  const innerCircles = spec.circles.slice(0, 5);
  for (const p of pieces) {
    if (p.color === '#f8fafc') {
      const isCenter = innerCircles.every(
        (c) => classifyRegionAgainstCircle(p.region, c) === 'inside',
      );
      if (!isCenter) {
        p.color = '#facc15';
        p.homeColor = '#facc15';
      }
    }
  }

  attachCenterPentagonStickers(pieces, spec);
  return pieces;
}

/**
 * Build exact 3-circle-in-a-line Pocket Geranium (60 pieces).
 */
export function buildExactPocketGeraniumPieces(spec: PuzzleSpec): Piece[] {
  const pocketCx = (50 + (50 + 68 * PHI)) / 2;
  return buildFromGeraniumsPotScript(POCKET_GERANIUM_SCRIPT, spec, {
    coordScale: 1 / 50,
    originOffset: { x: pocketCx, y: 50 },
  });
}

/**
 * Build exact 2-circle Mini Geranium (46 pieces) or Mini Geranium Plus (56 pieces).
 */
export function buildExactMiniGeraniumPieces(
  spec: PuzzleSpec,
  variant: 'plus' | 'standard',
): Piece[] {
  const script = variant === 'plus' ? MINI_GERANIUM_PLUS_SCRIPT : MINI_GERANIUM_SCRIPT;
  return buildFromGeraniumsPotScript(script, spec, {
    coordScale: 1 / 50,
    originOffset: { x: 84, y: 50 },
  });
}

/**
 * Build exact 2-circle Twin Rings (67 pieces, 90° turns + inner concentric cutting rings).
 */
export function buildExactTwinRingsPieces(spec: PuzzleSpec): Piece[] {
  return buildFromGeraniumsPotScript(TWIN_RINGS_SCRIPT, spec, {
    coordScale: 1 / 50,
    originOffset: { x: 79, y: 50 },
  });
}

/**
 * Build exact unbandaged 2-Circle Venn / Mandorla (21 pieces, 120° turns).
 */
export function buildExactMandorlaPieces(spec: PuzzleSpec): Piece[] {
  return buildFromGeraniumsPotScript(MANDORLA_SCRIPT, spec, {
    coordScale: 1 / 50,
    originOffset: { x: 75.05, y: 50 },
  });
}

/**
 * Build properly unbandaged 4-Circle Clover (90° turns, clean non-tangent spacing).
 */
export function buildExactFourCircleCloverPieces(spec: PuzzleSpec): Piece[] {
  const pieces = buildFromGeraniumsPotScript(FOUR_CIRCLE_CLOVER_SCRIPT, spec, {
    coordScale: 1 / 50,
  });
  // Give each of the 4 adjacent overlap lenses a distinct blended bridge color matching its two parent circles:
  // A∩B (Red+Yellow) -> Orange, B∩C (Yellow+Green) -> Lime, C∩D (Green+Blue) -> Cyan, D∩A (Blue+Red) -> Purple
  const pairColors: Record<string, string> = {
    'A,B': '#f97316',
    'B,C': '#84cc16',
    'C,D': '#06b6d4',
    'A,D': '#a855f7',
  };
  for (const p of pieces) {
    if (p.color === '#f8fafc') {
      const members = spec.circles
        .filter((c) => classifyRegionAgainstCircle(p.region, c) === 'inside')
        .map((c) => c.id)
        .sort()
        .join(',');
      const bridge = pairColors[members];
      if (bridge) {
        p.color = bridge;
        p.homeColor = bridge;
      }
    }
  }
  return pieces;
}

/**
 * Build properly unbandaged 6-Circle Hex Flower (60° turns, hexagonal lattice).
 */
export function buildExactSixCircleHexPieces(spec: PuzzleSpec): Piece[] {
  const pieces = buildFromGeraniumsPotScript(SIX_CIRCLE_HEX_SCRIPT, spec, {
    coordScale: 1 / 50,
  });
  for (const p of pieces) {
    if (p.color === '#f8fafc') {
      const members = spec.circles.filter(
        (c) => classifyRegionAgainstCircle(p.region, c) === 'inside',
      );
      if (members.length === 2) {
        p.color = '#cbd5e1';
        p.homeColor = '#cbd5e1';
      }
    }
  }
  return pieces;
}
