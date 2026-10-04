import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * La publication automatique décide seule de sortir une version : une erreur
 * de logique publie une version de trop, ou n'en publie jamais. On exécute
 * donc le VRAI script du workflow, extrait du YAML, dans un dépôt jetable où
 * `gh` est remplacé par un faux qui répond selon le scénario.
 */
const workflow = readFileSync(new URL('../.github/workflows/auto-release.yml', import.meta.url), 'utf8');

function planScript() {
  const lines = workflow.split('\n');
  const start = lines.findIndex(line => line.includes('id: plan'));
  const runAt = lines.findIndex((line, index) => index > start && /^\s+run: \|$/.test(line));
  const indent = lines[runAt + 1].match(/^\s*/)[0].length;
  const body = [];
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim() && line.match(/^\s*/)[0].length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join('\n')
    .replaceAll("${{ github.repository }}", 'liam-thorel/OLYVALO');
}

const hasTools = (() => {
  try { execFileSync('bash', ['-c', 'command -v jq && command -v git'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

/**
 * @param {object} scenario
 * @param {string} scenario.live     version de live/package.json
 * @param {string} scenario.overlay  version d'overlay/package.json
 * @param {string[]} scenario.releases  releases existantes, la dernière en tête
 * @param {string[]} scenario.tags   tags existants
 * @param {string} scenario.publishedOverlay  version annoncée par latest.yml de la dernière release
 * @param {boolean} scenario.liveChanged  live/ modifié depuis le tag de la version courante
 */
function run(scenario) {
  const dir = mkdtempSync(join(tmpdir(), 'auto-release-'));
  const remote = join(dir, 'remote.git');
  const work = join(dir, 'work');
  const bin = join(dir, 'bin');
  const sh = (cmd, cwd = work) => execFileSync('bash', ['-c', cmd], { cwd, encoding: 'utf8' });

  execFileSync('git', ['init', '-q', '--bare', remote]);
  execFileSync('git', ['init', '-q', work]);
  sh('git config user.email t@t && git config user.name t && git remote add origin ../remote.git');
  mkdirSync(join(work, 'live'));
  mkdirSync(join(work, 'overlay'));
  writeFileSync(join(work, 'live', 'package.json'), JSON.stringify({ version: scenario.live }));
  writeFileSync(join(work, 'live', 'index.js'), 'v1');
  writeFileSync(join(work, 'overlay', 'package.json'), JSON.stringify({ version: scenario.overlay }));
  sh('git add -A && git commit -qm init');
  for (const tag of scenario.tags || []) sh(`git tag ${tag} && git push -q origin ${tag}`);
  if (scenario.liveChanged) {
    writeFileSync(join(work, 'live', 'index.js'), 'v2');
    sh('git commit -qam change');
  }
  sh('git push -q origin HEAD:refs/heads/main');

  // Faux `gh` : `release view <tag>`, `release view --json tagName`, `release download`.
  mkdirSync(bin);
  const releases = scenario.releases || [];
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash
releases=(${releases.map(r => `'${r}'`).join(' ')})
if [ "$1 $2" = "release view" ]; then
  if [ "$3" = "--repo" ]; then
    [ "\${#releases[@]}" -gt 0 ] && { echo "\${releases[0]}"; exit 0; } || exit 1
  fi
  for r in "\${releases[@]}"; do [ "$r" = "$3" ] && exit 0; done
  exit 1
fi
if [ "$1 $2" = "release download" ]; then
  ${scenario.publishedOverlay ? `printf 'version: ${scenario.publishedOverlay}\\r\\npath: x.exe\\n'` : 'exit 1'}
  exit 0
fi
echo "gh inattendu: $*" >&2; exit 2
`);
  chmodSync(join(bin, 'gh'), 0o755);

  const output = join(dir, 'out');
  writeFileSync(output, '');
  const sha = sh('git rev-parse HEAD').trim();
  const log = execFileSync('bash', ['-c', planScript()], {
    cwd: work, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: output, GITHUB_SHA: sha, GH_TOKEN: 'x' },
  });
  const outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').filter(Boolean)
    .map(line => line.split('=')));
  const remoteTags = sh('git tag', remote).trim().split('\n').filter(Boolean);
  return { outputs, log, remoteTags, sha, tagSha: tag => sh(`git rev-parse ${tag}^{commit}`, remote).trim() };
}

test('nouvelle version du script : tag sur le commit mergé, release et overlay', { skip: !hasTools }, () => {
  const r = run({ live: '4.22.0', overlay: '1.2.4', releases: ['v4.21.2'], tags: ['v4.21.2'], publishedOverlay: '1.2.4' });
  assert.equal(r.outputs.live_tag, 'v4.22.0');
  assert.equal(r.outputs.overlay_tag, 'v4.22.0', 'chaque release porte aussi l’overlay');
  assert.ok(r.remoteTags.includes('v4.22.0'), 'le tag est poussé');
  assert.equal(r.tagSha('v4.22.0'), r.sha, 'sur le commit mergé, pas un autre');
});

test('seul l’overlay a changé : il rejoint la dernière release, sans version du script', { skip: !hasTools }, () => {
  const r = run({ live: '4.21.2', overlay: '1.2.4', releases: ['v4.21.2'], tags: ['v4.21.2'], publishedOverlay: '1.2.3' });
  assert.equal(r.outputs.live_tag, '', 'pas de mise à jour forcée des postes');
  assert.equal(r.outputs.overlay_tag, 'v4.21.2');
  assert.deepEqual(r.remoteTags, ['v4.21.2'], 'aucun tag créé');
});

test('rien de nouveau : rien n’est publié', { skip: !hasTools }, () => {
  const r = run({ live: '4.21.2', overlay: '1.2.4', releases: ['v4.21.2'], tags: ['v4.21.2'], publishedOverlay: '1.2.4' });
  assert.equal(r.outputs.live_tag, '');
  assert.equal(r.outputs.overlay_tag, '');
});

test('dernière release sans overlay : il est joint', { skip: !hasTools }, () => {
  const r = run({ live: '4.21.2', overlay: '1.2.4', releases: ['v4.21.2'], tags: ['v4.21.2'], publishedOverlay: '' });
  assert.equal(r.outputs.overlay_tag, 'v4.21.2');
});

test('publication interrompue (tag sans release) : on reprend sans recréer le tag', { skip: !hasTools }, () => {
  const r = run({ live: '4.22.0', overlay: '1.2.4', releases: ['v4.21.2'], tags: ['v4.21.2', 'v4.22.0'], publishedOverlay: '1.2.4' });
  assert.equal(r.outputs.live_tag, 'v4.22.0');
  assert.match(r.log, /nouvelle tentative/);
});

test('script modifié sans nouvelle version : signalé, pas publié', { skip: !hasTools }, () => {
  const r = run({ live: '4.21.2', overlay: '1.2.4', releases: ['v4.21.2'], tags: ['v4.21.2'], publishedOverlay: '1.2.4', liveChanged: true });
  assert.equal(r.outputs.live_tag, '');
  assert.match(r.log, /::warning::live\/ a changé depuis v4\.21\.2 sans nouvelle version/);
});

test('les workflows de release sont appelables, et l’overlay compile le commit exact', () => {
  const live = readFileSync(new URL('../.github/workflows/release-live.yml', import.meta.url), 'utf8');
  const overlay = readFileSync(new URL('../.github/workflows/release-overlay.yml', import.meta.url), 'utf8');
  assert.match(live, /\n  workflow_call:\n    inputs:\n      tag:/);
  assert.match(overlay, /\n  workflow_call:\n    inputs:\n      tag:/);
  assert.match(overlay, /ref: \$\{\{ inputs\.ref \|\| /);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  // Un tag manuel doit continuer de fonctionner.
  assert.match(live, /push:\n    tags: \['v\*'\]/);
  assert.match(overlay, /push:\n    tags: \['v\*'\]/);
  // Les tests passent avant toute publication.
  assert.match(workflow, /plan:\n    needs: tests/);
});
