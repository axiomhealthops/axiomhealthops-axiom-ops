// =====================================================================
// garmentSizeCharts.js
//
// Sigvaris sizing charts, extracted verbatim from the eight published
// size-finder artifacts on 2026-07-24. This is DATA, not judgement —
// every range, colour base and item-number fragment below was read out
// of the running calculators' own `productConfigs` / `axes` objects, not
// transcribed from a printed catalogue and not inferred.
//
// PROVENANCE (artifact id -> what was taken)
//   03d880f0  compreflex-calf                 productConfigs
//   bcb36702  compreflex-standard-knee-thigh  KNEE_STD, THIGH_STD, COMPREKNEE
//   106749f0  compreflex-contain              CALF, KNEE, THIGH
//   1f5728f3  compreflex-standard-arm         ARM, GLOVE
//   24b751f9  compreshort-compreshape         sizeMeta, axes, productBase
//   48c19a61  specialty-secure                ARMSLEEVE, PALM, colours, SERIES
//
// NOT YET EXTRACTED — see garmentSizeEngine.js for why these are held
// back rather than half-ported:
//   93716a9c  foot            uses a flat profile list with literal SKUs
//   4e45c640  compreflex-reduce  uses cut-point thresholds, not per-size ranges
//
// UNITS ARE CENTIMETRES throughout, EXCEPT SpecialtySecure which the
// original publishes in both inches and cm and which is stored here the
// same way. Mixing those two up produces a garment roughly 2.5x wrong,
// so the unit is part of the chart, never assumed by the caller.
//
// THE RANGES OVERLAP ON PURPOSE. Sigvaris charts are deliberately
// overlapping — a 44cm calf is legitimately both Medium and Large — and
// the engine returns every matching size rather than silently picking
// one. Do not "fix" the overlap; collapsing it invents a precision the
// manufacturer does not claim.
// =====================================================================

/**
 * Shape of every chart below:
 *   sizes       ordered size names; index drives the item-number offset
 *   axes        { MEASURING_POINT: [[min,max] per size] }  — cm
 *   length      { BandName: [min,max] } optional garment-length band
 *   colourBase  { Colour: base item number }
 *   codeLetters product letters used in the item number, where the
 *               original calculator assembles one
 */

// --- Compreflex adjustable velcro, calf (artifact 03d880f0) ----------
// All four products share one chart; only the code letters, the colour
// base and (for Pulse) the size count differ.
const CALF_C = [[29, 39], [34, 44], [40, 50], [46, 56], [54, 64]];
const CALF_A = [[19, 26], [21, 30], [26, 36], [31, 41], [36, 46]];
const CALF_SIZES = ['Small', 'Medium', 'Large', 'X Large', 'XX Large'];
const CALF_LENGTH = { Regular: [30, 33.9], Tall: [34, 42] };

export const COMPREFLEX_CALF = {
  FC: {
    name: 'Compreflex Complete Calf', codeLetters: 'FC',
    sizes: CALF_SIZES, axes: { C: CALF_C, A: CALF_A },
    length: CALF_LENGTH, colourBase: { Black: 1400, Beige: 1410 },
  },
  NF: {
    name: 'Compreflex Standard Calf', codeLetters: 'NF',
    sizes: CALF_SIZES, axes: { C: CALF_C, A: CALF_A },
    length: CALF_LENGTH, colourBase: { Black: 1400, Beige: 1410 },
  },
  TRANS: {
    name: 'Compreflex Transition Calf', codeLetters: 'UC',
    sizes: CALF_SIZES, axes: { C: CALF_C, A: CALF_A },
    length: CALF_LENGTH, colourBase: { Black: 1400, Beige: 1410 },
  },
  PULSE: {
    // Pulse stops at X Large — four sizes, not five. Reusing the
    // five-size arrays here would offer a size that is not manufactured.
    name: 'Compreflex Pulse Calf', codeLetters: 'UC',
    sizes: ['Small', 'Medium', 'Large', 'X Large'],
    axes: { C: CALF_C.slice(0, 4), A: CALF_A.slice(0, 4) },
    length: CALF_LENGTH, colourBase: { Black: 3600, Beige: 3610 },
  },
};

