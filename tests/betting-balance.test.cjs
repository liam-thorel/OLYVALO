const assert = require('node:assert/strict');
const Module = require('node:module');

// Le solde restant doit revenir au parieur au moment du pari — sans relecture
// du wallet, et aussi bien quand le pari passe que quand il est refusé.

// ─── Le wallet en mémoire, partagé par les deux modules stubés ───────────────
const wallets = {};
const writes = [];
const firebase = {
  fbGet: async path => {
    const id = path.startsWith('betting/wallets/') ? path.slice('betting/wallets/'.length) : null;
    if (id) return wallets[id] ? { ...wallets[id] } : null;
    if (path.startsWith('betting/rounds/') && path.endsWith('/bets/u1')) return null;
    if (path === 'betting/rounds/r1') {
      return { status: 'open', closesAt: Date.now() + 60_000, oddsWin: 1.5, oddsLose: 2.5 };
    }
    return null;
  },
  fbPut: async (path, value) => {
    writes.push(path);
    const id = path.startsWith('betting/wallets/') ? path.slice('betting/wallets/'.length) : null;
    if (id) wallets[id] = value;
    return true;
  },
  fbDelete: async () => true,
};

const original = Module._load;
Module._load = function stub(request, parent, isMain) {
  if (request === './config.js') return { FIREBASE_URL: 'x' };
  if (request === './firebase.js') return firebase;
  if (request === './odds.js') return { estimateOdds: async () => ({}) };
  return original(request, parent, isMain);
};
const wallet = require('../discord-bot/wallet.js');
const { placeBet, betErrorMessage, betConfirmation } = require('../discord-bot/betting.js');
Module._load = original;

(async () => {
  // ─── debit() rend le solde, pas seulement un booléen ──────────────────────
  wallets.u1 = { balance: 1000, lastGrantDate: new Date().toISOString().slice(0, 10), username: 'u1' };

  const ok = await wallet.debit('u1', 300, 'u1');
  assert.deepEqual(ok, { ok: true, balance: 700 }, 'le solde rendu est celui APRÈS débit');
  assert.equal(wallets.u1.balance, 700, 'le débit est bien persisté');

  // Refus : le solde revient quand même — c'est là qu'il est le plus utile.
  writes.length = 0;
  const refused = await wallet.debit('u1', 5000, 'u1');
  assert.deepEqual(refused, { ok: false, balance: 700 }, 'le solde inchangé est rendu au refus');
  assert.equal(wallets.u1.balance, 700, 'un refus ne débite rien');
  assert.deepEqual(writes, [], 'un refus n’écrit pas dans le wallet');

  // ─── placeBet fait remonter ce solde jusqu’à l’appelant ───────────────────
  wallets.u1.balance = 500;
  const bet = await placeBet('r1', 'u1', 'u1', 'win', 200);
  assert.equal(bet.ok, true);
  assert.equal(bet.balance, 300, 'placeBet rend le solde restant après la mise');
  assert.equal(bet.odds, 1.5);

  wallets.u1.balance = 50;
  const poor = await placeBet('r1', 'u1', 'u1', 'win', 200);
  assert.deepEqual(
    { ok: poor.ok, reason: poor.reason, balance: poor.balance },
    { ok: false, reason: 'insufficient-funds', balance: 50 },
    'un refus pour fonds insuffisants rend le solde courant',
  );

  // ─── Les messages montrent réellement le solde ────────────────────────────
  const confirmation = betConfirmation(200, 1.5, 450);
  assert.match(confirmation, /\*\*200 points\*\*/, 'la confirmation rappelle la mise');
  assert.match(confirmation, /\*\*300 points\*\*/, 'gain potentiel = 200 x 1.5');
  assert.match(confirmation, /Il te reste \*\*450 points\*\*/, 'la confirmation annonce le solde restant');

  const refusal = betErrorMessage('insufficient-funds', 50);
  assert.match(refusal, /50 points/, 'le refus annonce ce qu’il reste');
  assert.doesNotMatch(refusal, /\/balance/, 'plus besoin de renvoyer vers /balance');

  // Sans solde connu, on retombe sur l’ancien message plutôt que d’afficher
  // « null point ».
  assert.match(betErrorMessage('insufficient-funds'), /\/balance/);

  // Les autres refus ne parlent pas de solde.
  assert.match(betErrorMessage('already-bet'), /déjà parié/);
  assert.match(betErrorMessage('closed'), /fermés/);
  assert.match(betErrorMessage('inconnu'), /Impossible de placer ce pari/);

  // ─── Pluriel ──────────────────────────────────────────────────────────────
  assert.match(betErrorMessage('insufficient-funds', 1), /1 point\*/, '1 point, pas « 1 points »');
  assert.match(betErrorMessage('insufficient-funds', 0), /0 point\*/, '0 point au singulier aussi');
  assert.match(betErrorMessage('insufficient-funds', 2), /2 points/);

  console.log('betting-balance: le solde restant remonte du wallet jusqu’au parieur');
})().catch(error => { console.error(error); process.exit(1); });
