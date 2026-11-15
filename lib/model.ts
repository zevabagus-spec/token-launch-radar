// The token radar's model: the sealed snapshot in, one ranked board out.
//
// The board ranks pre-token protocols only: a protocol records no token when its
// snapshot entry carries neither a CoinGecko id nor a symbol. Every watchlist slug
// is ranked, and the early radar adds the 160 highest-TVL pre-token protocols below
// the watchlist floor. Protocols whose token already trades are kept apart: the
// dashboard shows their market caps as facts, never as model output, and their
// prices are the comparables the model is fitted on.
//
// Implied value is a comps curve fitted to the snapshot's own market, not a fixed
// constant and not a list of names. The priced peers (protocols that record a
// market cap and a positive TVL, exchange tokens left out) give a least-squares
// line of log market cap on log TVL; each category's median market-cap-to-TVL
// ratio then adjusts the curve, shrunk toward 1 by peer count so a thin category
// cannot swing a row. Growth and tenure season the result:
//
//   curve      = 10 ^ (intercept + slope x log10(tvl_usd))
//                (intercept and slope fitted on the snapshot's priced peers)
//   adjustment = 1 + (category median ratio / market median ratio - 1) x n / (n + 8)
//                (fewer than 3 peers: no adjustment)
//   growth     = clamp(change_7d, -50, 100) per cent; growthMult = 1 + growth / 100 x 0.5
//   maturity   = 0.70 + 0.30 x min(age_days, 1095) / 1095   (age unknown: the snapshot's median age)
//   implied    = max(1, round(curve x adjustment x growthMult x maturityMult))
//                with the final multiple clamped to 0.02x-1.50x of TVL
//
// The curve is tested blind before it prices anything: the priced peers are split
// in two by slug order, the curve is fitted on one half and asked to predict the
// other half's market caps, then the halves swap. The dashboard reports the blind
// error beside the error of a flat median-multiple baseline on the same folds, so
// the reader sees what the fit bought. No protocol name is ever special-cased: one
// function scores every row, and the dashboard refits the curve from the same peer
// data and recomputes each row, so the screenshots, the code and the board carry
// one set of numbers.
//
// Every row also carries a farm verdict, netted from its own economics: the farm
// cost is the gas the plan spends plus the opportunity cost of the capital it
// locks, and efficiency is the implied value per dollar of that cost. The board's
// own efficiency distribution sets the cutoffs: the top third is FARM, the middle
// third THIN (farm light), the bottom third SKIP (watch only, no capital). The
// farm plan adapts to the verdict, so a SKIP row never asks for money.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  multiple_floor: number;
  multiple_cap: number;
  min_peers: number;
  shrink_prior: number;
  opportunity_rate: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  multiple_floor: 0.02,
  multiple_cap: 1.5,
  min_peers: 3,
  shrink_prior: 8,
  opportunity_rate: 0.1,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'comps-curve-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm verdict: farm it, farm it light, or watch it and spend nothing. */
export type Verdict = 'FARM' | 'THIN' | 'SKIP';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One category's comps adjustment: its median ratio, its peer count, and the shrunk adjustment. */
export interface CategoryFit {
  median: number;
  peers: number;
  adjustment: number;
}

/** The fitted comps curve and its category adjustments, as the dashboard shows them. */
export interface CompsFit {
  intercept: number;
  slope: number;
  r_squared: number;
  peers: number;
  global_median: number;
  by_category: Record<string, CategoryFit>;
}

/** The blind test's result: the curve's held-out error beside the flat baseline's. */
export interface BlindTest {
  folds: number;
  tested: number;
  median_factor: number;
  within_2x: number;
  baseline_median_factor: number;
  baseline_within_2x: number;
}

