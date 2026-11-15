# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zevabagus-spec/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zevabagus-spec/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar ranks 200 pre-token protocols by an implied launch value from a comps curve fitted to the snapshot's own priced peers — least squares on log market cap vs log TVL, with shrunk category adjustments — tested blind on held-out peers before it prices anything, and nets every row to a FARM, THIN or SKIP verdict from its own farm economics, each with a costed farm plan that adapts to the verdict. A static, no-network dashboard renders the board, a per-protocol detail view, and search, category, chain and verdict filters; the page refits the curve and recomputes every row from the same figures, so the screenshots, the code and the board agree.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=pkrtjm47&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
