import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRadar, boardRows, type Snapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const inputPath = argValue("--input", "/input/snapshot.json");
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
mkdirSync(outDir, { recursive: true });

const snapshot = JSON.parse(readFileSync(inputPath, "utf8")) as Snapshot;
const data = buildRadar(snapshot);

const board = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  model: data.modelVersion,
  rows: boardRows(data),
};
writeFileSync(join(outDir, "board.json"), JSON.stringify(board, null, 2) + "\n");
writeFileSync(join(outDir, "data.js"), `window.__RADAR__ = ${JSON.stringify(data)};\n`);

const dashboardSrc = join(here, "dashboard");
const dashboardOut = join(outDir, "dashboard");
mkdirSync(dashboardOut, { recursive: true });
for (const file of ["index.html", "app.css", "app.js"]) {
  writeFileSync(join(dashboardOut, file), readFileSync(join(dashboardSrc, file)));
}

const screenshotsSrc = join(here, "screenshots");
const screenshotsOut = join(outDir, "screenshots");
mkdirSync(screenshotsOut, { recursive: true });
if (existsSync(screenshotsSrc)) {
  cpSync(screenshotsSrc, screenshotsOut, { recursive: true });
}
const shots = readdirSync(screenshotsOut).filter((name) => !name.startsWith("."));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in at least 3\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this output and compares bytes.
const dossierBytes = buildDossier(outDir, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: SCREENSHOT_CAPS,
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outDir, "dossier.json"), dossierBytes);
const dossierSize = statSync(join(outDir, "dossier.json")).size;

const verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
for (const row of data.rows) verdicts[row.verdict] += 1;
console.log(
  `token radar: ${data.totalProtocols} protocols, ${data.watchlistCount} on the watchlist, ` +
    `${data.rankedCount} ranked, ${data.setAsideCount} set aside with reasons, ${data.liveCount} already trade`,
);
console.log(
  `token radar: comps curve on ${data.fit.peers} priced peers ` +
    `(log10 mcap = ${data.fit.intercept.toFixed(3)} + ${data.fit.slope.toFixed(3)} x log10 tvl, R2 ${data.fit.r2.toFixed(3)}); ` +
    `blind test median error x${data.blind.medianFactor.toFixed(2)} vs baseline x${data.blind.baselineMedianFactor.toFixed(2)}`,
);
console.log(`token radar: verdicts FARM ${verdicts.FARM} / THIN ${verdicts.THIN} / SKIP ${verdicts.SKIP}`);
console.log(
  `token radar: wrote ${join(outDir, "board.json")}, ${join(outDir, "data.js")}, ` +
    `${join(outDir, "dashboard")} (3 files), ${join(outDir, "screenshots")} and ${join(outDir, "dossier.json")} (${dossierSize} bytes)`,
);