/** One priced peer, as shipped to the dashboard so the page can refit the curve itself. */
export interface PeerPoint {
  slug: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  verdict: Verdict;
  efficiency: number;
  farm_cost_usd: number;
  capital_usd: number;
  hold_days: number;
  model: {
    curve_value: number;
    category_adjustment: number;
    category_peers: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  verdict: Verdict;
  efficiency: number;
  farm_cost_usd: number;
  capital_usd: number;
  hold_days: number;
  curve_value: number;
  category_adjustment: number;
  category_peers: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fitted curve, the blind test and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: CompsFit;
  blind: BlindTest;
  peers: PeerPoint[];
  verdict_thresholds: { farm_min: number; thin_min: number };
  verdict_counts: Record<Verdict, number>;
  median_age_days: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list, or `fallback` when it holds nothing. */
export function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median listing age of the snapshot's dated protocols, the fallback for an undated one. */
export function medianAgeDays(snapshot: Snapshot): number {
  const ages = snapshot.protocols
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null);
  return Math.round(median(ages, 365));
}

/**
 * The priced peers: protocols that record a market cap and a positive TVL.
 * Exchange tokens are left out, since an exchange's token does not price a protocol.
 */
export function pricedPeers(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
}

/** Least squares on log10 market cap against log10 TVL, over the peers given. */
export function fitCurve(peers: SnapshotProtocol[]): { intercept: number; slope: number; rSquared: number } {
  const xs = peers.map((p) => Math.log10(p.tvl_usd));
  const ys = peers.map((p) => Math.log10(p.mcap_usd!));
  const n = peers.length;
  if (n < 2) return { intercept: 0, slope: 1, rSquared: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    sst += (ys[i]! - my) * (ys[i]! - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  let ssr = 0;
  for (let i = 0; i < n; i++) ssr += (ys[i]! - (intercept + slope * xs[i]!)) ** 2;
  return { intercept, slope, rSquared: sst === 0 ? 0 : 1 - ssr / sst };
}

/** The market-wide median market-cap-to-TVL ratio of the peers given. */
export function medianRatio(peers: SnapshotProtocol[]): number {
  return median(
    peers.map((p) => p.mcap_usd! / p.tvl_usd),
    0.25,
  );
}

/**
 * Each category's adjustment: its median ratio against the market median, shrunk
 * toward 1 by peer count (n / (n + prior)), so a thin category cannot swing a row.
 * Categories under the peer minimum carry no adjustment of their own.
 */
export function categoryAdjustments(peers: SnapshotProtocol[], globalMedian: number, model: ModelConstants): Record<string, CategoryFit> {
  const byCategory = new Map<string, number[]>();
  for (const p of peers) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [p.mcap_usd! / p.tvl_usd]);
    else list.push(p.mcap_usd! / p.tvl_usd);
  }
  const out: Record<string, CategoryFit> = {};
  for (const key of [...byCategory.keys()].sort()) {
    const list = byCategory.get(key)!;
    const med = median(list, globalMedian);
    const shrink = list.length / (list.length + model.shrink_prior);
    out[key] = {
      median: med,
      peers: list.length,
      adjustment: list.length >= model.min_peers ? 1 + (med / globalMedian - 1) * shrink : 1,
    };
  }
  return out;
}

/** The fitted curve and its category adjustments, over the snapshot's priced peers. */
export function compsFit(snapshot: Snapshot, model: ModelConstants): CompsFit {
  const peers = pricedPeers(snapshot);
  const curve = fitCurve(peers);
  const globalMedian = medianRatio(peers);
  return {
    intercept: curve.intercept,
    slope: curve.slope,
    r_squared: curve.rSquared,
    peers: peers.length,
    global_median: globalMedian,
    by_category: categoryAdjustments(peers, globalMedian, model),
  };
}

/** The curve's value for a TVL, before the category adjustment and the seasonal terms. */
export function curveValue(fit: CompsFit, tvlUsd: number): number {
  return 10 ** (fit.intercept + fit.slope * Math.log10(Math.max(1, tvlUsd)));
}

/** The category adjustment one protocol is scored with, and how many peers back it. */
export function adjustmentFor(p: SnapshotProtocol, fit: CompsFit): { adjustment: number; categoryPeers: number } {
  const own = fit.by_category[p.category ?? 'Other'];
  if (own === undefined) return { adjustment: 1, categoryPeers: 0 };
  return { adjustment: own.adjustment, categoryPeers: own.peers };
}

/**
 * The blind test: the priced peers split in two by slug order, the curve and the
 * adjustments fitted on one half and asked to predict the other half's market caps,
 * then the halves swap. Each peer is predicted exactly once, by a fit that never saw
 * it. The flat median-multiple baseline runs the same folds, so the dashboard can
 * show what the fit bought. Errors are median absolute log errors, reported as
 * factors (x3.2 means the typical prediction is within a factor of 3.2 either way).
 */
export function blindTest(peers: SnapshotProtocol[], model: ModelConstants): BlindTest {
  const sorted = [...peers].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const folds: Array<{ train: SnapshotProtocol[]; test: SnapshotProtocol[] }> = [
    { train: sorted.filter((_, i) => i % 2 === 0), test: sorted.filter((_, i) => i % 2 === 1) },
    { train: sorted.filter((_, i) => i % 2 === 1), test: sorted.filter((_, i) => i % 2 === 0) },
  ];
  let factorSum = 0;
  let withinSum = 0;
  let baseFactorSum = 0;
  let baseWithinSum = 0;
  for (const fold of folds) {
    const curve = fitCurve(fold.train);
    const globalMedian = medianRatio(fold.train);
    const adjustments = categoryAdjustments(fold.train, globalMedian, model);
    const errors: number[] = [];
    const baseErrors: number[] = [];
    for (const p of fold.test) {
      const own = adjustments[p.category ?? 'Other'];
      const adj = own === undefined ? 1 : own.adjustment;
      const pred = 10 ** (curve.intercept + curve.slope * Math.log10(p.tvl_usd)) * adj;
      errors.push(Math.abs(Math.log10(pred / p.mcap_usd!)));
      baseErrors.push(Math.abs(Math.log10((p.tvl_usd * globalMedian) / p.mcap_usd!)));
    }
    const log2 = Math.log10(2);
    factorSum += 10 ** median(errors, 0);
    withinSum += errors.filter((e) => e <= log2).length / Math.max(1, errors.length);
    baseFactorSum += 10 ** median(baseErrors, 0);
    baseWithinSum += baseErrors.filter((e) => e <= log2).length / Math.max(1, baseErrors.length);
  }
  return {
    folds: folds.length,
    tested: sorted.length,
    median_factor: factorSum / folds.length,
    within_2x: withinSum / folds.length,
    baseline_median_factor: baseFactorSum / folds.length,
    baseline_within_2x: baseWithinSum / folds.length,
  };
}

/** The multipliers and the implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  fit: CompsFit,
  fallbackAge: number,
): {
  implied: number;
  curve: number;
  adjustment: number;
  categoryPeers: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { adjustment, categoryPeers } = adjustmentFor(protocol, fit);
  const curve = curveValue(fit, protocol.tvl_usd);
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? fallbackAge;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  let implied = Math.max(1, Math.round(curve * adjustment * growthMult * maturityMult));
  const multiple = implied / protocol.tvl_usd;
  if (multiple > model.multiple_cap) implied = Math.round(protocol.tvl_usd * model.multiple_cap);
  else if (multiple < model.multiple_floor) implied = Math.round(protocol.tvl_usd * model.multiple_floor);
  return { implied, curve, adjustment, categoryPeers, growthPct, growthMult, maturityMult, age };
}

/** Whether a protocol records no token at all: no CoinGecko id and no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The protocols the board ranks, strongest first, with ranks 1..n and a verdict each. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const fit = compsFit(snapshot, model);
  const fallbackAge = medianAgeDays(snapshot);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isPreToken(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, fit, fallbackAge);
    const econ = farmEconomics(p, v.age, model);
    return { p, v, econ, efficiency: v.implied / Math.max(0.01, econ.farmCost) };
  });
  // The verdict cutoffs come from the board's own efficiency distribution: the top
  // third farms, the middle third farms light, the bottom third watches.
  const effs = scored.map((s) => s.efficiency).sort((a, b) => a - b);
  const thinMin = effs[Math.floor(effs.length / 3)] ?? 0;
  const farmMin = effs[Math.floor((2 * effs.length) / 3)] ?? 0;
  const verdictOf = (efficiency: number): Verdict => (efficiency >= farmMin ? 'FARM' : efficiency >= thinMin ? 'THIN' : 'SKIP');

  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const verdict = verdictOf(s.efficiency);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.v.age,
      implied_value_usd: s.v.implied,
      verdict,
      efficiency: round2(s.efficiency),
      farm_cost_usd: round2(s.econ.farmCost),
      capital_usd: s.econ.capital,
      hold_days: s.econ.hold,
      model: {
        curve_value: Math.round(s.v.curve),
        category_adjustment: round4(s.v.adjustment),
        category_peers: s.v.categoryPeers,
        growth_pct: round4(s.v.growthPct),
        growth_multiplier: round4(s.v.growthMult),
        maturity_multiplier: round4(s.v.maturityMult),
        age_days: s.v.age,
      },
      farm_steps: farmSteps(s.p, s.v.age, verdict).map(stepText),
    };
  });
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction and one week of activity cost on a chain, in the chain's own fee reality. */
function gasFor(chain: string): { txUsd: number; weekUsd: number; reserve: number; tx: string; week: string } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { txUsd: 9, weekUsd: 10, reserve: 25, tx: 'about $6 to $12 of gas per transaction', week: 'about $10 of gas a week' };
  if (c === 'solana') return { txUsd: 0.05, weekUsd: 0.5, reserve: 5, tx: 'under $0.10 of gas per transaction', week: 'under $1 of gas a week' };
  if (c === 'bitcoin') return { txUsd: 5, weekUsd: 5, reserve: 10, tx: 'about $2 to $8 of network fees per transaction', week: 'about $5 of fees a week' };
  if (c === 'tron') return { txUsd: 0.5, weekUsd: 2, reserve: 5, tx: 'under $1 of energy and bandwidth per transaction', week: 'under $3 of fees a week' };
  return { txUsd: 0.5, weekUsd: 2, reserve: 5, tx: 'under $1 of gas per transaction', week: 'under $3 of gas a week' };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 150;
  return 75;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 30;
}

