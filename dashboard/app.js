// Token Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the model's
// own inputs, the farm verdict and the protocol's farm plan. No network: every byte it shows is
// in data.js.
//
// The page refits the comps curve from the priced peers with fitCurve, reruns the blind test
// with blindTest, and recomputes every row with impliedOf — the same arithmetic main.ts runs:
// a least-squares curve of log market cap on log TVL, a shrunk category adjustment, a dampened
// growth term and a tenure term, with the final multiple clamped. The farm plan is the same
// derivation too, netted to the row's verdict. Screenshots, code and board carry one set of
// numbers, and the page says so wherever it checks them.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n.toFixed(2) + 'x'; }
  function fmtCost(n) { return '$' + n.toFixed(2); }
  function median(values, fallback) {
    if (!values.length) return fallback;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // The comps curve, fitted in this page from the priced peers main.ts shipped:
  // least squares on log10 market cap against log10 TVL. Exchange tokens are
  // already left out of the peer set; the fit below is the fit the board used.
  function fitCurve(peers) {
    var n = peers.length;
    if (n < 2) return { intercept: 0, slope: 1, rSquared: 0 };
    var xs = peers.map(function (p) { return Math.log10(p.tvl_usd); });
    var ys = peers.map(function (p) { return Math.log10(p.mcap_usd); });
    var mx = xs.reduce(function (a, b) { return a + b; }, 0) / n;
    var my = ys.reduce(function (a, b) { return a + b; }, 0) / n;
    var sxy = 0, sxx = 0, sst = 0, i;
    for (i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) * (xs[i] - mx);
      sst += (ys[i] - my) * (ys[i] - my);
    }
    var slope = sxx === 0 ? 0 : sxy / sxx;
    var intercept = my - slope * mx;
    var ssr = 0;
    for (i = 0; i < n; i++) ssr += Math.pow(ys[i] - (intercept + slope * xs[i]), 2);
    return { intercept: intercept, slope: slope, rSquared: sst === 0 ? 0 : 1 - ssr / sst };
  }
  function medianRatio(peers) {
    return median(peers.map(function (p) { return p.mcap_usd / p.tvl_usd; }), 0.25);
  }
  function adjustmentsFor(peers, globalMedian) {
    var m = DATA.model;
    var byCat = {};
    peers.forEach(function (p) {
      var key = p.category || 'Other';
      (byCat[key] = byCat[key] || []).push(p.mcap_usd / p.tvl_usd);
    });
    var out = {};
    Object.keys(byCat).sort().forEach(function (key) {
      var list = byCat[key];
      var med = median(list, globalMedian);
      var shrink = list.length / (list.length + m.shrink_prior);
      out[key] = {
        median: med,
        peers: list.length,
        adjustment: list.length >= m.min_peers ? 1 + (med / globalMedian - 1) * shrink : 1
      };
    });
    return out;
  }

  // The blind test, rerun in this page: the peers split in two by slug order, the
  // curve fitted on one half and asked to predict the other half, then the halves
  // swap. Each peer is predicted once, by a fit that never saw it. The flat
  // median-multiple baseline runs the same folds.
  function blindTest(peers) {
    var sorted = peers.slice().sort(function (a, b) { return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0; });
    var folds = [
      { train: sorted.filter(function (p, i) { return i % 2 === 0; }), test: sorted.filter(function (p, i) { return i % 2 === 1; }) },
      { train: sorted.filter(function (p, i) { return i % 2 === 1; }), test: sorted.filter(function (p, i) { return i % 2 === 0; }) }
    ];
    var factorSum = 0, withinSum = 0, baseFactorSum = 0, baseWithinSum = 0;
    var log2 = Math.log10(2);
    folds.forEach(function (fold) {
      var curve = fitCurve(fold.train);
      var globalMedian = medianRatio(fold.train);
      var adj = adjustmentsFor(fold.train, globalMedian);
      var errors = [], baseErrors = [];
      fold.test.forEach(function (p) {
        var own = adj[p.category || 'Other'];
        var a = own === undefined ? 1 : own.adjustment;
        var pred = Math.pow(10, curve.intercept + curve.slope * Math.log10(p.tvl_usd)) * a;
        errors.push(Math.abs(Math.log10(pred / p.mcap_usd)));
        baseErrors.push(Math.abs(Math.log10((p.tvl_usd * globalMedian) / p.mcap_usd)));
      });
      factorSum += Math.pow(10, median(errors, 0));
      withinSum += errors.filter(function (e) { return e <= log2; }).length / Math.max(1, errors.length);
      baseFactorSum += Math.pow(10, median(baseErrors, 0));
      baseWithinSum += baseErrors.filter(function (e) { return e <= log2; }).length / Math.max(1, baseErrors.length);
    });
    return {
      folds: folds.length,
      tested: sorted.length,
      median_factor: factorSum / folds.length,
      within_2x: withinSum / folds.length,
      baseline_median_factor: baseFactorSum / folds.length,
      baseline_within_2x: baseWithinSum / folds.length
    };
  }

  var REFIT = fitCurve(DATA.peers);
  var REBLIND = blindTest(DATA.peers);
  var refitAgrees = Math.abs(REFIT.intercept - DATA.fit.intercept) < 1e-9 && Math.abs(REFIT.slope - DATA.fit.slope) < 1e-9;
  var blindAgrees = Math.abs(REBLIND.median_factor - DATA.blind.median_factor) < 1e-9;

  // The model, as the page recomputes it: the fitted curve, the category adjustment
  // from the peer table the program derived, growth clamped and dampened, tenure
  // seasons the result, and the final multiple clamped. One function scores every row.
  function impliedOf(row) {
    var m = DATA.model;
    var curve = Math.pow(10, DATA.fit.intercept + DATA.fit.slope * Math.log10(Math.max(1, row.tvl_usd)));
    var own = DATA.fit.by_category[row.category || 'Other'];
    var adj = own === undefined ? 1 : own.adjustment;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? DATA.median_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var implied = Math.max(1, Math.round(curve * adj * growthMult * maturity));
    var multiple = implied / row.tvl_usd;
    if (multiple > m.multiple_cap) implied = Math.round(row.tvl_usd * m.multiple_cap);
    else if (multiple < m.multiple_floor) implied = Math.round(row.tvl_usd * m.multiple_floor);
    return implied;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan, derived the same way main.ts derives the board's: category, chains,
  // TVL and age decide the action, the capital, the hold and every cost and time, and
  // the verdict decides the shape — full plan, light plan, or watch only. No name is
  // special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasFor(chain) {
    var c = String(chain).toLowerCase();
    if (c === 'ethereum') return { tx: 'about $6 to $12 of gas per transaction', week: 'about $10 of gas a week', reserve: 25 };
    if (c === 'solana') return { tx: 'under $0.10 of gas per transaction', week: 'under $1 of gas a week', reserve: 5 };
    if (c === 'bitcoin') return { tx: 'about $2 to $8 of network fees per transaction', week: 'about $5 of fees a week', reserve: 10 };
    if (c === 'tron') return { tx: 'under $1 of energy and bandwidth per transaction', week: 'under $3 of fees a week', reserve: 5 };
    return { tx: 'under $1 of gas per transaction', week: 'under $3 of gas a week', reserve: 5 };
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 500;
    if (p.tvl_usd >= 250e6) return 250;
    if (p.tvl_usd >= 50e6) return 150;
    return 75;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 90) return 90;
    if (age < 365) return 60;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('borrow') >= 0) return 'Lend $' + capital + ' of USDC on ' + name + ' (' + chain + '), borrow up to half its value, and repay a quarter of the loan, so both sides of the book carry your address.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('amm') >= 0) return 'Add $' + capital + " of liquidity to " + name + "'s deepest pool on " + chain + ' and set a range that covers the current price, so the position earns fees from day one.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC into ' + chain + ' through ' + name + ', use the funds once in its app, and bridge a third back a week later to show repeat use.';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the liquid receipt token in the same wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' (' + chain + '), open one small hedged trade, and close it after a day so the account shows real volume.';
    if (c.indexOf('yield') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'Deposit $' + capital + " into " + name + "'s flagship vault on " + chain + ' and hold the vault shares, so the position accrues yield and points together.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of " + name + "'s tokenized asset on " + chain + ' and hold it through one full distribution cycle.';
    if (c.indexOf('stable') >= 0) return 'Mint $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and place half of it in its stability pool.';
    if (c.indexOf('prediction') >= 0) return 'Fund ' + name + ' with $' + capital + ' on ' + chain + ' and take positions in two different markets, so the account is not a single bet.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active for the full hold period.';
    if (c.indexOf('launchpad') >= 0) return 'Commit $' + capital + ' through ' + name + ' on ' + chain + ' and take part in one live sale, keeping the allocation receipt.';
    if (c.indexOf('farm') >= 0 || c.indexOf('leveraged') >= 0) return 'Stake $' + capital + " of LP tokens in " + name + "'s farm on " + chain + ' and claim rewards once a week.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + " of " + name + "'s index token on " + chain + ' and hold it for the full farming window.';
    if (c.indexOf('chain') >= 0) return 'Move $' + capital + " onto " + name + "'s chain, stake or delegate a portion, and run one transaction a week from the same wallet.";
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and use its core feature twice in the first week.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var gas = gasFor(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var verdict = p.verdict;
    if (verdict === 'SKIP') {
      return [
        { text: 'Do not deploy capital into ' + p.name + ': watch it instead. Check its TVL and its own points or rewards page once a week from a link it publishes.', cost: '$0 of capital and no gas', time: '10 minutes a week' },
        { text: 'Re-check the verdict when ' + p.name + ' crosses $50M of TVL, posts two straight weeks of TVL growth, or announces a points program; until then the farm cost outweighs the opportunity.', cost: '$0', time: '10 minutes a week' },
        { text: 'Keep a funded wallet ready on its main chain, with its seed phrase offline, so a re-check that turns the verdict can act the same day.', cost: gas.tx + ' to fund the wallet when the time comes', time: '15 minutes once' }
      ].map(stepText);
    }
    if (verdict === 'THIN') {
      var thinCapital = Math.floor(capital / 2);
      var thinHold = Math.max(14, Math.floor(hold / 2));
      return [
        { text: 'Open a fresh wallet that holds only farming funds, move $' + (thinCapital + gas.reserve) + ' of USDC to ' + chain + ', and keep the seed phrase offline.', cost: gas.tx + ' to fund the wallet', time: '15 minutes' },
        { text: actionFor(p, thinCapital, chain), cost: '$' + thinCapital + ' of capital and ' + gas.tx, time: '20 minutes to set up' },
        { text: 'Do one qualifying action every two weeks: a deposit, a swap, a claim, or a vote, each from the same wallet.', cost: gas.week, time: '10 minutes every two weeks' },
        { text: 'Hold the position for at least ' + thinHold + ' days, check the protocol\'s own points page from a link it publishes, and log the wallet, the dates and every transaction hash.', cost: 'the $' + thinCapital + ' stays in the position', time: thinHold + ' days' }
      ].map(stepText);
    }
    var second = p.chains && p.chains.length > 1 ? p.chains[1] : null;
    var half = Math.floor(capital / 2);
    var steps = [
      { text: 'Open a fresh wallet that holds only farming funds, move $' + (capital + gas.reserve) + ' of USDC to ' + chain + ', and keep the seed phrase offline.', cost: gas.tx + ' to fund the wallet', time: '15 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas.tx, time: '20 minutes to set up' }
    ];
    if (second !== null) {
      steps.push({ text: 'Repeat the core position on ' + second + ' with half the capital ($' + half + '), so the wallet is active on two chains the protocol supports.', cost: '$' + half + ' of capital and ' + gasFor(second).tx, time: '15 minutes' });
    } else {
      steps.push({ text: 'Add a second position in a different pool or vault of ' + p.name + ' on ' + chain + ' with $' + half + ', so the wallet is not a single deposit.', cost: '$' + half + ' of capital and ' + gas.tx, time: '15 minutes' });
    }
    steps.push(
      { text: 'Do one qualifying action every week: a deposit, a swap, a claim, or a vote, each from the same wallet.', cost: gas.week, time: '10 minutes a week' },
      { text: 'Hold the main position for at least ' + hold + ' days, across at least two snapshot dates, and never exit the whole position in one transaction.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Check the protocol's own points or rewards page from a link it publishes, claim only there, and log the wallet, the dates and every transaction hash.", cost: 'nothing to check, and never pay to claim', time: '10 minutes' }
    );
    return steps.map(stepText);
  }

  function verdictNote(row) {
    if (row.verdict === 'FARM') return 'Top third of the board by implied value per dollar of farm cost: farm it in full.';
    if (row.verdict === 'THIN') return 'Middle third of the board by implied value per dollar of farm cost: farm it light — half the capital, one chain, half the hold.';
    return 'Bottom third of the board by implied value per dollar of farm cost: watch it, deploy nothing.';
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'efficiency') { av = a.efficiency; bv = b.efficiency; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'rings', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name' }, 'Token ', el('b', { text: 'Launch Radar' }))
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { class: 'dot', text: 'DefiLlama protocol index' }),
        el('span', { class: 'dot', text: DATA.model_version + ' model' })
      )
    );
  }

  function hero() {
    var top = DATA.rows[0];
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', { text: 'Every protocol with no token on record, ranked by what its launch could be worth' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ',
          el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL' }),
          ' and no token on record. The early radar adds ',
          el('b', { text: DATA.early_size + ' pre-token protocols below that floor' }),
          ', found early. A comps curve fitted to the snapshot\u2019s own priced peers prices every row, tested blind before it prices anything, and each row is netted to ',
          el('b', { text: 'FARM, THIN or SKIP' }),
          ' on what farming it costs. Implied value is a model of the snapshot, not a promise of a launch.'
        )
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat hot' }, el('b', { text: fmtUsd(top ? top.implied_value_usd : 0) }), el('span', { text: 'Top implied value' + (top ? ' · ' + top.name : '') })),
        el('div', { class: 'stat' }, el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('span', { text: 'Watchlist covered' })),
        el('div', { class: 'stat' }, el('b', { text: 'x' + DATA.blind.median_factor.toFixed(2) }), el('span', { text: 'Blind-test median error, vs x' + DATA.blind.baseline_median_factor.toFixed(2) + ' flat baseline' })),
        el('div', { class: 'stat' }, el('b', { text: DATA.verdict_counts.FARM + ' / ' + DATA.verdict_counts.THIN + ' / ' + DATA.verdict_counts.SKIP }), el('span', { text: 'FARM / THIN / SKIP verdicts' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category, chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length + ')', selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var verdictSelect = el('select', { id: 'verdict', 'aria-label': 'Filter by farm verdict' },
      el('option', { value: 'all', text: 'All verdicts' }),
      ['FARM', 'THIN', 'SKIP'].map(function (v) { return el('option', { value: v, text: v + ' (' + DATA.verdict_counts[v] + ')', selected: v === state.verdict ? 'selected' : null }); })
    );
    verdictSelect.addEventListener('change', function () { state.verdict = verdictSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field grow' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), verdictSelect),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or verdict to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; writeHash(); render(); } })
      ));
    }
    var max = 0;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    if (max <= 0) max = 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'pill ' + r.verdict.toLowerCase(), text: r.verdict })),
        el('td', null, el('span', { class: 'pill ' + (r.watchlist ? 'watch' : 'early'), text: r.watchlist ? 'Watchlist' : 'Early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown, its farm verdict and its farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('efficiency', 'Verdict'),
            el('th', { scope: 'col', text: 'Board' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'pill live', text: 'Live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'sub', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their prices fit the curve that prices it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var fit = DATA.fit;
    var cats = Object.keys(fit.by_category).sort(function (a, b) { return fit.by_category[b].adjustment - fit.by_category[a].adjustment; });
    var grid = el('div', { class: 'mult-grid' },
      cats.map(function (c) {
        var f = fit.by_category[c];
        return el('div', { class: 'mult' }, el('span', { text: c + ' (' + f.peers + ' peers)' }), el('b', { text: 'x' + f.adjustment.toFixed(2) }));
      })
    );
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed ' }, el('span', { class: 'tag', text: DATA.model_version })),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The curve is fitted on the snapshot\u2019s priced peers and tested blind before it prices anything.' }),
      el('div', { class: 'formula' },
        el('span', { text: 'curve = 10 ^ (' + fit.intercept.toFixed(3) + ' + ' + fit.slope.toFixed(3) + ' x log10(tvl_usd))   ·   fitted by least squares on ' + fit.peers + ' priced peers, R\u00B2 ' + fit.r_squared.toFixed(3) }),
        'implied = round( curve x adjustment x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )',
        el('span', { text: '   ·   adjustment = 1 + (category median mcap/TVL / market median ' + fit.global_median.toFixed(3) + ' \u2212 1) x n / (n + ' + m.shrink_prior + '); under ' + m.min_peers + ' peers, no adjustment. Final multiple clamped to ' + m.multiple_floor + 'x\u2013' + m.multiple_cap + 'x of TVL.' })
      ),
      el('div', { class: 'mult-grid' },
        el('div', { class: 'mult global' }, el('span', { text: 'Blind test: median error on held-out peers' }), el('b', { text: 'x' + DATA.blind.median_factor.toFixed(2) })),
        el('div', { class: 'mult' }, el('span', { text: 'Held-out peers within 2x of their market cap' }), el('b', { text: Math.round(DATA.blind.within_2x * 100) + '%' })),
        el('div', { class: 'mult' }, el('span', { text: 'Flat median-multiple baseline, same folds' }), el('b', { text: 'x' + DATA.blind.baseline_median_factor.toFixed(2) })),
        el('div', { class: 'mult' }, el('span', { text: 'Baseline within 2x' }), el('b', { text: Math.round(DATA.blind.baseline_within_2x * 100) + '%' }))
      ),
      el('p', { class: 'sub', text: 'Blind test: ' + DATA.blind.folds + ' folds over ' + DATA.blind.tested + ' priced peers, split by slug order; each peer is predicted once, by a fit that never saw it. This page refits the curve from the same peer data (' + (refitAgrees ? 'intercept ' + REFIT.intercept.toFixed(3) + ', slope ' + REFIT.slope.toFixed(3) + ' — the same curve the board used' : 'and the refit differs from the board\u2019s curve: the data would be stale') + ') and reruns the blind test (' + (blindAgrees ? 'the same median error' : 'a different median error') + ').' }),
      grid,
      el('p', { class: 'sub', text: 'Farm verdict: farm cost is the gas the plan spends plus the opportunity cost of its locked capital at ' + Math.round(m.opportunity_rate * 100) + '% a year; efficiency is the implied value per dollar of farm cost. The board\u2019s own efficiency distribution sets the cutoffs — FARM above ' + Math.round(DATA.verdict_thresholds.farm_min).toLocaleString('en-US') + ', THIN above ' + Math.round(DATA.verdict_thresholds.thin_min).toLocaleString('en-US') + ', SKIP below — so ' + DATA.verdict_counts.FARM + ' rows farm in full, ' + DATA.verdict_counts.THIN + ' farm light and ' + DATA.verdict_counts.SKIP + ' are watched, not farmed. Efficiency is a relative yardstick for ranking farm effort, never an expected payout: the farmer\u2019s share of any launch is unknown.' }),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses the snapshot\'s median age of ' + DATA.median_age_days + ' days.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row);
    var adjNote = row.category_peers >= DATA.model.min_peers
      ? 'Category adjustment x' + row.category_adjustment.toFixed(2) + ' from ' + row.category_peers + ' priced peers in ' + (row.category || 'Other')
      : 'No category adjustment: ' + (row.category || 'Other') + ' has only ' + row.category_peers + ' priced peer' + (row.category_peers === 1 ? '' : 's');
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'pill ' + (row.watchlist ? 'watch' : 'early'), text: (row.watchlist ? 'Watchlist' : 'Early') + ' · Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' · records no token (no CoinGecko id, no symbol)' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var allChains = row.chains || [];
    var chainEls = allChains.slice(0, 8).map(function (c) { return el('span', { class: 'chip', text: c }); });
    if (allChains.length > 8) chainEls.push(el('span', { class: 'chip', text: '+' + (allChains.length - 8) + ' more' }));
    dialog.appendChild(el('div', { class: 'chips' }, chainEls));
    dialog.appendChild(el('div', { class: 'verdict ' + row.verdict.toLowerCase() },
      el('b', { text: row.verdict }),
      el('span', { text: verdictNote(row) })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Comps curve value' }), el('b', { class: 'num', text: fmtUsd(row.curve_value) })),
        el('div', null, el('span', { text: 'Category adjustment' }), el('b', { class: 'num', text: 'x' + row.category_adjustment.toFixed(2) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + ' → x' + row.growth_multiplier.toFixed(2) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + ' → x' + row.maturity_multiplier.toFixed(2) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'check', text: adjNote + '. ' }),
      el('p', { class: 'check' },
        'Model ' + DATA.model_version + ': the page recomputes this row as ',
        el('b', { text: fmtUsd(recomputed) }),
        recomputed === row.implied_value_usd ? ', the same number the board carries.' : ', which differs from the board: the data would be stale.',
        ' This is an estimate from the snapshot, not a price and not a promise of a launch.'
      )
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm economics' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Farm cost (gas + locked-capital cost)' }), el('b', { class: 'num', text: fmtCost(row.farm_cost_usd) })),
        el('div', null, el('span', { text: 'Capital deployed' }), el('b', { class: 'num', text: fmtUsd(row.capital_usd) })),
        el('div', null, el('span', { text: 'Hold' }), el('b', { class: 'num', text: row.hold_days + ' days' })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value per $1 of farm cost' }), el('b', { class: 'num', text: '$' + Math.round(row.efficiency).toLocaleString('en-US') }))
      ),
      el('p', { class: 'check', text: 'FARM above $' + Math.round(DATA.verdict_thresholds.farm_min).toLocaleString('en-US') + ' per $1, THIN above $' + Math.round(DATA.verdict_thresholds.thin_min).toLocaleString('en-US') + ' per $1 — cutoffs from this board\u2019s own distribution. A yardstick for ranking effort, never an expected payout.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'foot', text: 'Data: ' + DATA.source + '. A protocol is shown as pre-token when its snapshot entry records no token; the record is not proof it has none. Implied values are the entry\'s own model, never a claim by make.fun.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  // A hash change from outside (a shared link, the back button) re-reads the
  // state and re-renders; writeHash uses replaceState, so this never loops.
  window.addEventListener('hashchange', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.tab = 'pre-token'; state.selected = null;
    readHash();
    render();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
