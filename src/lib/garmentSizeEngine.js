// =====================================================================
// garmentSizeEngine.js
//
// The Sigvaris size-matching algorithm, ported from the published size
// finders on 2026-07-24 so a clinician can size a garment inside the
// order form instead of on a separate page and then re-typing the answer.
//
// The originals are claude.ai artifacts running under a CSP that blocks
// every outbound request, so they can never write a result back — see
// garmentSizing.js. Porting the algorithm is the only way the size, the
// item number and the measurements become data this system holds.
//
// PORTED VERBATIM FROM THE ORIGINAL `update()` / `matches()` / `skuFor()`
// ----------------------------------------------------------------------
//   matches(v, ranges)  ->  every size whose [min,max] contains v,
//                           INCLUSIVE at both ends
//   the recommendation  ->  the intersection of the per-axis matches
//   no intersection but each axis matched  ->  NOT a size. The original
//                           says "No single size fits both exactly" and
//                           tells the clinician to have the patient
//                           professionally fitted. That refusal is the
//                           clinically important branch and is preserved
//                           exactly: this module returns status
//                           'conflict' and never picks a winner.
//   an axis matched nothing  ->  'out_of_range'
//   sku  ->  (colourBase[colour] + sizeIndex + 1) + '-' + codeLetters +
//            '-BK' + (length === 'Tall' ? 'T' : 'R')
//
// WHY THE OVERLAP IS PRESERVED
// ----------------------------
// Sigvaris charts overlap by design — a 44cm calf is genuinely both
// Medium and Large. The original returns "Medium or Large" and so does
// this. Collapsing that to one size would invent a precision the
// manufacturer does not claim, and the wrong compression garment on a
// lymphedema patient is a re-order six weeks later at best.
//
// NOT PORTED, AND WHY NOT
// -----------------------
// Two of the eight finders do not use this model:
//
//   * Foot (Compreboot) matches I/J/K against a flat list of profiles
//     that carry literal item numbers, with no computed SKU at all.
//   * Compreflex Reduce sizes off cut-point thresholds
//     (e.g. C: [65, 90]) rather than per-size ranges, so "which size"
//     is a different question with different boundary semantics.
//
// Their chart data is captured but the algorithms are NOT implemented
// here. Guessing at threshold boundary behaviour would produce sizes
// that look authoritative and are wrong, which is worse than sending the
// clinician to the original tool. `supportsTool()` reports honestly and
// the UI falls back to the published finder for those two.
//
// VERIFICATION STATUS — READ BEFORE CLINICAL USE
// ----------------------------------------------
// The chart data and the algorithm were both read out of the running
// artifacts, and the branch behaviour is asserted in `npm run check`.
// What has NOT happened is a side-by-side run of this engine against the
// original calculators across a spread of real measurements — the
// originals load from an authenticated origin and could not be driven
// here. Do that A/B check before anyone orders from this, and treat the
// published finders as the reference until it passes.
// =====================================================================

// Extension is required: `npm run check` imports this module with raw
// node, whose ESM loader does not do Vite's extensionless resolution.
import { RANGE_CHARTS } from './garmentSizeCharts.js';

/** Tools this engine can size. Everything else must use the artifact. */
export function supportsTool(tool) {
  return Object.prototype.hasOwnProperty.call(RANGE_CHARTS, tool);
}

/**
 * Sizes whose range contains `v`. Inclusive at both ends, matching the
 * original's `val >= r[0] && val <= r[1]`.
 */
export function matches(v, ranges, sizes) {
  const out = [];
  if (!Number.isFinite(v) || !Array.isArray(ranges)) return out;
  ranges.forEach((r, i) => {
    if (r && v >= r[0] && v <= r[1]) out.push(sizes[i]);
  });
  return out;
}

/**
 * Which length band a garment-length measurement falls in.
 * Returns null outside every band — the original does the same, and the
 * gaps between bands (e.g. 33.9 to 34) are real chart gaps, not rounding
 * slack to be papered over.
 */
export function lengthBand(v, bands) {
  if (!bands || !Number.isFinite(v)) return null;
  for (const [name, [lo, hi]] of Object.entries(bands)) {
    if (v >= lo && v <= hi) return name;
  }
  return null;
}

/**
 * Assemble the Sigvaris item number, exactly as the original `skuFor`.
 * Returns null when anything it needs is missing rather than emitting a
 * partial code somebody might paste into a purchase order.
 */
