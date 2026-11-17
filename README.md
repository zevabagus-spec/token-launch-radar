# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zevabagus-spec/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zevabagus-spec/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar ranks every pre-token protocol that passes the watchlist screen — the full 40-protocol watchlist plus every below-floor protocol the same screen passes — by an implied launch value from a comps curve fitted to the snapshot's own priced peers: least squares on log market cap vs log TVL, shrunk category adjustments, and growth and tenure terms, all scored by a five-fold blind test of the whole predictor before it prices anything. Protocols the screen sets aside are listed with their reasons, so all 758 snapshot protocols are accounted for. Each ranked row nets to a FARM, THIN or SKIP verdict from its own farm economics, with a costed farm plan that adapts to the verdict — SKIP plans spend nothing and name the trigger that would reopen the protocol, measured against its own TVL. A static, no-network dashboard renders the board, a set-aside view, a live-token view, a per-protocol detail view with a value breakdown, and search, category, chain and verdict filters; the page refits the curve, reruns the blind test and recomputes every row from the same figures, so the screenshots, the code and the board agree.

## Verified locally

178 rows (40/40 watchlist), 164 set aside with reasons, 416 already trade. Comps curve on 119 priced peers: log10(mcap) = 3.382 + 0.472 × log10(TVL), R² 0.143. Five-fold blind test of the full predictor: median held-out error ×3.02 (35% within 2×) vs a flat median-multiple baseline of ×5.01 (28% within 2×) on the same folds. The page's recomputation matches the board on 178/178 values and 178/178 farm plans. Two runs write byte-identical output, and the dossier rebuilds byte-identical from the output alone.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=pkrtjm47&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
