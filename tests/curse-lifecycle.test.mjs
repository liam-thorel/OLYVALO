import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../js/curse.mjs', import.meta.url);
const mainUrl = new URL('../js/main.js', import.meta.url);

test('la curse reste irréversible pendant la partie', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(source, /if \(locked\)\{ dodge\(\); return; \}/);
  assert.doesNotMatch(source, /if \(cursed\)\{[\s\S]{0,120}fbPutJSON\(CURSE_PATH, null\)/);
});

test('le son suit la page Live et la visibilité de l’onglet', async () => {
  const [source, main] = await Promise.all([
    readFile(sourceUrl, 'utf8'),
    readFile(mainUrl, 'utf8'),
  ]);

  assert.match(source, /cursed && pageActive && !document\.hidden && !muted/);
  assert.match(source, /document\.addEventListener\('visibilitychange', refreshAmbience\)/);
  assert.match(source, /window\.addEventListener\('olycity:page-change'/);
  assert.match(main, /new CustomEvent\('olycity:page-change'/);
});

test('un changement ou une fin de match réévalue et arrête l’ancienne curse', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(source, /if \(nextMatchId === currentMatchId\) return;/);
  assert.match(source, /applyCurseState\(lastCurseState\)/);
  assert.match(source, /function setLive\(isLive\)[\s\S]*?applyCurseState\(null\)/);
});
