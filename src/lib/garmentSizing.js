// =====================================================================
// garmentSizing.js
//
// The registry of Sigvaris size finders: which garments exist, which
// limb each serves, where the published artifact lives, and whether we
// can size it in-app or have to hand off to the artifact.
//
// The measuring-point codes below were read out of the running
// calculators on 2026-07-24 — their actual axis keys, not a guess from
// the garment name. That distinction cost a correction: the Compreflex
// Standard Arm chart sizes on C / B1 / B / A with Short/Regular/Long
// length bands, NOT the B/C/D/E/G set the lower-extremity charts use.
// A sleeve sized against a leg chart is a garment that does not fit.
//
// WHY THE ARTIFACTS STILL EXIST HERE
// ----------------------------------
// Six of the eight garments are now sized in-app by garmentSizeEngine.js
// and never need the round trip. Two are not:
//
//   foot               matches I/J/K against a flat profile list whose
//                      item numbers are literals, not computed
//   compreflex-reduce  sizes off cut-point thresholds rather than
//                      per-size ranges
//
// Their algorithms are different enough that implementing them from a
// source read alone would risk producing confident, wrong sizes. Until
// they are ported and A/B checked, those two link out to the published
// finder, and `inApp: false` is what the UI keys off. Everything links
// out as well, because the artifact remains the reference implementation
// until the port is verified against it.
// =====================================================================

/** The hub page listing all eight finders. */
export const SIZE_FINDER_INDEX = 'https://claude.ai/public/artifacts/3452d6b5-c5ef-49dd-8c1f-fc5029491631';

const A = (id) => `https://claude.ai/public/artifacts/${id}`;

/**
 * `tool` matches the RANGE_CHARTS key in garmentSizeCharts.js wherever
 * `inApp` is true, so the UI can go straight from a picked finder to a
 * live calculation with no second mapping table to drift out of sync.
 */
export const SIZE_FINDERS = [
  {
    key: 'compreflex-calf',
    label: 'Compreflex Calf',
    limb: 'LE',
    inApp: true,
    url: A('03d880f0-bb41-4b4b-9f45-40ab91113dfc'),
    blurb: 'Adjustable velcro garments for the calf — Complete, Standard, Transition, Pulse.',
    points: [
      { code: 'C', label: 'fullest calf' },
      { code: 'A', label: 'fullest ankle' },
    ],
    lengthLabel: 'G — calf length',
  },
  {
    key: 'compreflex-standard-knee-thigh',
    label: 'Compreflex Standard (Knee/Thigh)',
    limb: 'LE',
    inApp: true,
    url: A('bcb36702-8849-4005-a79e-8e2e41cd2531'),
    blurb: 'Compreflex Standard knee and thigh, plus Compreknee.',
    points: [
      { code: 'D',  label: 'below knee' },
      { code: 'C1', label: 'calf' },
      { code: 'F',  label: 'thigh' },
      { code: 'E',  label: 'mid thigh' },
    ],
    lengthLabel: 'G1 — thigh length',
  },
  {
    key: 'compreflex-contain',
    label: 'Compreflex Contain',
    limb: 'LE',
    inApp: true,
    url: A('106749f0-80dc-401b-98c4-9402176b3cd2'),
    blurb: 'Compreflex Contain — calf, knee and thigh.',
    points: [
      { code: 'C',  label: 'fullest calf' },
      { code: 'A',  label: 'fullest ankle' },
      { code: 'D',  label: 'below knee' },
      { code: 'C1', label: 'calf' },
      { code: 'F',  label: 'thigh' },
      { code: 'E',  label: 'mid thigh' },
    ],
    lengthLabel: 'garment length',
  },
  {
    key: 'compreflex-standard-arm',
    label: 'Compreflex Standard Arm',
    limb: 'UE',
    inApp: true,
    url: A('1f5728f3-3541-4ad2-b3f5-d6ad5ad80c66'),
    blurb: 'Compreflex Standard arm and glove.',
    points: [
      { code: 'C',  label: 'upper arm' },
      { code: 'B1', label: 'below elbow' },
      { code: 'B',  label: 'forearm' },
      { code: 'A',  label: 'wrist' },
      { code: 'E',  label: 'hand (glove)' },
    ],
    lengthLabel: 'arm length',
  },
  {
    key: 'compreshort-compreshape',
    label: 'Compreshort & Compreshape',
    limb: 'LE',
    inApp: false,           // chart captured; engine variant not wired yet
    url: A('24b751f9-d369-4cc0-86d8-cbd8a9dcce0e'),
    blurb: 'Compreshort and Compreshape — trunk and upper leg, 15 sizes with Max variants.',
    points: [
      { code: 'Waist',    label: 'waist' },
      { code: 'Hip',      label: 'hip' },
      { code: 'Midthigh', label: 'mid thigh' },
      { code: 'Calf',     label: 'calf' },
    ],
  },
  {
    key: 'specialty-secure',
    label: 'Specialty Secure (Arm/Glove/Gauntlet)',
    limb: 'UE',
    inApp: false,           // dual-unit chart + a different item-number model
    url: A('48c19a61-f1c6-42d1-9b27-57057962cae8'),
    blurb: 'Specialty Secure armsleeve, glove and gauntlet. Published in inches AND cm — check which you are reading.',
    points: [
      { code: 'Wrist',    label: 'wrist' },
      { code: 'Elbow',    label: 'elbow' },
      { code: 'UpperArm', label: 'upper arm' },
      { code: 'Palm',     label: 'palm (glove/gauntlet)' },
    ],
  },
  {
    key: 'foot',
    label: 'Foot Compression (Compreboot)',
    limb: 'LE',
    inApp: false,           // profile-list model, literal item numbers
    url: A('93716a9c-8a5e-4981-a9ec-a545a426b6f4'),
    blurb: 'Compreboot Lite, Standard and Plus.',
    points: [
      { code: 'I', label: 'foot circumference' },
      { code: 'J', label: 'instep' },
      { code: 'K', label: 'foot length' },
    ],
  },
  {
    key: 'compreflex-reduce',
    label: 'Compreflex Reduce',
    limb: 'LE',
    inApp: false,           // threshold cut-points, not per-size ranges
    url: A('4e45c640-e57a-41aa-a327-0cd2a729cd4b'),
    blurb: 'Compreflex Reduce — calf, knee and thigh, including the foot piece.',
    points: [
      { code: 'C',  label: 'fullest calf' },
      { code: 'A',  label: 'fullest ankle' },
      { code: 'D',  label: 'below knee' },
      { code: 'C1', label: 'calf' },
      { code: 'F',  label: 'thigh' },
      { code: 'I',  label: 'foot circumference' },
      { code: 'J',  label: 'instep' },
      { code: 'K',  label: 'foot length' },
    ],
  },
];

/**
 * The finders that apply to a limb.
 *
 * Filtering matters clinically, not just cosmetically: offering an
 * armsleeve calculator on a lower-extremity order is how the wrong
 * chart gets used, and a size read off the wrong chart is a garment
 * that does not fit and a re-order six weeks later.
 *
 * An unrecognised limb returns everything rather than nothing — a
 * clinician facing an empty list has no route forward, and the sheet
 * import can carry limb values this app has not seen.
 */
export function finderFor(limb) {
  const l = String(limb || '').toUpperCase();
  if (l !== 'LE' && l !== 'UE') return SIZE_FINDERS;
  return SIZE_FINDERS.filter(f => f.limb === l);
}

/** Look up one finder by key. */
export function finderByKey(key) {
  return SIZE_FINDERS.find(f => f.key === key) || null;
}
