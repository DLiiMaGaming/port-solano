// PORT SOLANO — the program that hands the game in for the make.fun
// bounty (Node 22, standard library only).
//
// The game itself is the static site in game/: plain files a desktop
// browser loads offline, no build step, no network. This program's whole
// job is the delivery: copy game/ and screenshots/ into the output
// directory and write dossier.json there with the kit's vendored library
// (vendor/makefun-game.ts, unchanged), which is the summary the scorer
// verifies and the judge reads.
//
// Run it the way the grader does, from the repository root:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// (MAKEFUN_OUTPUT_DIR stands in for /output outside the grader.)
// Play the game locally instead with: node serve.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The caps below are the scorer's own (the kit's reference gate): the
// dossier is only written for a game that fits them, and the scorer
// rebuilds the dossier with the same library and compares byte for byte,
// so these numbers are part of the delivery format, not a choice.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

// One delivery step: copy a directory tree from the repo into the output
// directory and note it for the summary line.
function copyTree(repoRoot, outputDir, name, delivered) {
  cpSync(join(repoRoot, name), join(outputDir, name), { recursive: true });
  delivered.push(name + '/');
}

function deliver() {
  const repoRoot = fileURLToPath(new URL('.', import.meta.url));
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const delivered = [];

  mkdirSync(outputDir, { recursive: true });
  copyTree(repoRoot, outputDir, 'game', delivered);

  // Screenshots are part of the delivery when they exist; a repo without
  // them still delivers the game and its dossier.
  if (existsSync(join(repoRoot, 'screenshots'))) {
    copyTree(repoRoot, outputDir, 'screenshots', delivered);
  }

  // The dossier is written last, over the finished tree: it summarizes
  // exactly the bytes the two copy steps just delivered.
  const dossier = buildDossier(outputDir, DOSSIER_CAPS);
  writeFileSync(join(outputDir, 'dossier.json'), dossier);
  delivered.push('dossier.json');

  console.log(`PORT SOLANO — delivered to ${outputDir}: ${delivered.join(', ')}`);
}

try {
  deliver();
} catch (err) {
  // A failed delivery must say so plainly and exit non-zero: a silent
  // half-copied tree would otherwise look like a finished hand-in.
  console.error(`PORT SOLANO — delivery failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
