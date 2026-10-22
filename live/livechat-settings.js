/**
 * Réglages du livechat sur ce PC (lancé par LIVECHAT.bat) : activer ou couper
 * l'affichage, régler le volume des vidéos. Écrit olycity-livechat.json, relu
 * par le script à chaque média : rien à redémarrer.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { parseLiveChatConfig } = require('./livechat-utils.js');

const CONFIG_PATH = path.join(__dirname, 'olycity-livechat.json');

function read() {
  try { return parseLiveChatConfig(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return parseLiveChatConfig(''); }
}

function write(config) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = question => new Promise(resolve => rl.question(question, resolve));
  const config = read();

  console.log('\n  OLYCITY LIVECHAT');
  console.log('  Images, GIF et videos postes sur #livechat ou olycity.fr/livechat.\n');
  console.log(`  Etat actuel : ${config.enabled ? 'ACTIVE' : 'COUPE'} - volume des videos ${config.volume} %`);
  console.log('  Pendant un affichage, Ctrl+Maj+F9 le fait disparaitre.\n');
  console.log(`  1. ${config.enabled ? 'Couper' : 'Activer'} le livechat sur ce PC`);
  console.log('  2. Regler le volume des videos');
  console.log('  3. Quitter\n');

  const choice = (await ask('  Ton choix : ')).trim();
  if (choice === '1') {
    config.enabled = !config.enabled;
    write(config);
    console.log(`\n  Livechat ${config.enabled ? 'active' : 'coupe'} sur ce PC.`);
  } else if (choice === '2') {
    const value = Number((await ask('  Volume (0 a 100) : ')).trim());
    if (Number.isFinite(value) && value >= 0 && value <= 100) {
      config.volume = Math.round(value);
      write(config);
      console.log(`\n  Volume des videos : ${config.volume} %.`);
    } else {
      console.log('\n  Valeur ignoree.');
    }
  }
  rl.close();
}

main();
