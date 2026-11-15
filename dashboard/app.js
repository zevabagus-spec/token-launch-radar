// Token Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the model's
// own inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// The page recomputes every row from the snapshot figures with impliedOf, the same arithmetic
// main.ts runs: a category multiple taken from the snapshot's own priced peers, a dampened growth
// term and a tenure term. The farm plan is the same derivation too. Screenshots, code and board
// carry one set of numbers.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

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

  // The model, as the page recomputes it: the category multiple comes from the peer table the
  // program derived (categories with too few priced peers fall back to the market-wide median),
  // growth is clamped and dampened, tenure seasons the result. One function scores every row.
  function impliedOf(row) {
    var m = DATA.model;
    var key = row.category || 'Other';
    var multiple = DATA.multiples.by_category[key];
    if (multiple === undefined) multiple = DATA.multiples.global;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? DATA.median_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturity));
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

  // The farm plan, derived the same way main.ts derives the board's: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
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

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
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
          ', found early. Implied value is a model of the snapshot, not a promise of a launch.'
        )
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat hot' }, el('b', { text: fmtUsd(top ? top.implied_value_usd : 0) }), el('span', { text: 'Top implied value' + (top ? ' · ' + top.name : '') })),
        el('div', { class: 'stat' }, el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('span', { text: 'Watchlist covered' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'Pre-token rows scored' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.multiples.peer_total) }), el('span', { text: 'Priced peers set the multiples' }))
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
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field grow' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
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
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
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
        el('td', null, el('span', { class: 'pill ' + (r.watchlist ? 'watch' : 'early'), text: r.watchlist ? 'Watchlist' : 'Early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
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
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their multiples price it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cats = Object.keys(DATA.multiples.by_category).sort(function (a, b) { return DATA.multiples.by_category[b] - DATA.multiples.by_category[a]; });
    var grid = el('div', { class: 'mult-grid' },
      el('div', { class: 'mult global' }, el('span', { text: 'Market-wide median (' + DATA.multiples.peer_total + ' peers)' }), el('b', { text: fmtMult(DATA.multiples.global) })),
      cats.map(function (c) {
        return el('div', { class: 'mult' }, el('span', { text: c + ' (' + DATA.multiples.peers[c] + ' peers)' }), el('b', { text: fmtMult(DATA.multiples.by_category[c]) }));
      })
    );
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed ' }, el('span', { class: 'tag', text: DATA.model_version })),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        el('span', { text: 'implied = round( tvl_usd x ' }),
        'multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )',
        el('span', { text: '   ·   multiple = median market-cap / TVL of the category\'s priced peers, clamped to ' + m.multiple_floor + '–' + m.multiple_cap + '; under ' + m.min_peers + ' peers, the market-wide median.' })
      ),
      grid,
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses the snapshot\'s median age of ' + DATA.median_age_days + ' days. The multiple is the market speaking: what token-having protocols in the same line of business are actually worth per dollar of TVL.' })
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
    var multNote = row.multiple_source === 'category'
      ? 'Category multiple from ' + row.category_peers + ' priced peers in ' + (row.category || 'Other')
      : 'Market-wide median: ' + (row.category || 'Other') + ' has only ' + row.category_peers + ' priced peer' + (row.category_peers === 1 ? '' : 's');
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
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(row.multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + ' → x' + row.growth_multiplier.toFixed(2) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + ' → x' + row.maturity_multiplier.toFixed(2) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'check', text: multNote + '. ' }),
      el('p', { class: 'check' },
        'Model ' + DATA.model_version + ': the page recomputes this row as ',
        el('b', { text: fmtUsd(recomputed) }),
        recomputed === row.implied_value_usd ? ', the same number the board carries.' : ', which differs from the board: the data would be stale.',
        ' This is an estimate from the snapshot, not a price and not a promise of a launch.'
      )
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
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.tab = 'pre-token'; state.selected = null;
    readHash();
    render();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
