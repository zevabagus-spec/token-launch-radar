// The token radar's model: the sealed snapshot in, one ranked board out.
//
// The board ranks pre-token protocols only: a protocol records no token when its
// snapshot entry carries neither a CoinGecko id nor a symbol. Every watchlist slug
// is ranked, and the early radar adds the 160 highest-TVL pre-token protocols below
// the watchlist floor. Protocols whose token already trades are kept apart: the
// dashboard shows their market caps as facts, never as model output.
//
// Implied value is derived from the snapshot's own market, not from a fixed
// constant. The snapshot's token-having protocols are the peer set: for each
// category, the multiple is the median market-cap-to-TVL ratio of its priced
// peers, when the category has at least three of them; otherwise the market-wide
// median is used. The multiple is clamped, growth is dampened, and tenure
// seasons the result:
//
//   multiple   = clamp(median(mcap_usd / tvl_usd) of the category's priced peers, 0.05, 1.00)
//                (fewer than 3 peers: the market-wide median instead)
//   growth     = clamp(change_7d, -50, 100) per cent; growthMult = 1 + growth / 100 x 0.5
//   maturity   = 0.70 + 0.30 x min(age_days, 1095) / 1095   (age unknown: the snapshot's median age)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity))
//
// No protocol name is ever special-cased: one function scores every row, and the
// dashboard recomputes each row from the same figures.

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
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  min_peers: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'peer-median-1';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
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
  model: {
    multiple: number;
    multiple_source: 'category' | 'global';
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
  multiple: number;
  multiple_source: 'category' | 'global';
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

/** The peer multiples the model derived, as the dashboard shows them. */
export interface PeerTable {
  global: number;
  peer_total: number;
  by_category: Record<string, number>;
  peers: Record<string, number>;
}

/** Everything the dashboard needs: the board, the live set, the multiples and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  multiples: PeerTable;
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
 * The market's own multiples: the median market-cap-to-TVL ratio of the priced
 * peers in each category, and the market-wide median. A priced peer records a
 * market cap and a positive TVL; exchange tokens are left out, since an
 * exchange's token does not price a protocol. Categories with too few peers
 * carry no multiple of their own and fall back to the market-wide one.
 */
export function peerMultiples(snapshot: Snapshot, model: ModelConstants): PeerTable {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (p.category === 'CEX') continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = clamp(median(all, 0.25), model.multiple_floor, model.multiple_cap);
  const multiples: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const key of [...byCategory.keys()].sort()) {
    const list = byCategory.get(key)!;
    counts[key] = list.length;
    if (list.length >= model.min_peers) multiples[key] = clamp(median(list, global), model.multiple_floor, model.multiple_cap);
  }
  return { global, peer_total: all.length, by_category: multiples, peers: counts };
}

/** The multiple one protocol is scored with, and where it came from. */
export function multipleFor(p: SnapshotProtocol, peers: PeerTable): { multiple: number; source: 'category' | 'global'; categoryPeers: number } {
  const key = p.category ?? 'Other';
  const own = peers.by_category[key];
  if (own !== undefined) return { multiple: own, source: 'category', categoryPeers: peers.peers[key] ?? 0 };
  return { multiple: peers.global, source: 'global', categoryPeers: peers.peers[key] ?? 0 };
}

/** The multipliers and the implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  peers: PeerTable,
  fallbackAge: number,
): { implied: number; multiple: number; source: 'category' | 'global'; categoryPeers: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, source, categoryPeers } = multipleFor(protocol, peers);
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? fallbackAge;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, source, categoryPeers, growthPct, growthMult, maturityMult, age };
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

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerMultiples(snapshot, model);
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
    const v = impliedValue(p, snapshot.as_of, model, peers, fallbackAge);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    model: {
      multiple: round4(s.v.multiple),
      multiple_source: s.v.source,
      category_peers: s.v.categoryPeers,
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
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
function gasFor(chain: string): { tx: string; week: string; reserve: number } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { tx: 'about $6 to $12 of gas per transaction', week: 'about $10 of gas a week', reserve: 25 };
  if (c === 'solana') return { tx: 'under $0.10 of gas per transaction', week: 'under $1 of gas a week', reserve: 5 };
  if (c === 'bitcoin') return { tx: 'about $2 to $8 of network fees per transaction', week: 'about $5 of fees a week', reserve: 10 };
  if (c === 'tron') return { tx: 'under $1 of energy and bandwidth per transaction', week: 'under $3 of fees a week', reserve: 5 };
  return { tx: 'under $1 of gas per transaction', week: 'under $3 of gas a week', reserve: 5 };
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
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
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
    multiple: row.model.multiple,
    multiple_source: row.model.multiple_source,
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
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    multiples: peerMultiples(snapshot, model),
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
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