// --- Compreflex Standard knee / thigh (artifact bcb36702) -----------
export const COMPREFLEX_STANDARD = {
  KNEE: {
    name: 'Compreflex Standard Knee', codeLetters: 'NF',
    sizes: ['Small', 'Medium', 'Large', 'X Large'],
    axes: {
      D:  [[38, 48], [46, 56], [53, 63], [58, 73]],
      C1: [[29, 39], [34, 44], [39, 49], [44, 65]],
    },
    colourBase: { Black: 1400, Beige: 1410 },
  },
  THIGH: {
    name: 'Compreflex Standard Thigh', codeLetters: 'NF',
    sizes: ['Small', 'Medium', 'Large', 'X Large'],
    axes: {
      F: [[48, 58], [56, 66], [64, 74], [74, 84]],
      E: [[43, 53], [51, 61], [58, 68], [68, 78]],
      D: [[38, 48], [46, 56], [53, 63], [63, 73]],
    },
    length: { Regular: [20, 24.9], Tall: [25, 30] },
    colourBase: { Black: 1400, Beige: 1410 },
  },
  COMPREKNEE: {
    // Three sizes, the top one a combined Large/X Large.
    name: 'Compreknee', codeLetters: 'NF',
    sizes: ['Small', 'Medium', 'Large/X Large'],
    axes: {
      D:  [[38, 48], [46, 56], [53, 73]],
      C1: [[29, 39], [34, 44], [39, 65]],
    },
    colourBase: { Black: 1100, Beige: 1110 },
  },
};

// --- Compreflex Contain (artifact 106749f0) -------------------------
export const COMPREFLEX_CONTAIN = {
  CALF: {
    name: 'Compreflex Contain Calf', codeLetters: 'CN',
    sizes: CALF_SIZES,
    axes: { C: CALF_C, A: CALF_A },
    length: CALF_LENGTH,
    colourBase: { Black: 3400, Beige: 3410 },
  },
  KNEE: {
    name: 'Compreflex Contain Knee', codeLetters: 'CN',
    sizes: CALF_SIZES,
    axes: {
      D:  [[38, 48], [46, 56], [53, 63], [61, 71], [69, 79]],
      C1: [[29, 39], [34, 44], [39, 49], [46, 56], [54, 64]],
    },
    colourBase: { Black: 3400, Beige: 3410 },
  },
  THIGH: {
    name: 'Compreflex Contain Thigh', codeLetters: 'CN',
    sizes: CALF_SIZES,
    axes: {
      F: [[48, 58], [56, 66], [64, 74], [72, 82], [80, 90]],
      E: [[43, 53], [51, 61], [58, 68], [66, 76], [74, 84]],
      D: [[38, 48], [46, 56], [53, 63], [61, 71], [69, 79]],
    },
    length: { Regular: [20, 24.9], Tall: [25, 30] },
    colourBase: { Black: 3400, Beige: 3410 },
  },
};

// --- Compreflex Standard arm (artifact 1f5728f3) --------------------
// NOTE the measuring points here are C / B1 / B / A, and the length
// bands are Short / Regular / Long — NOT the B/C/D/E/G set the lower
// extremity charts use. An arm order sized against a leg chart is the
// exact failure this file exists to prevent.
export const COMPREFLEX_ARM = {
  ARM: {
    name: 'Compreflex Standard Arm', codeLetters: 'NF',
    sizes: ['Small', 'Medium', 'Large', 'X Large'],
    axes: {
      C:  [[23, 32], [28, 37], [33, 43], [39, 49]],
      B1: [[22, 30], [26, 34], [30, 39], [35, 44]],
      B:  [[20, 27], [24, 31], [28, 35], [32, 39]],
      A:  [[14, 19], [15, 20], [16, 21], [18, 23]],
    },
    length: { Short: [38, 42.9], Regular: [43, 47.9], Long: [48, 53] },
    colourBase: { Black: 1400, Beige: 1410 },
  },
  GLOVE: {
    name: 'Compreflex Standard Glove', codeLetters: 'NF',
    sizes: ['Small', 'Medium', 'Large', 'X Large'],
    axes: {
      E: [[15, 19], [19, 22], [22, 26], [26, 29]],
      A: [[14, 20], [16, 22], [18, 24], [20, 26]],
    },
    colourBase: { Black: 1200 },
  },
};

