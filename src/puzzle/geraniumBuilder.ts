import {
  ArcRegion,
  classifyRegionAgainstCircle,
  interiorPointOfRegion,
  regionSignedArea,
  rotateRegion,
} from '../geom/arcRegion.ts';
import { Circle, deg2rad } from '../geom/math.ts';
import { sliceCircles, splitRegionByCircle } from '../geom/slicer.ts';
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

const THREE_CIRCLE_CLOVER_SCRIPT = `
Param: s, 50/sqrt(3)
Ring: 1,   0,     s, 50, 60
Ring: 2,  25,  -s/2, 50, 60
Ring: 3, -25,  -s/2, 50, 60
AutoCutParts: (1R,2R,3R),6, (1L,2L,3L),6
AutoColorParts: 3, 6, 5
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

const SEVEN_CIRCLE_FLOWER_SCRIPT = `
Param: h, 50*sqrt(3)/2
Ring: 1,  0,  50, 50, 60
Ring: 2,  h,  25, 50, 60
Ring: 3,  h, -25, 50, 60
Ring: 4,  0, -50, 50, 60
Ring: 5, -h, -25, 50, 60
Ring: 6, -h,  25, 50, 60
Ring: 7,  0,   0, 50, 60
AutoCutParts: (1R,2R,3R,4R,5R,6R,7R),6
AutoColorParts: 3, 9, 6, 4, 5, 7, 8
`;

/** Exact Bauhinium secondary disk radius: 25 / sin(36°) ≈ 42.53254 (exact 108° intersection, zero micro-slivers). */
export const BAUHINIUM_R2 = 25 / Math.sin(Math.PI / 5);

const BAUHINIUM_SCRIPT = `
Param: r2, 25/sin(pi/5)
Ring: 1, 50, 50, 50, 180
Ring: 2, 50+r2, 50, r2, 72
AutoCutParts: (2R),4, 1R, (2R),4
AutoColorParts: 3, 5, 5
`;

const BAUHINIUM_PLUS_SCRIPT = `
Ring: 1, 50, 50, 42, 72
Ring: 2, 92.1, 50, 50, 180
Ring: 3, 134.2, 50, 42, 72
AutoCutParts: (1R),4, (3R),4, 2R
AutoColorParts: 4, 3, 4
`;

const POCKET_QUATRIUM_SCRIPT = `
Ring: 1, 50, 50, 50, 90
Ring: 2, 108, 50, 50, 90
AutoCutParts: (1R,2R),7
AutoColorParts: 4, 3, 10
`;

const POCKET_QUATRIUM_PLUS_SCRIPT = `
Ring: 1, 50, 50, 50, 90
Ring: 2, 108, 50, 50, 90
Ring: 3, 166, 50, 50, 90
AutoCutParts: (1R,2R,3R),6
AutoColorParts: 11, 10, 6, 7, 0, 9
`;

const FOMALHAUT_SCRIPT = `
Ring: 1, 50, 50, 50, 72
Ring: 2, 114, 50, 58, 72
AutoCutParts: (1R,2L),20
AutoColorParts: 6, 5, 6
`;

/** Exact Mimosa disk 1 radius solving Law of Cosines for an exact 72° intersection angle with d = 37.9, r2 = 50. */
export const MIMOSA_D = 37.9;
export const MIMOSA_R1 =
  MIMOSA_D * Math.cos((2 * Math.PI) / 5) +
  Math.sqrt((MIMOSA_D * Math.cos((2 * Math.PI) / 5)) ** 2 + 2500 - MIMOSA_D * MIMOSA_D);

const MIMOSA_SCRIPT = `
Param: d, 37.9
Param: c72, cos(2*pi/5)
Param: r1, d*c72 + sqrt(d*d*c72*c72 + 2500 - d*d)
Ring: 1, 0, 0, r1, 72
Ring: 2, d, 0, 50, 180
AutoCutParts: (1R,2R),12
AutoColorParts: 3, 4, 3
`;

const COHAN_CIRCLE_VENN_SCRIPT = `
Ring: 1, 50, 50, 50, 60
Ring: 2, 100, 50, 50, 60
AutoCutParts: (1R),5, (2R),6, (1R2,2R2,2L4,2R2),2, (2R2,1R2,1L4,1R2),2
AutoColorParts: 3, 5, 7
`;

const ARECIBO_SCRIPT = `
Ring: 1, 50, 50, 50, 120
Ring: 2, 91, 50, 50, 120
AutoCutParts: (1R,2R),8
AutoColorParts: 3, 10, 6
`;

const ELIAC_SCRIPT = `
Ring: 1, 50, 50, 50, 90
Ring: 2, 85.5, 50, 50, 180
AutoCutParts: (1R,2R),8
AutoColorParts: 9, 7, 8
`;

const FRAGMENTATION_RING_SCRIPT = `
Ring: 1,  50, 50, 50, 72
Ring: 2, 112, 50, 50, 72
AutoCutParts: (1R),5, (2R),5
RemoveParts: 1,3,6,10,17,22,20
MoveParts: (15,19),1R
CopyParts: (12,9,16,8,5),1R, (12,9),1R2, (12,9),1R3, (12,9,16),1R4
CopyParts: (15),1R, (15),1R2, (25,28),(1L,2L,1R2)
CopyParts: (39,38),1R
RemoveParts: 4,2,7,14,18,23,21
CopyParts: (15,27,24),(1L,2R), (9),2R
CopyParts: (42,43,44),2R, (42,43,44),2R3, (43,44),2R2, (5,9,16),2R3, (5),2R
CopyParts: (43,57),(2L,1R,2L2)
AutoColorParts: 3, 10, 3
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
 * Build properly unbandaged 3-Circle Clover / Tri-Venn (60° turns, equilateral Reuleaux layout).
 */
