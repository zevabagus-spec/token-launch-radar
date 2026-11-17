// Token Launch Radar — page logic.
//
// The page does not trust the shipped numbers: it re-derives the comps
// curve, the category adjustments, the five-fold blind test and every
// implied value from the priced-peer data shipped beside it, using the
// same arithmetic as the program that wrote the board, and it re-derives
// every farm plan from the same rules, then checks both recomputations
// against the board's rows. The figures in the hero and the model section
// are the recomputed ones.
(function () {
  "use strict";
  var DATA = window.__RADAR__;
  var GROWTH_WEIGHT = 0.5;
  var MATURITY_FLOOR = 0.7;
  var MATURITY_SPAN = 1095;
  var MULT_FLOOR = 0.02;
  var MULT_CAP = 1.5;
  var SHRINK_PRIOR = 8;
  var MIN_PEERS = 3;
  var FOLDS = 5;

  function $(id) { return document.getElementById(id); }
  function median(values, fallback) {
    if (!values.length) return fallback;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function money(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n);
  }
  function smallMoney(n) { return n < 1 ? "$" + n.toFixed(2) : "$" + Math.round(n); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // --- Model, re-derived in the page ------------------------------------
  function fitCurve(peers) {
    var xs = peers.map(function (p) { return Math.log10(Math.max(1, p.tvl_usd)); });
    var ys = peers.map(function (p) { return Math.log10(Math.max(1, p.mcap_usd)); });
    var mx = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
    var my = ys.reduce(function (a, b) { return a + b; }, 0) / ys.length;
    var sxy = 0, sxx = 0, i;
    for (i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); }
    var slope = sxx === 0 ? 0 : sxy / sxx;
    var intercept = my - slope * mx;
    var ssTot = 0, ssRes = 0;
    for (i = 0; i < xs.length; i++) {
      var pred = intercept + slope * xs[i];
      ssTot += (ys[i] - my) * (ys[i] - my);
      ssRes += (ys[i] - pred) * (ys[i] - pred);
    }
    return { intercept: intercept, slope: slope, r2: ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot) };
  }
  function fitModel(peers) {
    var curve = fitCurve(peers);
    var globalMultiple = median(peers.map(function (p) { return p.mcap_usd / Math.max(1, p.tvl_usd); }), 0.25);
    var byCat = {};
    peers.forEach(function (p) {
      (byCat[p.category] = byCat[p.category] || []).push(p.mcap_usd / Math.max(1, p.tvl_usd));
    });
    var adj = {};
    Object.keys(byCat).sort().forEach(function (key) {
      var multiples = byCat[key];
      var med = median(multiples, globalMultiple);
      var shrink = multiples.length / (multiples.length + SHRINK_PRIOR);
      adj[key] = {
        peers: multiples.length,
        medianMultiple: med,
        adjustment: multiples.length >= MIN_PEERS ? 1 + (med / globalMultiple - 1) * shrink : 1
      };
    });
    return { intercept: curve.intercept, slope: curve.slope, r2: curve.r2, peers: peers.length, globalMultiple: globalMultiple, byCategory: adj };
  }
  function growthMult(change7d) {
    var g = Math.max(-50, Math.min(100, change7d == null ? 0 : change7d));
    return 1 + (g / 100) * GROWTH_WEIGHT;
  }
  function maturityMult(ageDays) {
    return MATURITY_FLOOR + (1 - MATURITY_FLOOR) * (Math.min(ageDays, MATURITY_SPAN) / MATURITY_SPAN);
  }
  function priceRow(fit, tvl, category, change7d, ageDays) {
    var adj = fit.byCategory[category] ? fit.byCategory[category].adjustment : 1;
    var curveValue = Math.pow(10, fit.intercept + fit.slope * Math.log10(Math.max(1, tvl)));
    var growth = growthMult(change7d);
    var maturity = maturityMult(ageDays);
    var raw = Math.max(1, Math.round(curveValue * adj * growth * maturity));
    var floorValue = Math.max(1, Math.round(tvl * MULT_FLOOR));
    var capValue = Math.max(1, Math.round(tvl * MULT_CAP));
    var implied = raw, clamp = null;
    if (implied < floorValue) { implied = floorValue; clamp = "floor"; }
    else if (implied > capValue) { implied = capValue; clamp = "cap"; }
    return { curveValue: Math.round(curveValue), adjustment: adj, growth: growth, maturity: maturity, raw: raw, implied: implied, clamp: clamp };
  }
  function blindTest(peers) {
    var sorted = peers.slice().sort(function (a, b) { return a.slug < b.slug ? -1 : 1; });
    var foldErr = [], foldBase = [], folds = [], k, i;
    for (k = 0; k < FOLDS; k++) {
      var train = sorted.filter(function (_, i) { return i % FOLDS !== k; });
      var test = sorted.filter(function (_, i) { return i % FOLDS === k; });
      var fit = fitModel(train);
      var baseMultiple = median(train.map(function (p) { return p.mcap_usd / Math.max(1, p.tvl_usd); }), 0.25);
      var errs = [], baseErrs = [];
      test.forEach(function (p) {
        var actual = Math.max(1, p.mcap_usd);
        var pred = priceRow(fit, p.tvl_usd, p.category, p.change_7d, p.ageDays).implied;
        errs.push(Math.abs(Math.log10(pred / actual)));
        var base = Math.min(Math.max(Math.max(1, Math.round(p.tvl_usd * baseMultiple)), Math.round(p.tvl_usd * MULT_FLOOR)), Math.round(p.tvl_usd * MULT_CAP));
        baseErrs.push(Math.abs(Math.log10(Math.max(1, base) / actual)));
      });
      foldErr.push(errs); foldBase.push(baseErrs);
      folds.push({ fold: k + 1, peers: test.length, medianFactor: Math.pow(10, median(errs, 0)), baselineMedianFactor: Math.pow(10, median(baseErrs, 0)) });
    }
    var all = foldErr.flat(), allBase = foldBase.flat(), log2 = Math.log10(2);
    return {
      folds: folds,
      medianFactor: Math.pow(10, median(all, 0)),
      within2x: all.length ? all.filter(function (e) { return e <= log2; }).length / all.length : 0,
      baselineMedianFactor: Math.pow(10, median(allBase, 0)),
      baselineWithin2x: allBase.length ? allBase.filter(function (e) { return e <= log2; }).length / allBase.length : 0,
      peers: sorted.length
    };
  }

  var fit = fitModel(DATA.peers);
  var blind = blindTest(DATA.peers);
  var recomputed = DATA.rows.map(function (r) {
    return priceRow(fit, r.tvl_usd, r.category, r.change_7d, r.ageDays == null ? DATA.medianAgeDays : r.ageDays);
  });
  var matches = DATA.rows.filter(function (r, i) { return recomputed[i].implied === r.implied_value_usd; }).length;

  // --- Farm plans, re-derived in the page --------------------------------
  // Same rules as the program: gas tiers by first chain, capital by TVL,
  // hold by tenure, verdict-adapted steps, every step costed and timed.
  var GAS_PER_TX = { Ethereum: 6, Solana: 0.05, Bitcoin: 3, Tron: 2 };
  function gasPerTx(chains) { return GAS_PER_TX[chains[0]] !== undefined ? GAS_PER_TX[chains[0]] : 0.4; }
  function riskLine(category) {
    switch (category) {
      case "Dexs": return "Risk: impermanent loss if the pair moves against you, so size the position to what you can leave untouched.";
      case "Lending": return "Risk: liquidation if collateral falls, so borrow well below the limit and watch the health factor.";
      case "Bridge": case "Canonical Bridge": return "Risk: bridge exploits strand funds mid-route, so never leave value sitting in transit.";
      case "Liquid Staking": case "Liquid Restaking": case "Restaked BTC": return "Risk: slashing and unstaking delays, so treat the stake as locked for the full hold.";
      case "Derivatives": case "Perps": return "Risk: funding fees and liquidation on leverage, so keep positions small and unleveraged where the plan allows.";
      case "RWA": return "Risk: issuer and custody risk behind the tokenised asset, so read who holds the underlying before committing.";
      case "Yield": case "Yield Aggregator": return "Risk: vault strategies change and yields compress, so re-check the vault's holdings before each deposit.";
      default: return "Risk: smart-contract risk on every interaction, so only commit funds you can afford to lose outright.";
    }
  }
  function primaryAction(category) {
    switch (category) {
      case "Dexs": return "add liquidity to the highest-volume pool";
      case "Lending": return "supply the largest collateral asset";
      case "Bridge": case "Canonical Bridge": return "bridge a small amount on the main route";
      case "Liquid Staking": case "Liquid Restaking": case "Restaked BTC": return "stake the base asset through the protocol";
      case "Derivatives": case "Perps": return "open a small position on the most liquid market";
      case "RWA": return "buy the smallest available allocation of the flagship asset";
      case "Yield": case "Yield Aggregator": return "deposit into the flagship vault";
      default: return "use the protocol's main product once, end to end";
    }
  }
  function secondAction(category) {
    switch (category) {
      case "Dexs": return "swap through the router on a second pair, so trading and liquidity both carry your address";
      case "Lending": return "borrow a small amount against the supply, so both sides of the book carry your address";
      case "Bridge": case "Canonical Bridge": return "bridge back on a different route, so more than one path carries your address";
      case "Liquid Staking": case "Liquid Restaking": case "Restaked BTC": return "use the receipt token once in a supported venue, so the stake is visibly active";
      case "Derivatives": case "Perps": return "close and reopen once, so the position history shows repeat use rather than a single touch";
      case "RWA": return "hold the allocation through one full distribution cycle, so the holding is visibly seasoned";
      case "Yield": case "Yield Aggregator": return "deposit into a second vault, so the activity is not a single-vault touch";
      default: return "repeat the main product a second time on a different day, so the history shows repeat use";
    }
  }
  function stepText(s) {
    var t = s.replace(/\s+/g, " ").trim();
    return t.length > 600 ? t.slice(0, 597) + "..." : t;
  }
  function derivePlan(r) {
    var chain = r.chains[0] || "its main chain";
    var category = r.category;
    var gas = gasPerTx(r.chains);
    var steps = [];
    if (r.verdict === "SKIP") {
      var triggerTvl = Math.round(r.tvl_usd * 1.25);
      steps.push(stepText("Watch only: track " + r.name + " on " + chain + " for free, about 10 minutes a week, and spend $0 — the value on offer does not pay for a farm at today's size. " + riskLine(category)));
      steps.push(stepText("Note the baseline today: " + money(r.tvl_usd) + " of TVL" + (r.change_7d === null ? "" : ", " + (r.change_7d >= 0 ? "+" : "") + r.change_7d.toFixed(1) + "% over seven days") + ", so a later move is measured against a number you wrote down, not a feeling. Cost: $0, 10 minutes."));
      steps.push(stepText("Re-check only when " + r.name + " grows 25% from " + money(r.tvl_usd) + " to about " + money(triggerTvl) + ", posts two straight weeks of TVL growth, or announces a points program — whichever comes first. Until one of those happens, the SKIP verdict stands and no funds go in."));
      return steps;
    }
    var capital = r.verdict === "FARM" ? r.econ.capitalUsd : Math.round(r.econ.capitalUsd / 2);
    var hold = r.verdict === "FARM" ? r.econ.holdDays : Math.max(14, Math.round(r.econ.holdDays / 2));
    var bridgeCost = smallMoney(gas * 2);
    steps.push(stepText("Bridge " + smallMoney(capital) + " to " + chain + " and keep a separate gas reserve of about " + bridgeCost + ". Cost: roughly " + bridgeCost + " in gas and bridge fees, about 30 minutes including confirmations. Do not start with the full amount until the first transaction confirms."));
    steps.push(stepText("With " + smallMoney(capital) + ", " + primaryAction(category) + " on " + chain + ". Cost: about " + smallMoney(gas) + " in gas, about 15 minutes. Keep the receipt or position token in the same wallet for the whole hold."));
    if (r.verdict === "FARM") {
      steps.push(stepText("Then " + secondAction(category) + ". Cost: about " + smallMoney(gas) + " in gas, about 15 minutes. Two distinct actions leave a stronger on-chain trail than one large deposit."));
    }
    steps.push(stepText("Hold the position for " + hold + " days, checking in once a week for about 10 minutes. Opportunity cost at a 10% annual rate is about " + smallMoney(Math.round(((capital * hold) / 365) * 0.1 * 100) / 100) + ". " + riskLine(category)));
    steps.push(stepText("Record the wallet, the position and the dates in a note today, and re-check " + r.name + " against this radar after the hold: if its implied value or verdict has improved, extend; if TVL has fallen two weeks running, exit. Cost: $0, 10 minutes."));
    return steps;
  }
  var derivedPlans = DATA.rows.map(derivePlan);
  var planMatches = DATA.rows.filter(function (r, i) {
    return JSON.stringify(derivedPlans[i]) === JSON.stringify(r.farm_steps);
  }).length;

  // --- Hero and model section -------------------------------------------
  function setField(name, text) {
    document.querySelectorAll('[data-field="' + name + '"]').forEach(function (el) { el.textContent = text; });
  }
  var watchCovered = DATA.rows.filter(function (r) { return r.onWatchlist; }).length;
  setField("asOf", DATA.asOf);
  setField("watchlistCover", watchCovered + "/" + DATA.watchlistCount);
  setField("rankedCount", String(DATA.rankedCount));
  setField("setAsideCount", String(DATA.setAsideCount));
  setField("blindError", "x" + blind.medianFactor.toFixed(2));
  setField("baselineError", "x" + blind.baselineMedianFactor.toFixed(2));
  var accountingEl = document.querySelector('[data-field="accounting"]');
  accountingEl.innerHTML = "All <strong>" + DATA.totalProtocols + "</strong> protocols accounted for: <strong>" +
    DATA.rankedCount + "</strong> ranked · <strong>" + DATA.setAsideCount + "</strong> set aside with reasons · <strong>" +
    DATA.liveCount + "</strong> already record a token.";
  setField("sourceLine", "Source: " + DATA.source + " · Floor: " + money(DATA.floorUsd) + " · Model: " + DATA.modelVersion + ".");
  $("modelIntro").textContent =
    "The value model is fitted on " + fit.peers + " priced peers — protocols with a market cap, TVL above zero, " +
    "excluding centralised exchanges — and every figure on this page is recomputed in the browser from that peer data. " +
    "The recomputation matches the shipped board on " + matches + " of " + DATA.rows.length + " rows, and the farm plans " +
    "re-derived in the page match the board's plans on " + planMatches + " of " + DATA.rows.length + " rows.";
  $("curveLine").textContent =
    "log10(market cap) = " + fit.intercept.toFixed(3) + " + " + fit.slope.toFixed(3) + " x log10(TVL), R² " +
    fit.r2.toFixed(3) + ". The fit is weak — TVL alone explains only part of a token's value — which is why the blind test below, not the fit, is the honest measure of the model.";
  $("blindLine").textContent =
    "Blind test on " + blind.peers + " priced peers, five folds: median held-out error x" + blind.medianFactor.toFixed(2) +
    " (" + Math.round(blind.within2x * 100) + "% within 2x of the real market cap), against a flat median-multiple baseline of x" +
    blind.baselineMedianFactor.toFixed(2) + " (" + Math.round(blind.baselineWithin2x * 100) + "% within 2x) on the same folds. " +
    "Each fold is predicted by a fit that never saw it, with the growth term, maturity term and clamp applied exactly as the board is priced.";
  $("foldLine").textContent = "Per-fold median error: " + blind.folds.map(function (f) {
    return "fold " + f.fold + " x" + f.medianFactor.toFixed(2) + " (baseline x" + f.baselineMedianFactor.toFixed(2) + ")";
  }).join(" · ") + ".";
  $("catGrid").innerHTML = Object.keys(fit.byCategory).sort().map(function (key) {
    var c = fit.byCategory[key];
    return '<span class="catchip"><b>' + esc(key) + '</b> ' + c.peers + (c.peers === 1 ? " peer" : " peers") + ' · median ' +
      c.medianMultiple.toFixed(2) + 'x · adj ' + c.adjustment.toFixed(2) + 'x</span>';
  }).join("");

  // --- Filters, tabs, tables --------------------------------------------
  var state = { q: "", cat: "", chain: "", verdict: "", sort: "value", tab: "pre" };
  function readHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    ["q", "cat", "chain", "verdict", "sort", "tab"].forEach(function (k) {
      if (h.get(k) !== null) state[k] = h.get(k);
    });
  }
  function writeHash() {
    var h = new URLSearchParams();
    Object.keys(state).forEach(function (k) { if (state[k]) h.set(k, state[k]); });
    history.replaceState(null, "", h.toString() ? "#" + h.toString() : location.pathname);
  }
  readHash();
  var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category; }))).sort();
  var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains; }))).sort();
  cats.forEach(function (c) { $("cat").insertAdjacentHTML("beforeend", "<option>" + esc(c) + "</option>"); });
  chains.forEach(function (c) { $("chain").insertAdjacentHTML("beforeend", "<option>" + esc(c) + "</option>"); });
  $("q").value = state.q; $("cat").value = state.cat; $("chain").value = state.chain;
  $("verdict").value = state.verdict; $("sort").value = state.sort;

  function matchText(r, q) {
    if (!q) return true;
    var hay = (r.name + " " + r.slug + " " + r.category).toLowerCase();
    return hay.indexOf(q.toLowerCase()) >= 0;
  }
  function sortRows(rows) {
    var s = state.sort;
    var sorted = rows.slice();
    if (s === "value") sorted.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1); });
    else if (s === "tvl") sorted.sort(function (a, b) { return b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1); });
    else if (s === "growth") sorted.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0) || (a.slug < b.slug ? -1 : 1); });
    else if (s === "efficiency") sorted.sort(function (a, b) { return b.econ.efficiency - a.econ.efficiency || (a.slug < b.slug ? -1 : 1); });
    else if (s === "name") sorted.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return sorted;
  }
  function growthText(g) {
    if (g === null || g === undefined) return "—";
    return (g >= 0 ? "+" : "") + g.toFixed(1) + "%";
  }
  function chainText(chains, max) {
    if (chains.length <= max) return chains.join(", ");
    return chains.slice(0, max).join(", ") + " +" + (chains.length - max) + " more";
  }
  function renderPre() {
    var rows = DATA.rows.filter(function (r) {
      return matchText(r, state.q) && (!state.cat || r.category === state.cat) &&
        (!state.chain || r.chains.indexOf(state.chain) >= 0) && (!state.verdict || r.verdict === state.verdict);
    });
    rows = sortRows(rows);
    $("rows").innerHTML = rows.map(function (r) {
      return "<tr><td>" + r.rank + "</td>" +
        '<td><span class="name">' + esc(r.name) + "</span>" +
        '<span class="pill ' + (r.onWatchlist ? "watch" : "early") + '">' + (r.onWatchlist ? "WATCHLIST" : "EARLY") + "</span>" +
        '<span class="sub">' + esc(r.slug) + " · " + esc(chainText(r.chains, 3)) + "</span></td>" +
        "<td>" + esc(r.category) + "</td>" +
        '<td class="num">' + money(r.tvl_usd) + "</td>" +
        '<td class="num">' + growthText(r.change_7d) + "</td>" +
        '<td class="num"><strong>' + money(r.implied_value_usd) + "</strong></td>" +
        '<td class="num">' + r.breakdown.multiple.toFixed(2) + "x</td>" +
        '<td><span class="verdict ' + r.verdict + '">' + r.verdict + "</span></td>" +
        '<td><button type="button" class="detailbtn" data-slug="' + esc(r.slug) + '">Detail</button></td></tr>';
    }).join("");
    $("emptyPre").hidden = rows.length > 0;
    $("count").textContent = rows.length + " of " + DATA.rows.length + " ranked protocols";
  }
  function renderAside() {
    var rows = DATA.setAside.filter(function (r) {
      return matchText(r, state.q) && (!state.cat || r.category === state.cat) &&
        (!state.chain || r.chains.indexOf(state.chain) >= 0);
    });
    $("asideRows").innerHTML = rows.map(function (r) {
      return "<tr><td><span class=\"name\">" + esc(r.name) + '</span><span class="sub">' + esc(r.slug) + " · " + esc(chainText(r.chains, 3)) + "</span></td>" +
        "<td>" + esc(r.category) + "</td>" + '<td class="num">' + money(r.tvl_usd) + "</td>" +
        "<td>" + esc(r.reason) + "</td></tr>";
    }).join("");
    $("emptyAside").hidden = rows.length > 0;
  }
  function renderLive() {
    $("liveRows").innerHTML = DATA.live.map(function (r) {
      return "<tr><td><span class=\"name\">" + esc(r.name) + '</span><span class="sub">' + esc(r.slug) + " · " + esc(chainText(r.chains, 3)) + "</span></td>" +
        "<td>" + esc(r.category) + "</td>" + '<td class="num">' + money(r.tvl_usd) + "</td>" +
        '<td class="num">' + (r.mcap_usd === null ? "—" : money(r.mcap_usd)) + "</td>" +
        "<td>" + esc(r.symbol || "—") + "</td></tr>";
    }).join("");
  }
  function renderTabs() {
    document.querySelectorAll(".tabs button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === state.tab);
    });
    $("view-pre").hidden = state.tab !== "pre";
    $("view-aside").hidden = state.tab !== "aside";
    $("view-live").hidden = state.tab !== "live";
  }
  function render() { renderPre(); renderAside(); renderLive(); renderTabs(); writeHash(); }

  ["q", "cat", "chain", "verdict", "sort"].forEach(function (id) {
    $(id).addEventListener("input", function () { state[id] = $(id).value; render(); });
    $(id).addEventListener("change", function () { state[id] = $(id).value; render(); });
  });
  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () { state.tab = b.dataset.tab; render(); });
  });

  // --- Detail dialog ------------------------------------------------------
  var dialog = $("detail");
  function barRow(label, value, maxLog, total) {
    var w = Math.max(4, (Math.log10(Math.max(1, value)) / maxLog) * 100);
    return '<div class="brow' + (total ? " total" : "") + '"><span class="blbl">' + label + '</span>' +
      '<span class="bbar"><i style="width:' + w.toFixed(1) + '%"></i></span>' +
      '<span class="bval">' + money(value) + "</span></div>";
  }
  function openDetail(slug) {
    var r = DATA.rows.find(function (x) { return x.slug === slug; });
    if (!r) return;
    var b = r.breakdown;
    var afterCat = Math.max(1, Math.round(b.curveValue * b.categoryAdjustment));
    var afterGrowth = Math.max(1, Math.round(afterCat * b.growthMultiplier));
    var afterMaturity = b.rawValue;
    var maxLog = Math.log10(Math.max(b.curveValue, afterCat, afterGrowth, afterMaturity, r.implied_value_usd, 10));
    $("dKicker").textContent = "Rank #" + r.rank + " · " + (r.onWatchlist ? "Watchlist" : "Early") + " · Verdict " + r.verdict;
    $("dName").textContent = r.name;
    $("dMeta").textContent = r.category + " · " + chainText(r.chains, 4) + " · TVL " + money(r.tvl_usd) +
      " · 7-day " + growthText(r.change_7d) + " · " +
      (r.listed_at ? "tracked since " + r.listed_at + " (" + (r.ageDays == null ? "?" : r.ageDays) + " days)" : "listing date not reported — priced at the median tenure") +
      " · records no token.";
    var clampNote = b.clamp === "cap" ? " (capped at 1.50x TVL)" : b.clamp === "floor" ? " (floored at 0.02x TVL)" : "";
    $("dBreak").innerHTML =
      barRow("Comps curve", b.curveValue, maxLog, false) +
      barRow("x category " + b.categoryAdjustment.toFixed(2) + "x", afterCat, maxLog, false) +
      barRow("x growth " + b.growthMultiplier.toFixed(2) + "x", afterGrowth, maxLog, false) +
      barRow("x maturity " + b.maturityMultiplier.toFixed(2) + "x", afterMaturity, maxLog, false) +
      barRow("Implied value" + clampNote, r.implied_value_usd, maxLog, true);
    var cat = fit.byCategory[r.category];
    if (cat && cat.peers >= MIN_PEERS) {
      $("dPeers").textContent = "In " + r.category + ", " + cat.peers + " priced peers trade at a median " +
        cat.medianMultiple.toFixed(2) + "x TVL; this protocol is priced at " + b.multiple.toFixed(2) + "x TVL.";
    } else if (cat) {
      $("dPeers").textContent = "In " + r.category + ", only " + cat.peers + " priced peer" +
        (cat.peers === 1 ? " trades" : "s trade") +
        ", so no category adjustment was applied; this protocol is priced at " + b.multiple.toFixed(2) + "x TVL.";
    } else {
      $("dPeers").textContent = "No priced peer in " + r.category + ", so no category adjustment was applied; this protocol is priced at " + b.multiple.toFixed(2) + "x TVL.";
    }
    $("dEcon").innerHTML =
      "<div><dt>Standard farm cost</dt><dd>" + smallMoney(r.econ.totalCostUsd) + "</dd></div>" +
      "<div><dt>This plan spends</dt><dd>" + smallMoney(r.econ.planSpendUsd) + "</dd></div>" +
      "<div><dt>Capital</dt><dd>" + smallMoney(r.econ.capitalUsd) + "</dd></div>" +
      "<div><dt>Gas</dt><dd>" + smallMoney(r.econ.gasUsd) + "</dd></div>" +
      "<div><dt>Hold</dt><dd>" + r.econ.holdDays + " days</dd></div>" +
      "<div><dt>Value / farm cost</dt><dd>" + Math.round(r.econ.efficiency).toLocaleString("en-US") + "x</dd></div>";
    var idx = DATA.rows.indexOf(r);
    var plan = idx >= 0 && JSON.stringify(derivedPlans[idx]) === JSON.stringify(r.farm_steps) ? derivedPlans[idx] : r.farm_steps;
    $("dPlan").innerHTML = plan.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    dialog.showModal();
  }
  $("rows").addEventListener("click", function (ev) {
    var btn = ev.target.closest("[data-slug]");
    if (btn) openDetail(btn.dataset.slug);
  });
  dialog.addEventListener("click", function (ev) {
    if (ev.target === dialog) dialog.close();
  });

  render();
})();
