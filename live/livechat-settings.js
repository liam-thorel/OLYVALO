/**
 * Réglages du livechat sur ce PC (lancé par LIVECHAT.bat) : activer ou couper
 * l'affichage, choisir les touches, régler le volume des vidéos. Écrit
 * olycity-livechat.json, relu par le script en marche : rien à redémarrer.
 *
 * Les touches se choisissent en appuyant dessus : livechat-keys (compilé sur
 * place, voir livechat.js) lit la combinaison tenue, Ctrl/Maj/Alt/Win compris.
 * Souris 4/5 et clic molette marchent aussi.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFile } = require('child_process');
const { parseLiveChatConfig, hotkeyLabel, normalizeHotkey, sameHotkey } = require('./livechat-utils.js');
const { compileProgram } = require('./livechat.js');

const CONFIG_PATH = path.join(__dirname, 'olycity-livechat.json');

function readRaw() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}; } catch { return {}; }
}

function write(changes) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify({ ...readRaw(), ...changes }, null, 2)}\n`, 'utf8');
}

function read() {
  return parseLiveChatConfig(JSON.stringify(readRaw()));
}

/** Attend une combinaison : rend { vk, ctrl, … }, 'cancel' ou 'timeout'. */
async function captureKey() {
  const exe = await compileProgram('keys');
  const out = await new Promise((resolve, reject) => {
    execFile(exe, ['capture'], { windowsHide: true, timeout: 30000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
  const result = JSON.parse(String(out).trim().split(/\r?\n/).pop() || '{}');
  if (result.cancel) return 'cancel';
  if (result.timeout) return 'timeout';
  return normalizeHotkey(result, null);
}

async function chooseKey(ask, field, otherField, label) {
  console.log(`\n  Appuie maintenant sur la touche (ou la combinaison) pour ${label}.`);
  console.log('  Echap seul : annuler.\n');
  let key;
  try { key = await captureKey(); } catch (error) {
    console.log(`  Lecture des touches impossible : ${error.message}`);
    return;
  }
  if (key === 'cancel') { console.log('  Annule.'); return; }
  if (key === 'timeout' || !key) { console.log('  Aucune touche recue.'); return; }
  const config = read();
  if (sameHotkey(key, config[otherField])) {
    console.log(`  ${hotkeyLabel(key)} sert deja a l'autre action : choisis-en une autre.`);
    return;
  }
  write({ [field]: key });
  console.log(`  Touche enregistree : ${hotkeyLabel(key)}`);
  // F1–F24, boutons de souris 4/5/molette et touches multimédia ne servent à
  // rien en jeu ; une lettre ou Espace seuls, si.
  const harmless = (key.vk >= 0x70 && key.vk <= 0x87) || (key.vk >= 0x04 && key.vk <= 0x06) || (key.vk >= 0xad && key.vk <= 0xb3);
  if (key.ctrl || key.alt || key.win || harmless) return;
  const confirm = (await ask('  Une touche seule peut gener en jeu. La garder ? (o/n) ')).trim().toLowerCase();
  if (confirm !== 'o') { write({ [field]: config[field] }); console.log('  Ancienne touche remise.'); }
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = question => new Promise(resolve => rl.question(question, resolve));

  for (;;) {
    const config = read();
    console.log('\n  OLYCITY LIVECHAT');
    console.log('  Images, GIF, videos et liens (YouTube, clips...) envoyes sur #livechat,');
    console.log('  olycity.fr/livechat ou avec l\'extension navigateur.\n');
    console.log(`  Etat : ${config.enabled ? 'ACTIVE' : 'COUPE'} - volume des videos ${config.volume} % - videos limitees a ${config.maxVideoSeconds} s`);
    console.log(`  Couper / reactiver : ${hotkeyLabel(config.toggleKey)}`);
    console.log(`  Passer l'affichage en cours : ${hotkeyLabel(config.skipKey)}\n`);
    console.log(`  1. ${config.enabled ? 'Couper' : 'Activer'} le livechat sur ce PC`);
    console.log('  2. Choisir la touche pour couper / reactiver');
    console.log('  3. Choisir la touche pour passer une video');
    console.log('  4. Regler le volume des videos');
    console.log('  5. Regler la duree maximale d\'une video');
    console.log('  6. Retirer une touche');
    console.log('  7. Quitter\n');

    const choice = (await ask('  Ton choix : ')).trim();
    if (choice === '1') {
      write({ enabled: !config.enabled });
      console.log(`\n  Livechat ${config.enabled ? 'coupe' : 'active'} sur ce PC.`);
    } else if (choice === '2') {
      await chooseKey(ask, 'toggleKey', 'skipKey', 'couper / reactiver le livechat');
    } else if (choice === '3') {
      await chooseKey(ask, 'skipKey', 'toggleKey', 'passer la video en cours');
    } else if (choice === '4') {
      const value = Number((await ask('  Volume (0 a 100) : ')).trim());
      if (Number.isFinite(value) && value >= 0 && value <= 100) {
        write({ volume: Math.round(value) });
        console.log(`\n  Volume des videos : ${Math.round(value)} %.`);
      } else console.log('\n  Valeur ignoree.');
    } else if (choice === '5') {
      const value = Number((await ask('  Duree maximale en secondes (5 a 120) : ')).trim());
      if (Number.isFinite(value) && value >= 5 && value <= 120) {
        write({ maxVideoSeconds: Math.round(value) });
        console.log(`\n  Videos limitees a ${Math.round(value)} s.`);
      } else console.log('\n  Valeur ignoree.');
    } else if (choice === '6') {
      const which = (await ask('  Retirer la touche pour (1) couper/reactiver ou (2) passer ? ')).trim();
      if (which === '1') write({ toggleKey: null });
      if (which === '2') write({ skipKey: null });
      if (which === '1' || which === '2') console.log('  Touche retiree.');
    } else {
      break;
    }
  }
  rl.close();
}

main();
