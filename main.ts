// main.ts — FERROLINE's entry program (Node 22, standard library only).
// Copies game/ and screenshots/ from this repository to the output
// directory (/output, or $MAKEFUN_OUTPUT_DIR outside the grader) and writes
// /output/dossier.json with buildDossier from vendor/makefun-threejs.ts.
// Runs twice, writes the same bytes both times: deterministic copy order,
// no timestamps in the output.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// Wipe only the CONTENTS of the output directory, never the directory
// itself: in the grader /output is a volume mount point and deleting it
// fails with EBUSY ("Device or resource busy"). Create the directory only
// when it does not already exist.
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
} else {
  for (const entry of readdirSync(outDir)) {
    rmSync(join(outDir, entry), { recursive: true, force: true });
  }
}
for (const name of ['game', 'screenshots']) {
  const src = join(repoRoot, name);
  if (existsSync(src)) cpSync(src, join(outDir, name), { recursive: true });
}
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