export function buildExactThreeCircleCloverPieces(spec: PuzzleSpec): Piece[] {
  const pieces = buildFromGeraniumsPotScript(THREE_CIRCLE_CLOVER_SCRIPT, spec, {
    coordScale: 1 / 50,
  });
  // Primary circles: A (Red), B (Yellow), C (Blue)
  // Secondary 2-circle overlaps: A∩B -> Orange, B∩C -> Green, A∩C -> Purple; Center A∩B∩C -> Light neutral
  const pairColors: Record<string, string> = {
    'A,B': '#f97316',
    'B,C': '#16a34a',
    'A,C': '#9333ea',
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

/**
 * Build properly unbandaged 7-Circle Flower (1 central ring G + 6 outer rings A..F, 60° turns).
 */
export function buildExactSevenCircleFlowerPieces(spec: PuzzleSpec): Piece[] {
  const pieces = buildFromGeraniumsPotScript(SEVEN_CIRCLE_FLOWER_SCRIPT, spec, {
    coordScale: 1 / 50,
  });
  const outerCircles = spec.circles.slice(0, 6);
  const centerCircle = spec.circles[6];
  for (const p of pieces) {
    const inCenter = classifyRegionAgainstCircle(p.region, centerCircle) === 'inside';
    const outerMembers = outerCircles.filter(
      (c) => classifyRegionAgainstCircle(p.region, c) === 'inside',
    );
    if (outerMembers.length === 1) {
      // Pure outer petal: home color of its outer ring
      p.color = outerMembers[0].color;
      p.homeColor = outerMembers[0].color;
    } else if (inCenter && outerMembers.length === 3) {
      // 6 central flower petals inside G: color each by the middle/nearest outer ring so turning G swirls the rainbow core!
      const pt = interiorPointOfRegion(p.region);
      let best = outerMembers[0];
      let bestD = Infinity;
      for (const c of outerMembers) {
        const d = Math.hypot(pt.x - c.cx, pt.y - c.cy);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      p.color = best.color;
      p.homeColor = best.color;
    } else if (inCenter && outerMembers.length === 2) {
      // 6 inner star tips bordering G's rim: crisp teal accent matching G
      p.color = '#14b8a6';
      p.homeColor = '#14b8a6';
    } else if (!inCenter && outerMembers.length === 2) {
      // Outer 2-circle overlap lenses outside G: soft slate bridge
      p.color = '#cbd5e1';
      p.homeColor = '#cbd5e1';
    }
  }
  return pieces;
}


export function buildExactBauhiniumPieces(spec: PuzzleSpec, plus: boolean): Piece[] {
  const ox = plus ? 92.1 : (50 + BAUHINIUM_R2 * 2) / 2;
  return buildFromGeraniumsPotScript(plus ? BAUHINIUM_PLUS_SCRIPT : BAUHINIUM_SCRIPT, spec, {
    coordScale: 1 / 50,
    originOffset: { x: ox, y: 50 },
  });
}

export function buildExactPocketQuatriumPieces(spec: PuzzleSpec, plus: boolean): Piece[] {
  return buildFromGeraniumsPotScript(
    plus ? POCKET_QUATRIUM_PLUS_SCRIPT : POCKET_QUATRIUM_SCRIPT,
    spec,
    {
      coordScale: 1 / 50,
      originOffset: plus ? { x: 108, y: 50 } : { x: 79, y: 50 },
    },
  );
}

export function buildExactFomalhautPieces(spec: PuzzleSpec): Piece[] {
  return buildFromGeraniumsPotScript(FOMALHAUT_SCRIPT, spec, {
    coordScale: 1 / 50,
    originOffset: { x: 86, y: 50 },
  });
}

export function buildExactMimosaPieces(spec: PuzzleSpec): Piece[] {
  const ox = (-MIMOSA_R1 + (MIMOSA_D + 50)) / 2;
  return buildFromGeraniumsPotScript(MIMOSA_SCRIPT, spec, {
    coordScale: 1 / 50,
    originOffset: { x: ox, y: 0 },
  });
}

export function buildExactCohanCirclePieces(spec: PuzzleSpec): Piece[] {
  return buildFromGeraniumsPotScript(COHAN_CIRCLE_VENN_SCRIPT, spec, {
    coordScale: 1 / 50,
    originOffset: { x: 75, y: 50 },
  });
}

export function buildExactAreciboPieces(spec: PuzzleSpec): Piece[] {
  return buildFromGeraniumsPotScript(ARECIBO_SCRIPT, spec, {
    coordScale: 1 / 50,
    originOffset: { x: 70.5, y: 50 },
  });
}

export function buildExactEliacPieces(spec: PuzzleSpec): Piece[] {
  return buildFromGeraniumsPotScript(ELIAC_SCRIPT, spec, {
    coordScale: 1 / 50,
    originOffset: { x: 67.75, y: 50 },
  });
}

export function buildExactFragmentationRingPieces(spec: PuzzleSpec): Piece[] {
  return buildFromGeraniumsPotScript(FRAGMENTATION_RING_SCRIPT, spec, {
    coordScale: 1 / 50,
    originOffset: { x: 81, y: 50 },
  });
}

function splitRegionsByCircle(regions: ArcRegion[], circle: Circle, minArea = 1e-5): ArcRegion[] {
  const next: ArcRegion[] = [];
  for (const reg of regions) {
    if (classifyRegionAgainstCircle(reg, circle, 1e-4) === 'straddling') {
      const sp = splitRegionByCircle(reg, circle);
      if (sp && sp.length > 1) {
        for (const r of sp) {
          if (regionSignedArea(r.edges) > minArea) next.push(r);
        }
        continue;
      }
    }
    next.push(reg);
  }
  return next;
}

function rotateRegionsInside(regions: ArcRegion[], circle: Circle, rad: number): ArcRegion[] {
  return regions.map((r) =>
    classifyRegionAgainstCircle(r, circle, 1e-4) === 'inside'
      ? rotateRegion(r, circle.cx, circle.cy, rad)
      : r,
  );
}

/**
 * Cube4you Crazy Lekki (concept: Victor Manuel Wdoviak, design: Jose Romero):
 * Large 2-layer 120° circle A (inner r=53/50, outer r=84/50) on the left +
 * smaller 90° circle B (r=58/50) on the right, center distance = 130*sqrt(3)/3 / 50.
 * Turning B by 90° bandages A's outer ring (2A / a) while leaving inner disk A free;
 * turning B by 180° unlocks A's outer ring again. Exact 37-piece RBOY layout.
 */
export const CRAZY_LEKKI_DIST = ((130 * Math.sqrt(3)) / 3) / 50;

export function buildExactCrazyLekkiPieces(spec: PuzzleSpec): Piece[] {
  const cA = spec.circles[0]; // large 2-layer 120° (left)
  const cB = spec.circles[1]; // small 90° yellow (right)
  const rInner = cA.layerRadii?.[0] ?? 53 / 50;
  const cAInner: Circle = { cx: cA.cx, cy: cA.cy, r: rInner };
  const cAOuter: Circle = { cx: cA.cx, cy: cA.cy, r: cA.r };

  let regions: ArcRegion[] = sliceCircles([cA, cB]).map((r) => ({ edges: r.edges }));
  regions = splitRegionsByCircle(regions, cAInner);

  const cutAll = () => {
    regions = splitRegionsByCircle(regions, cB);
    regions = splitRegionsByCircle(regions, cAOuter);
    regions = splitRegionsByCircle(regions, cAInner);
  };
  const cutInner = () => {
    regions = splitRegionsByCircle(regions, cB);
    regions = splitRegionsByCircle(regions, cAInner);
  };

  let prev = -1;
  for (let iter = 0; iter < 8 && regions.length !== prev; iter++) {
    prev = regions.length;
    // Propagate all inner-disk cuts symmetrically across all 3 sectors of A at B = 0° (legal move `A`)
    for (let k = 0; k < 3; k++) {
      regions = rotateRegionsInside(regions, cAInner, (2 * Math.PI) / 3);
      cutAll();
    }
    // Outer closure (B at 0°/180°): wide ±120° on A + 180° on B
    for (const aDir of [1, -1]) {
      for (let k = 0; k < 6; k++) {
        regions = rotateRegionsInside(regions, cAOuter, (aDir * 2 * Math.PI) / 3);
        cutAll();
        regions = rotateRegionsInside(regions, cB, Math.PI);
        cutAll();
      }
    }
    // Inner commutator closure (both ±120° on A so top & bottom sectors are exact mirror twins):
    // B (±90°) -> A inner (±120°) -> B (∓90°) -> A wide (±120°)
    for (const dir of [1, -1]) {
      for (const aDir of [1, -1]) {
        for (let k = 0; k < 3; k++) {
          regions = rotateRegionsInside(regions, cB, (dir * Math.PI) / 2);
          cutInner();
          regions = rotateRegionsInside(regions, cAInner, (aDir * 2 * Math.PI) / 3);
          cutInner();
          regions = rotateRegionsInside(regions, cB, (-dir * Math.PI) / 2);
          cutAll();
          regions = rotateRegionsInside(regions, cAOuter, (aDir * 2 * Math.PI) / 3);
          cutAll();
        }
      }
    }
  }

  // Exact RBOY coloring matching the physical Cube4you Crazy Lekki:
  // inside B -> Yellow; inside B rotated ±120° around A -> Orange (top) / Red (bottom);
  // remaining 3-way T-bridge & wedges -> Cyan.
  const dx = cB.cx - cA.cx;
  const dy = cB.cy - cA.cy;
  const rotPt = (deg: number) => {
    const rad = deg2rad(deg);
    return {
      cx: cA.cx + dx * Math.cos(rad) - dy * Math.sin(rad),
      cy: cA.cy + dx * Math.sin(rad) + dy * Math.cos(rad),
      r: cB.r,
    };
  };
  const bTop = rotPt(120);
  const bBot = rotPt(-120);

  return regions.map((region, id) => {
    const pt = interiorPointOfRegion(region);
    let color = '#06b6d4'; // Cyan 3-way separator
    if (Math.hypot(pt.x - cB.cx, pt.y - cB.cy) < cB.r - 1e-4) {
      color = '#facc15'; // Yellow (small 90° circle B)
    } else if (Math.hypot(pt.x - bTop.cx, pt.y - bTop.cy) < bTop.r - 1e-4) {
      color = '#f97316'; // Orange (upper-left sector of A)
    } else if (Math.hypot(pt.x - bBot.cx, pt.y - bBot.cy) < bBot.r - 1e-4) {
      color = '#ef4444'; // Red (lower-left sector of A)
    }
    return {
      id,
      region,
      color,
      homeColor: color,
      area: regionSignedArea(region.edges),
    };
  });
}

// Verbatim Cubitero/GigaHex.txt (105 pieces, 2 concentric 2-layer 60° circles)
const GIGAHEX_SCRIPT = `
Ring: 1,  50, 50, 50, 60
Ring: 2,  50, 50, 40, 60
Ring: 3, 113, 50, 50, 60
Ring: 4, 113, 50, 40, 60
AutoCutParts: (1R,3R),9
AutoColorParts: 4,4, 9,9
SetColorParts: (8,21,36,51,48,49,50,69,84,97),1, (9,22,37,55,70,85,98,56,57,58),1
SetColorParts: (11,14,20,25,32,15,26,35,40,45),4, (62,59,63,68,77,89,101,72,76,83,88,94,75,87,96,100,104,101),3
SetColorParts: (16,27,33,28,41,46,42,52,53,54,64,60,65,78,73,79,90),6
SetColorParts: (12,18,23,30,34,17,29,38,43,47),9, (102,91,80,71,66,61,67,105,95,92,86,81,74,82,103,99,93),5
`;

export function buildExactGigaHexPieces(spec: PuzzleSpec): Piece[] {
  return buildFromGeraniumsPotScript(GIGAHEX_SCRIPT, spec, {
    coordScale: 1 / 50,
    originOffset: { x: 81.5, y: 50 },
  });
}

// Cube4you GigaHex Plus: 3 concentric 2-layer 60° circles in equilateral triangle (mirror-symmetric)
const GIGAHEX_PLUS_SCRIPT = `
Param: s, 63/sqrt(3)
Ring: 1,   0,     s, 50, 60
Ring: 2,   0,     s, 40, 60
Ring: 3,  31.5, -s/2, 50, 60
Ring: 4,  31.5, -s/2, 40, 60
Ring: 5, -31.5, -s/2, 50, 60
Ring: 6, -31.5, -s/2, 40, 60
AutoCutParts: (1R,3R,5R),6, (1L,3L,5L),6, (1R,5R,3R),6, (1L,5L,3L),6
AutoColorParts: 4,4, 5,5, 3,3
`;

export function buildExactGigaHexPlusPieces(spec: PuzzleSpec): Piece[] {
  const pieces = buildFromGeraniumsPotScript(GIGAHEX_PLUS_SCRIPT, spec, {
    coordScale: 1 / 50,
    originOffset: { x: 0, y: 0 },
  });
  // Exact 7-color RGB/CMY/White Venn stickerless scheme (matching Cube4you GigaHex Plus)
  const [cA, cB, cC] = spec.circles;
  const vennColors: Record<number, string> = {
    1: '#16a34a', // A only (Green)
    2: '#2563eb', // B only (Blue)
    4: '#ef4444', // C only (Red)
    3: '#06b6d4', // A ∩ B (Cyan)
    6: '#9333ea', // B ∩ C (Purple)
    5: '#facc15', // C ∩ A (Yellow)
    7: '#f8fafc', // A ∩ B ∩ C (White)
  };
  return pieces.map((p) => {
    const pt = interiorPointOfRegion(p.region);
    let mask = 0;
    if (Math.hypot(pt.x - cA.cx, pt.y - cA.cy) < cA.r - 1e-4) mask |= 1;
    if (Math.hypot(pt.x - cB.cx, pt.y - cB.cy) < cB.r - 1e-4) mask |= 2;
    if (Math.hypot(pt.x - cC.cx, pt.y - cC.cy) < cC.r - 1e-4) mask |= 4;
    const c = vennColors[mask] ?? p.color;
    return { ...p, color: c, homeColor: c };
  });
}

/**
 * ThinkFun Moonspinner (Oskar van Deventer):
 * Exact golden-ratio 5-lobed flower: 5 outer circles of radius 1 at distance d = 1/φ
 * around a central circle B of radius 1.
 * Option 2 doctrinaire representation:
 *   - A (left outer circle, (-1/φ, 0), 180°): always unblocked, flips the oval lens & left lobe.
 *   - B (central circle, (0, 0), 72°, turnRegion: 'outside'): rotates everything OUTSIDE B
 *     by 72° while keeping the crescent moon & inner disk fixed.
 * Exact 27 pieces (1 moon + 6 inner-lens pieces + 20 outer-frame pieces).
 */
export function buildExactMoonspinnerPieces(spec: PuzzleSpec): Piece[] {
  const d = 1 / PHI;
  const cA = spec.circles[0]; // (-1/φ, 0), r=1, 180°
  const cB = spec.circles[1]; // (0, 0), r=1, 72°, turnRegion='outside'
  const outerCircles: Circle[] = Array.from({ length: 5 }, (_, k) => {
    const ang = Math.PI + (k * 2 * Math.PI) / 5;
    return { cx: d * Math.cos(ang), cy: d * Math.sin(ang), r: 1 };
  });

  // Outer silhouette outside B (5 lobes) + uncut inner disk split only by A (moon + lens)
  const outInit = sliceCircles([cB, ...outerCircles])
    .filter((r) => classifyRegionAgainstCircle(r, cB, 1e-4) === 'outside')
    .map((r) => ({ edges: r.edges }));
  const inInit = sliceCircles([cB, cA])
    .filter((r) => classifyRegionAgainstCircle(r, cB, 1e-4) === 'inside')
    .map((r) => ({ edges: r.edges }));
  let regions: ArcRegion[] = [...outInit, ...inInit];

  const doA = () => {
    regions = rotateRegionsInside(regions, cA, Math.PI);
    regions = splitRegionsByCircle(regions, cB);
    regions = splitRegionsByCircle(regions, cA);
  };
  const doB = () => {
    regions = regions.map((r) =>
      classifyRegionAgainstCircle(r, cB, 1e-4) === 'outside'
        ? rotateRegion(r, cB.cx, cB.cy, (2 * Math.PI) / 5)
        : r,
    );
    regions = splitRegionsByCircle(regions, cA);
    regions = splitRegionsByCircle(regions, cB);
  };

  let prev = -1;
  for (let iter = 0; iter < 10 && regions.length !== prev; iter++) {
    prev = regions.length;
    for (let k = 0; k < 5; k++) {
      doA();
      doB();
    }
    doA();
  }

  // Exact 6-color solved layout matching ThinkFun Moonspinner:
  // Yellow moon (1), Sky Blue center lens (6), Orange left lobe + 2 adjacent cusps (7),
  // Coral Red upper lobes (6), Bright Green lower-right lobes (6), Purple bottom crescent (1).
  return regions.map((region, id) => {
    const pt = interiorPointOfRegion(region);
    const inA = Math.hypot(pt.x - cA.cx, pt.y - cA.cy) < cA.r - 1e-4;
    const inB = Math.hypot(pt.x - cB.cx, pt.y - cB.cy) < cB.r - 1e-4;
    let color: string;
    if (inB && !inA) {
      color = '#facc15'; // Yellow crescent moon
    } else if (inB && inA) {
      color = '#0ea5e9'; // Sky Blue central oval + inner pieces
    } else if (!inB && inA) {
      color = '#f97316'; // Orange left lobe + 6 adjacent cusp pieces
    } else {
      const deg = (Math.atan2(pt.y, pt.x) * 180) / Math.PI; // (-180, 180]
      if (deg >= -138 && deg <= -80) {
        color = '#a855f7'; // Purple bottom crescent alone
      } else if (deg > 7 || (deg >= -10 && pt.y > 0.14)) {
        color = '#f43f5e'; // Coral Red top & upper-right lobes + upper-right triangle
      } else {
        color = '#22c55e'; // Bright Green lower-right lobe + cusps
      }
    }
    return {
      id,
      region,
      color,
      homeColor: color,
      area: regionSignedArea(region.edges),
    };
  });
}

/**
 * Cube4you OctoCrystal (64 pieces, 8 equal 45° circles, true jumbling):
 * Exact r = 1 unit circles centered at distance 1 around an octagon, plus the exact
 * 135°-jumbling lens cuts (dBig = 1 + √2 and dFar = √((1+√2)² + 2)), yielding
 * 64 sliver-free pieces (min area π/4 - √2/2 ≈ 0.0783) in 8 swirling rainbow arms.
 */
export function buildExactOctoCrystalPieces(spec: PuzzleSpec): Piece[] {
  const circles = spec.circles;
  let regions: ArcRegion[] = sliceCircles(circles).map((r) => ({ edges: r.edges }));

  const dBig = 1 + Math.sqrt(2);
  for (let k = 0; k < 8; k++) {
    const rad = (k * Math.PI) / 4;
    regions = splitRegionsByCircle(regions, {
      cx: dBig * Math.cos(rad),
      cy: dBig * Math.sin(rad),
      r: 1,
    });
  }

  const dFar = Math.hypot(1 + Math.sqrt(2), Math.sqrt(2));
  const aFar = Math.atan2(-Math.sqrt(2), 1 + Math.sqrt(2));
  for (const ang0 of [aFar, -aFar]) {
    for (let k = 0; k < 8; k++) {
      const rad = ang0 + (k * Math.PI) / 4;
      regions = splitRegionsByCircle(regions, {
        cx: dFar * Math.cos(rad),
        cy: dFar * Math.sin(rad),
        r: 1,
      });
    }
  }

  // Exact 8 swirling rainbow arms clockwise from top (matching Cube4you OctoCrystal):
  const armColors = [
    '#ef4444', // A (135°): Red
    '#f472b6', // B (90°):  Pink
    '#9333ea', // C (45°):  Purple
    '#1d4ed8', // D (0°):   Dark Blue
    '#06b6d4', // E (-45°): Light Blue / Cyan
    '#4ade80', // F (-90°): Light Green
    '#facc15', // G (-135°): Yellow
    '#f97316', // H (180°): Orange
  ];

  return regions.map((region, id) => {
    const pt = interiorPointOfRegion(region);
    const inside = circles.map((c) => Math.hypot(pt.x - c.cx, pt.y - c.cy) < c.r - 1e-4);
    let arm = 0;
    for (let k = 0; k < 8; k++) {
      if (inside[k] && !inside[(k + 1) % 8]) {
        arm = k;
        break;
      }
    }
    return {
      id,
      region,
      color: armColors[arm],
      homeColor: armColors[arm],
      area: regionSignedArea(region.edges),
    };
  });
}

/**
 * Cube4you 2D Puzzle – XO:
 * Big 90° Red circle A (r = 1) + small 180° Sky Blue circle B (r = d = 1/√2).
 * Exact analytical tangency at A's center & 45° intersections produces 33 clean pieces
 * (18 Red + 15 Sky Blue, zero micro-slivers).
 */
export function buildExactCube4youXoPieces(spec: PuzzleSpec): Piece[] {
  const [cA, cB] = spec.circles;
  let regions: ArcRegion[] = sliceCircles([cA, cB]).map((r) => ({ edges: r.edges }));
  let prev = -1;
  for (let iter = 0; iter < 12 && regions.length !== prev; iter++) {
    prev = regions.length;
    for (let k = 0; k < 4; k++) {
      regions = rotateRegionsInside(regions, cA, Math.PI / 2);
      regions = splitRegionsByCircle(regions, cB);
      regions = splitRegionsByCircle(regions, cA);
      regions = rotateRegionsInside(regions, cB, Math.PI);
      regions = splitRegionsByCircle(regions, cA);
      regions = splitRegionsByCircle(regions, cB);
    }
  }
  return regions.map((region, id) => {
    const pt = interiorPointOfRegion(region);
    const inB = Math.hypot(pt.x - cB.cx, pt.y - cB.cy) < cB.r - 1e-4;
    const c = inB ? '#38bdf8' : '#ef4444';
    return {
      id,
      region,
      color: c,
      homeColor: c,
      area: regionSignedArea(region.edges),
    };
  });
}

// Verbatim James/10 Stars.txt = Cube4you UFO 2D (Evgeniy Grigoriev, 100 pieces)
const UFO_2D_SCRIPT = `
Param: radius, 200
Param: radius2,105
Ring: 1,  0, -radius, radius, 36
Ring: 2,  0, 0, radius2, (36,108,36,36,108,36)
CopyRing: 3, 2, 1R, radius2, (36,108,36,36,108,36)
CopyRing: 4, 2, 1R2, radius2, (36,108,36,36,108,36)
CopyRing: 5, 2, 1R3, radius2, (36,108,36,36,108,36)
CopyRing: 6, 2, 1R4, radius2, (36,108,36,36,108,36)
CopyRing: 7, 2, 1R5, radius2, (36,108,36,36,108,36)
CopyRing: 8, 2, 1R6, radius2, (36,108,36,36,108,36)
CopyRing: 9, 2, 1R7, radius2, (36,108,36,36,108,36)
CopyRing:10, 2, 1R8, radius2, (36,108,36,36,108,36)
CopyRing:11, 2, 1R9, radius2, (36,108,36,36,108,36)
RemoveRings: 1
AutoCutParts:
AutoCutParts: ( (2R3,3),(3R3,4),(4R3,5),(5R3,6),(6R3,7),(7R3,8),(8R3,9),(9R3,10),(10R3,11),(11R3,2) ),4
SetColorCircles: 2,1, 3,1, 4,1, 5,1, 6,1, 7,1, 8,1, 9,1, 10,1, 11,1
SetColorCircles: (2,3),14, (3,4),6, (4,5),9, (5,6),3, (6,7),0, (7,8),13, (8,9),7, (9,10),11, (10,11),5, (11,2),10
SetColorParts: (26,27,37,51,65,75,74,64,50,36),1, (8,13),14, (19,35),6, (43,59),9, (67,83),3, (92,94),0, (88,93),13
SetColorParts: (66,82),7, (42,58),11, (18,34),5, (7,9),10
`;

export function buildExactUfo2dPieces(spec: PuzzleSpec): Piece[] {
  return buildFromGeraniumsPotScript(UFO_2D_SCRIPT, spec, {
    coordScale: 1 / 100,
    originOffset: { x: 0, y: -200 },
  });
}