// --- Compreshort / Compreshape (artifact 24b751f9) ------------------
// Fifteen sizes alternating standard and "Max", which share a waist/hip
// range and differ on thigh and calf. `pair` is the numeric size index
// the item number uses; `max` selects the wider-limb variant.
export const COMPRESHORT = {
  sizeMeta: [
    { name: 'Small',        pair: 1, max: false }, { name: 'Small Max',        pair: 1, max: true },
    { name: 'Medium',       pair: 2, max: false }, { name: 'Medium Max',       pair: 2, max: true },
    { name: 'Large',        pair: 3, max: false }, { name: 'Large Max',        pair: 3, max: true },
    { name: 'X Large',      pair: 4, max: false }, { name: 'X Large Max',      pair: 4, max: true },
    { name: '2X Large',     pair: 5, max: false }, { name: '2X Large Max',     pair: 5, max: true },
    { name: '3X Large',     pair: 6, max: false }, { name: '3X Large Max',     pair: 6, max: true },
    { name: '4X Large',     pair: 7, max: false }, { name: '4X Large Max',     pair: 7, max: true },
    { name: '5X Large',     pair: 8, max: false },
  ],
  axes: {
    Waist:    [[69,76],[76,86],[76,86],[86,97],[86,97],[97,112],[97,112],[112,132],[112,132],[132,152],[132,152],[152,172],[152,172],[172,193],[172,193]],
    Hip:      [[84,91],[91,102],[91,102],[102,112],[102,112],[112,127],[112,127],[127,147],[127,147],[147,168],[147,168],[168,188],[168,188],[188,208],[188,208]],
    Midthigh: [[41,46],[41,46],[46,53],[46,53],[53,61],[53,61],[61,71],[61,71],[71,81],[71,81],[81,91],[81,91],[91,101],[91,101],[101,112]],
    Calf:     [[28,32],[28,32],[34,40],[34,40],[40,46],[40,46],[46,53],[46,53],[53,61],[53,61],[61,71],[61,71],[71,81],[71,81],[81,91]],
  },
  productBase:  { compreshort: 1300, compreshape: 2300 },
  productLabel: { compreshort: 'Compreshort', compreshape: 'Compreshape' },
};

// --- Specialty Secure armsleeve / glove / gauntlet (artifact 48c19a61)
// The only chart published in BOTH inches and centimetres, and the only
// one whose item number is assembled from a series + style letter +
// colour number + size code + compression class rather than from a
// numeric colour base. Both unit tables are kept: the original lets the
// clinician choose, and dropping one would force a conversion this
// module has no mandate to perform.
export const SPECIALTY_SECURE = {
  armsleeveSizes: ['Small', 'Medium', 'Large', 'X Large', 'XX Large'],
  armsleeveCodes: ['S', 'M', 'L', 'X', 'G'],
  armsleeve: {
    in: {
      Wrist:    [[5.5, 6.5], [6.5, 7], [7, 8], [8, 9], [9, 10]],
      Elbow:    [[8, 13.5], [9, 14.5], [10, 15.5], [11.5, 16.5], [12.5, 17.5]],
      UpperArm: [[10, 15.5], [11.5, 17], [12.5, 18], [13.5, 19], [14.5, 20.5]],
    },
    cm: {
      Wrist:    [[14, 16], [16, 18], [18, 20], [20, 23], [23, 26]],
      Elbow:    [[20, 34], [23, 37], [26, 40], [29, 42], [32, 45]],
      UpperArm: [[26, 40], [29, 43], [32, 46], [34, 48], [37, 52]],
    },
  },
  palmSizes: ['X Small', 'Small', 'Medium', 'Large', 'X Large', 'XX Large'],
  palmCodes: ['XS', 'S', 'M', 'L', 'XL', 'G'],
  palm: {
    in: { Palm: [[6, 6.5], [7, 7.5], [8, 8.5], [8.5, 9], [9.5, 10], [10.5, 11]] },
    cm: { Palm: [[16, 17], [18, 19], [20, 21], [22, 23], [24, 25], [26, 28]] },
  },
  armsleeveColours: { 'Dusty Rose Floral': 16, 'Blue Chevron': 70, Beige: 78, Cocoa: 84, Black: 99 },
  gloveColours:     { Blue: 50, 'Dusty Rose': 65, Beige: 78, Cocoa: 84, Black: 99 },
  series:      { armsleeve: '57', glove: '56', gauntlet: '56' },
  styleLetter: { armsleeve: 'A',  glove: 'F',  gauntlet: 'G'  },
  defaultMmhg: { armsleeve: 1,    glove: 2,    gauntlet: 2    },
};

/**
 * Every chart that the shared range-intersection engine can size.
 * Foot and Reduce are deliberately absent — they use different models
 * and are handled (or refused) explicitly by the engine.
 */
export const RANGE_CHARTS = {
  'compreflex-calf':                 COMPREFLEX_CALF,
  'compreflex-standard-knee-thigh':  COMPREFLEX_STANDARD,
  'compreflex-contain':              COMPREFLEX_CONTAIN,
  'compreflex-standard-arm':         COMPREFLEX_ARM,
};