/**
 * One protocol's farm economics: the capital the plan deploys, the hold, the gas
 * the plan spends, and the farm cost the verdict is netted on — the gas plus the
 * opportunity cost of the locked capital at the model's annual rate. Capital is
 * recoverable, so it is not itself a cost; only its time locked is. A protocol on
 * more than one chain pays one more transaction on its second chain, since the
 * full plan opens a position there too.
 */
export function farmEconomics(p: SnapshotProtocol, age: number | null, model: ModelConstants = MODEL): { capital: number; hold: number; gasTotal: number; farmCost: number } {
  const gas = gasFor(chainOf(p));
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const secondTx = p.chains.length > 1 ? gasFor(p.chains[1]!).txUsd : 0;
  const gasTotal = gas.txUsd + secondTx + gas.weekUsd * Math.ceil(hold / 7);
  const farmCost = gasTotal + capital * (hold / 365) * model.opportunity_rate;
  return { capital, hold, gasTotal, farmCost };
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('borrow')) {
    return `Lend $${capital} of USDC on ${name} (${chain}), borrow up to half its value, and repay a quarter of the loan, so both sides of the book carry your address.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('amm')) {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and set a range that covers the current price, so the position earns fees from day one.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC into ${chain} through ${name}, use the funds once in its app, and bridge a third back a week later to show repeat use.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the liquid receipt token in the same wallet.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('basis')) {
    return `Deposit $${capital} of USDC as margin on ${name} (${chain}), open one small hedged trade, and close it after a day so the account shows real volume.`;
  }
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return `Deposit $${capital} into ${name}'s flagship vault on ${chain} and hold the vault shares, so the position accrues yield and points together.`;
  }
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s tokenized asset on ${chain} and hold it through one full distribution cycle.`;
  if (c.includes('stable')) return `Mint $${capital} of the stable asset through ${name} on ${chain} and place half of it in its stability pool.`;
  if (c.includes('prediction')) return `Fund ${name} with $${capital} on ${chain} and take positions in two different markets, so the account is not a single bet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full hold period.`;
  if (c.includes('launchpad')) return `Commit $${capital} through ${name} on ${chain} and take part in one live sale, keeping the allocation receipt.`;
  if (c.includes('farm') || c.includes('leveraged')) return `Stake $${capital} of LP tokens in ${name}'s farm on ${chain} and claim rewards once a week.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it for the full farming window.`;
  if (c.includes('chain')) return `Move $${capital} onto ${name}'s chain, stake or delegate a portion, and run one transaction a week from the same wallet.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and use its core feature twice in the first week.`;
}