export function buildSku(product, sizeName, colour, band) {
  if (!product || !sizeName || !colour) return null;
  const base = product.colourBase?.[colour];
  if (base == null || !product.codeLetters) return null;
  const idx = product.sizes.indexOf(sizeName);
  if (idx < 0) return null;
  const suffix = band === 'Tall' || band === 'Long' ? 'T' : 'R';
  return `${base + idx + 1}-${product.codeLetters}-BK${suffix}`;
}

/**
 * Size one garment.
 *
 * @param {string} tool     key into RANGE_CHARTS
 * @param {string} variant  which product within that chart (e.g. 'FC')
 * @param {Object} measurements  { AXIS: cm } — partial is fine
 * @param {Object} opts     { colour, length }
 *
 * @returns {{
 *   status: 'ok'|'conflict'|'out_of_range'|'incomplete'|'unsupported',
 *   sizes: string[],        // the recommendation, possibly several
 *   perAxis: Object,        // what each axis matched, for explaining
 *   band: string|null,
 *   sku: string|null,
 *   message: string,
 * }}
 *
 * `sku` is populated ONLY when exactly one size matched. Two candidate
 * sizes means two different item numbers, and picking one silently is
 * how the wrong garment gets ordered.
 */
export function sizeGarment(tool, variant, measurements, opts = {}) {
  const chart = RANGE_CHARTS[tool];
  if (!chart) {
    return { status: 'unsupported', sizes: [], perAxis: {}, band: null, sku: null,
      message: 'This garment is not sized in-app yet. Use the published Sigvaris size finder.' };
  }
  const product = chart[variant];
  if (!product) {
    return { status: 'unsupported', sizes: [], perAxis: {}, band: null, sku: null,
      message: 'Unknown product for this size chart.' };
  }

  const axes = product.axes || {};
  const perAxis = {};
  const supplied = [];
  for (const axis of Object.keys(axes)) {
    const v = Number(measurements?.[axis]);
    if (!Number.isFinite(v)) continue;
    supplied.push(axis);
    perAxis[axis] = matches(v, axes[axis], product.sizes);
  }

  const band = lengthBand(Number(opts.length), product.length);

  if (supplied.length === 0) {
    return { status: 'incomplete', sizes: [], perAxis, band, sku: null,
      message: `Enter ${Object.keys(axes).join(', ')} to see a recommended size.` };
  }

  // An axis that matched nothing is out of the charted range. Reported
  // before the intersection, because intersecting with an empty set
  // would otherwise read as a mere "conflict".
  const empty = supplied.filter(a => perAxis[a].length === 0);
  if (empty.length) {
    return { status: 'out_of_range', sizes: [], perAxis, band, sku: null,
      message: `${empty.join(' and ')} ${empty.length === 1 ? 'is' : 'are'} outside the charted range. The patient needs a professional fitting.` };
  }

  // Intersect across every supplied axis.
  const intersection = supplied.reduce(
    (acc, a) => acc.filter(s => perAxis[a].includes(s)),
    [...perAxis[supplied[0]]]
  );

  if (intersection.length === 0) {
    const all = [...new Set(supplied.flatMap(a => perAxis[a]))];
    return { status: 'conflict', sizes: all, perAxis, band, sku: null,
      message: 'No single size fits every measurement. Consider the closer fit, or have the patient professionally fitted.' };
  }

  const sku = intersection.length === 1
    ? buildSku(product, intersection[0], opts.colour, band)
    : null;

  return {
    status: 'ok', sizes: intersection, perAxis, band, sku,
    message: intersection.length === 1
      ? `${intersection[0]}${band ? ` ${band}` : ''}`
      : `${intersection.join(' or ')} — both fit; confirm against the patient's preference before ordering.`,
  };
}

/** Product options for a tool, for rendering a picker. */
export function variantsFor(tool) {
  const chart = RANGE_CHARTS[tool];
  if (!chart) return [];
  return Object.entries(chart).map(([key, p]) => ({ key, name: p.name }));
}

/** The measuring points a given product needs, in chart order. */
export function axesFor(tool, variant) {
  return Object.keys(RANGE_CHARTS[tool]?.[variant]?.axes || {});
}

/** The colours a given product is manufactured in. */
export function coloursFor(tool, variant) {
  return Object.keys(RANGE_CHARTS[tool]?.[variant]?.colourBase || {});
}

/** The length bands a product offers, or [] when it has none. */
export function lengthBandsFor(tool, variant) {
  return Object.keys(RANGE_CHARTS[tool]?.[variant]?.length || {});
}
