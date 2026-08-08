/**
 * « Qui es-tu dans le roster ? » — invite interactive lancée dans une vraie
 * fenêtre console (l'INSTALLER, ou une fenêtre ouverte par le script quand il
 * tourne en fond sans identité connue).
 *
 * Écrit olycity-identity.json à côté du script. Ce fichier n'est pas dans
 * update-manifest.json : il survit aux mises à jour automatiques.
 *
 * Usage :
 *   node ask-identity.js            → ne demande rien si l'identité existe déjà
 *   node ask-identity.js --force    → redemande même si elle existe (changer de personne)
 */
const https = require('https');
const readline = require('readline');
const {
  buildMemberChoices, parseIdentityChoice, normalizeNewMemberName,
  readIdentity, writeIdentity, slugifyMemberName,
} = require('./identity.js');

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const ROSTER_URL = 'https://liam-thorel.github.io/OLYVALO/data/roster.json';
const INSTALL_DIR = __dirname;

function getJson(url) {
  return new Promise(resolve => {
    const request = https.get(url, { timeout: 8000 }, response => {
      if (response.statusCode !== 200) { response.resume(); resolve(null); return; }
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    request.on('error', () => resolve(null));
    request.on('timeout', () => { request.destroy(); resolve(null); });
  });
}

function putJson(path, data) {
  const body = JSON.stringify(data);
  return new Promise(resolve => {
    const request = https.request({
      hostname: new URL(FIREBASE_URL).hostname,
      path: `/${path}.json?print=silent`,
      method: 'PUT',
      timeout: 8000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode === 200 || response.statusCode === 204));
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.write(body);
    request.end();
  });
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, answer => resolve(answer)));
}

function printChoices(choices) {
  console.log('');
  console.log('  Qui utilise ce PC ?');
  console.log('  ------------------------------------------');
  choices.forEach((choice, index) => {
    const number = String(index + 1).padStart(2, ' ');
    const role = choice.role ? `  (${choice.role})` : '';
    console.log(`   ${number}. ${choice.name}${role}`);
  });
  console.log(`   ${String(choices.length + 1).padStart(2, ' ')}. Autre — ajouter une nouvelle personne`);
  console.log('  ------------------------------------------');
  console.log('');
}

async function main() {
  const force = process.argv.includes('--force');
  const existing = readIdentity(INSTALL_DIR);
  if (existing && !force) {
    console.log(`  OLYCITY LIVE est deja configure pour : ${existing.memberName}`);
    return 0;
  }

  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║  OLYCITY LIVE — identification       ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log('  Une seule fois : dis-nous qui tu es.');
  console.log('  Le suivi restera valable meme si tu changes de pseudo Riot');
  console.log('  ou si tu joues sur un autre compte.');

  const [roster, overlay] = await Promise.all([getJson(ROSTER_URL), getJson(`${FIREBASE_URL}/rosterOverlay.json`)]);
  const choices = buildMemberChoices(roster || [], overlay);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (choices.length === 0) {
      console.log('');
      console.log('  [!] Roster injoignable (pas de reseau ?).');
      console.log('      Tape simplement ton prenom.');
    }

    let selected = null;
    while (!selected) {
      if (choices.length > 0) printChoices(choices);
      const answer = await ask(rl, choices.length > 0 ? '  Ton numero (ou ton prenom) : ' : '  Ton prenom : ');
      const choice = choices.length > 0
        ? parseIdentityChoice(answer, choices)
        : { type: 'other', presetName: answer };

      if (choice.type === 'member') {
        selected = { memberId: choice.member.id, memberName: choice.member.name, isNewMember: false };
        break;
      }

      if (choice.type === 'other') {
        const raw = choice.presetName ?? await ask(rl, '  Prenom / pseudo de la nouvelle personne : ');
        const name = normalizeNewMemberName(raw);
        if (!name) {
          console.log('  [!] Nom invalide (2 a 32 caracteres). On recommence.');
          continue;
        }
        const id = slugifyMemberName(name);
        const clash = choices.find(entry => entry.id === id);
        if (clash) {
          console.log(`  -> "${clash.name}" existe deja dans le roster, on le reutilise.`);
          selected = { memberId: clash.id, memberName: clash.name, isNewMember: false };
          break;
        }
        selected = { memberId: id, memberName: name, isNewMember: true };
        break;
      }

      console.log('  [!] Choix non reconnu. Tape le numero affiche a gauche.');
    }

    if (selected.isNewMember) {
      const registered = await putJson(`rosterOverlay/members/${selected.memberId}`, {
        name: selected.memberName,
        role: '',
        avatar: '',
        createdBy: 'olycity-live',
        createdAt: Date.now(),
      });
      console.log(registered
        ? `  Nouveau membre "${selected.memberName}" ajoute au roster OLYCITY.`
        : `  [!] Membre enregistre en local ; l'ajout au roster partage se fera au prochain demarrage.`);
    }

    writeIdentity({ ...selected, chosenAt: Date.now() }, INSTALL_DIR);
    console.log('');
    console.log(`  OK — ce PC est identifie comme : ${selected.memberName}`);
    console.log('  Ton compte Riot sera rattache automatiquement a ce nom,');
    console.log('  et le restera meme apres un changement de pseudo.');
    console.log('');
    return 0;
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(error => { console.error(`  [ERREUR] ${error.message}`); process.exit(1); });
}

module.exports = { main };