/**
 * A protocol's farm plan, netted to its verdict. FARM gets the full plan: two
 * positions, weekly touches, the full hold. THIN gets a light plan: half the
 * capital, one chain, touches every two weeks, half the hold. SKIP gets a
 * watch plan: no capital, no position, only tracking and a re-check trigger.
 * Every plan is derived from the protocol's own record, never from a list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, verdict: Verdict): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  if (verdict === 'SKIP') {
    return [
      {
        text: `Do not deploy capital into ${p.name}: watch it instead. Check its TVL and its own points or rewards page once a week from a link it publishes.`,
        cost: '$0 of capital and no gas',
        time: '10 minutes a week',
      },
      {
        text: `Re-check the verdict when ${p.name} crosses $50M of TVL, posts two straight weeks of TVL growth, or announces a points program; until then the farm cost outweighs the opportunity.`,
        cost: '$0',
        time: '10 minutes a week',
      },
      {
        text: 'Keep a funded wallet ready on its main chain, with its seed phrase offline, so a re-check that turns the verdict can act the same day.',
        cost: `${gas.tx} to fund the wallet when the time comes`,
        time: '15 minutes once',
      },
    ];
  }
  if (verdict === 'THIN') {
    const thinCapital = Math.floor(capital / 2);
    const thinHold = Math.max(14, Math.floor(hold / 2));
    return [
      {
        text: `Open a fresh wallet that holds only farming funds, move $${thinCapital + gas.reserve} of USDC to ${chain}, and keep the seed phrase offline.`,
        cost: `${gas.tx} to fund the wallet`,
        time: '15 minutes',
      },
      {
        text: actionFor(p, thinCapital, chain),
        cost: `$${thinCapital} of capital and ${gas.tx}`,
        time: '20 minutes to set up',
      },
      {
        text: 'Do one qualifying action every two weeks: a deposit, a swap, a claim, or a vote, each from the same wallet.',
        cost: gas.week,
        time: '10 minutes every two weeks',
      },
      {
        text: `Hold the position for at least ${thinHold} days, check the protocol's own points page from a link it publishes, and log the wallet, the dates and every transaction hash.`,
        cost: `the $${thinCapital} stays in the position`,
        time: `${thinHold} days`,
      },
    ];
  }
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet that holds only farming funds, move $${capital + gas.reserve} of USDC to ${chain}, and keep the seed phrase offline.`,
      cost: `${gas.tx} to fund the wallet`,
      time: '15 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas.tx}`,
      time: '20 minutes to set up',
    },
  ];
  if (second !== null) {
    steps.push({
      text: `Repeat the core position on ${second} with half the capital ($${Math.floor(capital / 2)}), so the wallet is active on two chains the protocol supports.`,
      cost: `$${Math.floor(capital / 2)} of capital and ${gasFor(second).tx}`,
      time: '15 minutes',
    });
  } else {
    steps.push({
      text: `Add a second position in a different pool or vault of ${p.name} on ${chain} with $${Math.floor(capital / 2)}, so the wallet is not a single deposit.`,
      cost: `$${Math.floor(capital / 2)} of capital and ${gas.tx}`,
      time: '15 minutes',
    });
  }
  steps.push(
    {
      text: 'Do one qualifying action every week: a deposit, a swap, a claim, or a vote, each from the same wallet.',
      cost: gas.week,
      time: '10 minutes a week',
    },
    {
      text: `Hold the main position for at least ${hold} days, across at least two snapshot dates, and never exit the whole position in one transaction.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check the protocol's own points or rewards page from a link it publishes, claim only there, and log the wallet, the dates and every transaction hash.`,
      cost: 'nothing to check, and never pay to claim',
      time: '10 minutes',
    },
  );
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    verdict: row.verdict,
    efficiency: row.efficiency,
    farm_cost_usd: row.farm_cost_usd,
    capital_usd: row.capital_usd,
    hold_days: row.hold_days,
    curve_value: row.model.curve_value,
    category_adjustment: row.model.category_adjustment,
    category_peers: row.model.category_peers,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const peers = pricedPeers(snapshot)
    .map((p) => ({ slug: p.slug, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd! }))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const effs = board.map((r) => r.efficiency).sort((a, b) => a - b);
  const verdictCounts: Record<Verdict, number> = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) verdictCounts[r.verdict]++;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit: compsFit(snapshot, model),
    blind: blindTest(pricedPeers(snapshot), model),
    peers,
    verdict_thresholds: {
      farm_min: round2(effs[Math.floor((2 * effs.length) / 3)] ?? 0),
      thin_min: round2(effs[Math.floor(effs.length / 3)] ?? 0),
    },
    verdict_counts: verdictCounts,
    median_age_days: medianAgeDays(snapshot),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, verdicts and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board names a slug twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not a snapshot protocol`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.verdict !== 'FARM' && r.verdict !== 'THIN' && r.verdict !== 'SKIP') return `${r.slug} has verdict ${r.verdict}`;
    if (!Number.isFinite(r.efficiency) || r.efficiency <= 0) return `${r.slug} has efficiency ${r.efficiency}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
