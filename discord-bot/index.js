require('dotenv').config();
const {
  Client, GatewayIntentBits, Collection, EmbedBuilder, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { DISCORD_TOKEN, DISCORD_LOG_CHANNEL_ID } = require('./config.js');
const { ensureRoster, memberByIdentity } = require('./roster.js');
const { startTrackerSync, loadTrackersOnce, trackersForPlayerGame } = require('./trackers.js');
const { recordDiscovered } = require('./discovered.js');
const { watchNode, fbGet } = require('./firebase.js');
const { buildItemsImage } = require('./build-image.js');
const {
  openRound, closeRound, resolveRound, cancelRound, roundsForMatch, placeBet, attachMessage, BETTING_WINDOW_MS,
} = require('./betting.js');
const { startWeeklyScheduler } = require('./weekly.js');
const { startDailyRecapScheduler } = require('./daily-recap.js');
const {
  startLolSoloRecapScheduler, startLolFlexRecapScheduler,
  startLolSoloWeeklyRecapScheduler, startLolFlexWeeklyRecapScheduler,
  startLolSoloMonthlyRecapScheduler, startLolFlexMonthlyRecapScheduler,
} = require('./lol-recap.js');
const { startValoDailyRecapScheduler, startValoWeeklyRecapScheduler, startValoMonthlyRecapScheduler } = require('./valo-daily-recap.js');
const { startLeaderboardScheduler } = require('./leaderboard-rank.js');
const { rewardForGamePlayed } = require('./wallet.js');
const { recordRankGain, lolRankPoints } = require('./rank-tracking.js');
const { recordAward } = require('./valorant-awards.js');
const { buildRankProgressLine } = require('./valorant-rank.js');
const { isRankedValorantMode, isValorantDeathmatch, isNonRankedLolQueue } = require('./stats.js');
const { createBoundedSet, createExpiringMap } = require('./bounded-memory.js');
const { formatLolRank, POSITION_ICONS } = require('./lol-rank.js');

const SITE_URL = 'https://liam-thorel.github.io/OLYVALO';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// Salon de logs optionnel (DISCORD_LOG_CHANNEL_ID) : les erreurs fatales y sont
// postées avant que le process ne s'arrête — utile une fois déployé sur un host
// qui redémarre le process tout seul (ex: Bot-Hosting.net), pour voir pourquoi
// il a crashé sans avoir à ouvrir les logs du panel.
async function logFatal(context, error) {
  console.error(`[${context}]`, error);
  if (!DISCORD_LOG_CHANNEL_ID || !client.isReady()) return;
  try {
    const channel = await client.channels.fetch(DISCORD_LOG_CHANNEL_ID);
    await channel.send(`⛔ **${context}**\n\`\`\`${String(error?.stack || error).slice(0, 1800)}\`\`\``);
  } catch (logError) {
    console.error('[logFatal] échec envoi salon de logs —', logError.message);
  }
}

process.on('unhandledRejection', error => { logFatal('unhandledRejection', error); });
process.on('uncaughtException', error => {
  logFatal('uncaughtException', error).finally(() => process.exit(1));
});

// Requires explicites plutôt qu'un scan de dossier au runtime (fs.readdirSync) :
// certains hébergeurs perdent ou déplacent des sous-dossiers pendant
// l'extraction d'un zip, ce qui casse un scan dynamique sans prévenir tant
// qu'on ne redémarre pas — un require() manquant, lui, échoue tout de suite
// et clairement au démarrage.
[
  './commands/awards.js',
  './commands/balance.js',
  './commands/bet.js',
  './commands/leaderboard.js',
  './commands/leaderboard-channel.js',
  './commands/leaderboard-lol-solo.js',
  './commands/leaderboard-valo.js',
  './commands/list.js',
  './commands/mybets.js',
  './commands/recap-channel.js',
  './commands/recap-lol-flex.js',
  './commands/recap-lol-flex-monthly.js',
  './commands/recap-lol-flex-weekly.js',
  './commands/recap-lol-solo.js',
  './commands/recap-lol-solo-monthly.js',
  './commands/recap-lol-solo-weekly.js',
  './commands/recap-paris.js',
  './commands/recap-valo.js',
  './commands/recap-valo-monthly.js',
  './commands/recap-valo-weekly.js',
  './commands/stats.js',
  './commands/track-lol-all.js',
  './commands/track-valo-all.js',
  './commands/track.js',
  './commands/untrack.js',
].forEach(file => {
  const command = require(file);
  client.commands.set(command.data.name, command);
});

const BET_ERROR_MESSAGES = {
  closed: '❌ Les paris sont fermés pour cette game (fenêtre de 5 minutes dépassée).',
  'already-bet': '❌ Tu as déjà parié sur cette game.',
  'insufficient-funds': '❌ Solde insuffisant — utilise `/balance` pour voir combien il te reste.',
  'no-round': '❌ Ce pari n\'est plus disponible.',
};

client.on('interactionCreate', async interaction => {
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command?.autocomplete) return;
    try { await command.autocomplete(interaction); } catch (error) { console.error('[autocomplete]', error); }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('bet:')) {
    const [, key, choice] = interaction.customId.split(':');
    const modal = new ModalBuilder().setCustomId(`betmodal:${key}:${choice}`).setTitle('Placer un pari');
    const amountInput = new TextInputBuilder()
      .setCustomId('amount').setLabel('Montant (points)').setStyle(TextInputStyle.Short)
      .setPlaceholder('ex: 100').setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
    try { await interaction.showModal(modal); } catch (error) { console.error('[betting:modal]', error.message); }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('betmodal:')) {
    const [, key, choice] = interaction.customId.split(':');
    const amount = Number.parseInt(interaction.fields.getTextInputValue('amount'), 10);
    if (!Number.isFinite(amount) || amount < 10) {
      await interaction.reply({ content: '❌ Montant invalide (minimum 10 points).', flags: MessageFlags.Ephemeral });
      return;
    }
    // placeBet fait plusieurs allers-retours Firebase séquentiels — on defer
    // en privé pour ne pas risquer de dépasser la fenêtre de 3s de Discord.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await placeBet(key, interaction.user.id, interaction.user.username, choice, amount);
    if (!result.ok) {
      await interaction.editReply(BET_ERROR_MESSAGES[result.reason] || '❌ Impossible de placer ce pari.');
      return;
    }
    const potentialGain = Math.round(amount * result.odds);
    await interaction.editReply('✅ Pari enregistré !');
    await interaction.channel.send(
      `🎲 **${interaction.user.username}** parie **${amount}** points ${betChoiceLabel(choice)} (cote x${result.odds}) — gain potentiel : **${potentialGain}** points.`,
    ).catch(() => {});
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[command:${interaction.commandName}]`, error);
    const payload = { content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
  }
});

function betChoiceLabel(choice) {
  return choice === 'win' ? "sur l'équipe suivie" : "sur l'équipe adverse";
}

// `color` = couleur de marque du jeu (résultats de fin de partie, en dehors
// win/loss). `startColor` = couleur des cartes "info" (game commencée, paris
// ouverts) — le rouge de marque Valorant est trop proche du rouge défaite
// (RESULT_COLORS.loss), d'où une couleur ambre dédiée pour ne pas les confondre.
const GAME_META = {
  valorant: { label: 'Valorant', color: 0xff4655, startColor: 0xffb703, emoji: '🔴' },
  lol: { label: 'League of Legends', color: 0x0ac8b9, startColor: 0x0ac8b9, emoji: '🔵' },
};

const VALORANT_MODE_LABELS_FR = {
  competitive: 'Compétitif', unrated: 'Non classé', spikerush: 'Spike Rush',
  deathmatch: 'Deathmatch', swiftplay: 'Swift Play', hurm: 'Team Deathmatch',
  ggteam: 'Escalade', onefa: 'Réplication', newmap: 'Nouvelle carte',
};

function formatValorantMode(mode) {
  return VALORANT_MODE_LABELS_FR[String(mode || '').toLowerCase()] || mode || '—';
}

// Une seule carte pour tout le groupe : Map/Mode sont partagés (même match),
// les répéter dans un embed par joueur n'apportait que du doublon — seul le
// side (qui peut différer si les joueurs sont sur des équipes opposées) reste
// affiché par joueur.
function buildValorantGroupEmbed(rosterPlayers) {
  const meta = GAME_META.valorant;
  const first = rosterPlayers[0]?.session;
  const lines = rosterPlayers.map(({ member, session: s }) => {
    const sideLabel = s.side ? (s.side === 'ATTAQUE' ? '⚔️ Attaque' : '🛡️ Défense') : null;
    return sideLabel ? `**${member.name}** — ${sideLabel}` : `**${member.name}**`;
  });
  return new EmbedBuilder()
    .setColor(meta.startColor)
    .setTimestamp(first?.ts ? new Date(first.ts) : new Date())
    .addFields(
      { name: 'Map', value: first?.mapClean || first?.map || '—', inline: true },
      { name: 'Mode', value: formatValorantMode(first?.mode), inline: true },
      { name: rosterPlayers.length > 1 ? 'Joueurs' : 'Joueur', value: lines.join('\n'), inline: false },
    );
}

// Borné : le bot tourne des mois, un Set non purgé grossirait d'une entrée
// par game jusqu'à saturer la mémoire.
const notifiedValorantMatches = createBoundedSet();

// Filet de sécurité en plus du matchId : pendant la sélection d'agents (LoL :
// champ select), le matchId communiqué par le script local peut ne pas encore
// être stable, et une reconnexion du flux Firebase (perte réseau temporaire)
// peut faire "oublier" une session déjà active puis la revoir active un peu
// plus tard, ce qui contourne le dédoublonnage par matchId et fait partir la
// même notification deux fois. On bloque donc aussi une notification de
// démarrage pour le même groupe exact de joueurs OLYCITY si elle vient de
// partir il y a moins de 20 minutes (largement plus long qu'une sélection
// d'agents + un flottement réseau, mais bien plus court que le temps entre
// deux games distinctes).
const START_DEDUPE_WINDOW_MS = 20 * 60 * 1000;
const recentValorantStarts = createExpiringMap(START_DEDUPE_WINDOW_MS); // "noms triés" -> timestamp

function alreadyNotifiedRecently(recentStarts, key) {
  return recentStarts.seenRecently(key);
}

// Même logique que LoL : regroupe les sessions actives partageant le même
// matchId pour détecter les stacks (2+ joueurs OLYCITY dans la même game).
async function notifyValorantGameStart(session, snapshot) {
  // Seules les files CLASSÉES sont notifiées, comme côté LoL où le script ne
  // suit déjà que SoloQ et Flex. Non classé, Swift Play, Spike Rush, Escalade,
  // Réplication et les deathmatchs n'ont ni enjeu de rang ni sens pour les
  // paris — leurs stats ne sont pas comparables à celles d'une game classée.
  if (!isRankedValorantMode(session.mode)) return;
  const matchId = session.matchId;
  if (matchId && notifiedValorantMatches.has(matchId)) return;

  const sameMatch = matchId
    ? Object.values(snapshot || {}).filter(s => s?.active && s.matchId === matchId)
    : [session];
  const rosterPlayers = sameMatch
    .map(s => ({ session: s, member: memberByIdentity(s) }))
    .filter(entry => entry.member);

  if (rosterPlayers.length === 0) {
    await recordDiscovered(session.playerName).catch(error => console.error('[discovered]', error.message));
    return;
  }

  const namesKey = rosterPlayers.map(({ member }) => member.name).sort().join(',');
  if (alreadyNotifiedRecently(recentValorantStarts, namesKey)) return;

  if (matchId) notifiedValorantMatches.add(matchId);

  const channelIds = new Set();
  rosterPlayers.forEach(({ member }) => {
    trackersForPlayerGame(member.name, 'valorant').forEach(tracker => channelIds.add(tracker.channelId));
  });
  if (channelIds.size === 0) return;

  const embeds = [buildValorantGroupEmbed(rosterPlayers)];
  const names = rosterPlayers.map(({ member }) => member.name).join(', ');
  const stackBanner = rosterPlayers.length > 1 ? `🔥 **STACK OLYCITY** — ${rosterPlayers.length} joueurs dans la même game !\n` : '';

  await Promise.all([...channelIds].map(async channelId => {
    try {
      const channel = await client.channels.fetch(channelId);
      await channel.send({ content: `${stackBanner}${GAME_META.valorant.emoji} **${names}** en game !`, embeds });
    } catch (error) {
      console.error(`[notify:valorant] échec envoi salon ${channelId} —`, error.message);
    }
  }));

  const bettingPlayers = rosterPlayers.map(({ session: s, member }) => ({
    member, rank: s.rank || null, championOrAgentName: null,
  }));
  // Un round de paris distinct par salon qui tracke la game (même game trackée
  // dans plusieurs serveurs → chacun a son propre message + pool de mises).
  [...channelIds].forEach(channelId => {
    openBettingRound('valorant', matchId, channelId, bettingPlayers, `${SITE_URL}/#live`).catch(error => console.error('[betting:open]', error.message));
  });
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const RESULT_COLORS = { win: 0x3fcf6f, loss: 0xff5f6d };

// Regroupe les boutons-liens en rangées de 5 (limite Discord par ActionRow).
function chunkButtonRows(buttons, size = 5) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += size) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + size)));
  }
  return rows;
}

// sessions : tableau de sessions terminées (1 par joueur OLYCITY). Quand
// plusieurs joueurs terminent la même game (même matchId), scheduleGroupedEnd
// les regroupe en amont pour qu'un seul message, avec un embed par joueur,
// parte par salon au lieu d'un message séparé pour chacun.
async function notifyValorantGameEnd(sessions) {
  const withResult = sessions.filter(s => s.result);
  const primary = withResult[0] || sessions[0];
  // Hors file classée, on s'arrête AVANT tout enregistrement : ni carte, ni
  // points de participation, ni award. Le garde était plus bas, ce qui laissait
  // une game non classée créditer des points de paris et alimenter les awards.
  // Aucun pari n'existe pour ces modes (la notif de début les écarte), donc il
  // n'y a rien à résoudre non plus.
  if (!isRankedValorantMode(primary.result?.mode || primary.mode)) return;

  const matchId = primary.matchId || primary.result?.matchId;
  const outcome = primary.result?.result === 'win' ? 'win' : primary.result?.result === 'loss' ? 'lose' : null;
  const betting = await resolveBetting('valorant', matchId, outcome).catch(error => {
    console.error('[betting:resolve]', error.message);
    return null;
  });

  const players = sessions
    .map(session => ({ session, member: memberByIdentity(session) }))
    .filter(({ member }) => member && trackersForPlayerGame(member.name, 'valorant').length > 0);
  if (players.length === 0) return;

  const channelIds = new Set();
  players.forEach(({ member }) => trackersForPlayerGame(member.name, 'valorant').forEach(t => channelIds.add(t.channelId)));

  const withResultPlayers = players.filter(p => p.session.result);

  // Pas de stats de fin de partie dispo pour personne (rare) — on annonce
  // quand même le remboursement des paris s'il y en avait, mais pas de résumé
  // de game. La même game pouvant être trackée dans plusieurs salons, chacun
  // n'affiche que son propre pool de paris (betting est indexé par channelId).
  if (withResultPlayers.length === 0) {
    await Promise.all([...channelIds].map(async channelId => {
      const bettingSection = formatBettingSection(betting?.[channelId]);
      if (!bettingSection) return;
      try {
        const channel = await client.channels.fetch(channelId);
        await channel.send(bettingSection);
      } catch (error) {
        console.error(`[notify:valorant-end] échec envoi salon ${channelId} —`, error.message);
      }
    }));
    return;
  }

  // Récompense/rang/awards calculés une seule fois par joueur (pas par salon),
  // pour ne pas les créditer en double si un joueur est tracké dans 2 salons.
  const playerData = await Promise.all(withResultPlayers.map(async ({ session, member }) => {
    const result = session.result;
    const localOutcome = result.result === 'win' ? 'win' : result.result === 'loss' ? 'lose' : null;
    const playReward = await creditPlayReward(member, localOutcome).catch(error => {
      console.error('[play-reward]', error.message);
      return null;
    });

    if (result?.rr?.delta) {
      recordRankGain('valorant', session.playerName, member.name, result.rr.delta)
        .catch(error => console.error('[rank-tracking]', error.message));
    }

    const kills = result.kills ?? 0;
    const deaths = result.deaths ?? 0;
    const isDeathmatch = isValorantDeathmatch(result.mode);
    const awardLines = [];
    if (isDeathmatch) {
      // Le compte de kills/morts en deathmatch n'a rien à voir avec un 5v5
      // classique (30 kills y est courant) — pas de masterchiasse/thirty bomb
      // ici, juste un compteur de participation.
      recordAward('deathmatch', member.id, member.name).catch(error => console.error('[valorant-awards]', error.message));
    } else if (deaths > 0 && kills < deaths * 0.5) {
      recordAward('masterchiasse', member.id, member.name).catch(error => console.error('[valorant-awards]', error.message));
      awardLines.push(`😂 Superbe masterchiasse de **${member.name}**`);
    } else if (kills > 30) {
      recordAward('thirtyBomb', member.id, member.name).catch(error => console.error('[valorant-awards]', error.message));
      awardLines.push(`💥 omg thirty bomb de **${member.name}** !!!`);
    }

    return { session, member, result, playReward, outcome: localOutcome, awardLines };
  }));

  const resultLabels = { win: 'Victoire', loss: 'Défaite', draw: 'Égalité', completed: 'Terminée' };
  const trackerGgUrl = matchId ? `https://tracker.gg/valorant/match/${matchId}` : null;
  const linkRow = trackerGgUrl
    ? new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('🔎 Voir sur tracker.gg').setStyle(ButtonStyle.Link).setURL(trackerGgUrl),
    )
    : null;

  const stackBanner = playerData.length > 1
    ? `🔥 **STACK OLYCITY** — ${playerData.length} joueurs dans la même game !\n`
    : '';

  await Promise.all([...channelIds].map(async channelId => {
    const channelPlayers = playerData.filter(({ member }) =>
      trackersForPlayerGame(member.name, 'valorant').some(t => t.channelId === channelId));
    if (channelPlayers.length === 0) return;

    const playerEmbeds = channelPlayers.map(({ member, result, playReward, outcome: localOutcome, awardLines }) => {
      const resultLabel = resultLabels[result.result] || 'Terminée';
      const resultIcon = result.result === 'win' ? '🏆' : result.result === 'loss' ? '💀' : '🎮';
      const rrLine = result.rr?.delta != null ? `${result.rr.delta >= 0 ? '+' : ''}${result.rr.delta} RR` : null;

      // Ex. « 📊 Ascendant 2 33 RR → **Ascendant 2 59 RR** ». Riot renvoie le
      // RR avant/après dans competitiveupdates ; il retombe sur le palier seul
      // quand il n'est pas disponible.
      const rankLine = buildRankProgressLine(result.rr);

      const summaryLine = [
        resultIcon,
        `${result.kills ?? 0}/${result.deaths ?? 0}/${result.assists ?? 0}`,
        result.acs != null ? `${result.acs} ACS` : null,
        result.hsPercent != null ? `${result.hsPercent}% HS` : null,
        result.score ? `${result.score.blue ?? 0}-${result.score.red ?? 0}` : null,
        result.durationSeconds ? formatDuration(result.durationSeconds) : null,
        resultLabel,
      ].filter(Boolean).join(' | ');

      const rewardLine = formatPlayReward(playReward, localOutcome);
      const descriptionParts = [
        rrLine, rankLine, '**Résumé de la partie**', summaryLine,
        awardLines.length ? `\n${awardLines.join('\n')}` : null,
        rewardLine ? `\n${rewardLine}` : null,
      ];

      const embed = new EmbedBuilder()
        .setColor(RESULT_COLORS[result.result] || GAME_META.valorant.color)
        .setAuthor({ name: `${member.name} — ${resultLabel} (${result.map || 'Valorant'})`, iconURL: member.avatar || undefined })
        .setDescription(descriptionParts.filter(Boolean).join('\n'))
        .setTimestamp();
      if (result.agentIcon) embed.setThumbnail(result.agentIcon);
      return embed;
    });

    const bettingSection = formatBettingSection(betting?.[channelId]);
    const finalEmbeds = playerEmbeds.slice(0, 9);
    if (bettingSection) {
      finalEmbeds.push(new EmbedBuilder().setColor(GAME_META.valorant.color).setDescription(bettingSection));
    }

    try {
      const channel = await client.channels.fetch(channelId);
      await channel.send({ content: stackBanner || undefined, embeds: finalEmbeds, components: linkRow ? [linkRow] : [] });
    } catch (error) {
      console.error(`[notify:valorant-end] échec envoi salon ${channelId} —`, error.message);
    }
  }));
}


// sessions : tableau de sessions terminées (1 par joueur OLYCITY) — voir le
// commentaire équivalent sur notifyValorantGameEnd pour le regroupement.
async function notifyLolGameEnd(sessions) {
  const withResult = sessions.filter(s => s.result);
  const primary = withResult[0] || sessions[0];

  // Hors file classée, on s'arrête AVANT tout enregistrement : ni résumé, ni
  // points de participation, ni suivi de rang. Aucun pari n'a pu être ouvert
  // sur ces games (la notif de début les écarte), donc rien à rembourser.
  if (isNonRankedLolQueue(primary.result?.queueId ?? primary.queueId)) return;

  const matchId = primary.matchId || primary.result?.matchId;
  const outcome = primary.result?.win === true ? 'win' : primary.result?.win === false ? 'lose' : null;
  const betting = await resolveBetting('lol', matchId, outcome).catch(error => {
    console.error('[betting:resolve]', error.message);
    return null;
  });

  const players = sessions
    .map(session => ({ session, member: memberByIdentity(session) }))
    .filter(({ member }) => member && trackersForPlayerGame(member.name, 'lol').length > 0);
  if (players.length === 0) return;

  const channelIds = new Set();
  players.forEach(({ member }) => trackersForPlayerGame(member.name, 'lol').forEach(t => channelIds.add(t.channelId)));

  const withResultPlayers = players.filter(p => p.session.result);

  // Pas de stats de fin de partie dispo pour personne (rare) — on annonce
  // quand même le remboursement des paris s'il y en avait, mais pas de résumé
  // de game. La même game pouvant être trackée dans plusieurs salons, chacun
  // n'affiche que son propre pool de paris (betting est indexé par channelId).
  if (withResultPlayers.length === 0) {
    await Promise.all([...channelIds].map(async channelId => {
      const bettingSection = formatBettingSection(betting?.[channelId]);
      if (!bettingSection) return;
      try {
        const channel = await client.channels.fetch(channelId);
        await channel.send(bettingSection);
      } catch (error) {
        console.error(`[notify:lol-end] échec envoi salon ${channelId} —`, error.message);
      }
    }));
    return;
  }

  // Récompense/rang/build calculés une seule fois par joueur (pas par salon),
  // pour ne pas les créditer en double si un joueur est tracké dans 2 salons.
  const playerData = await Promise.all(withResultPlayers.map(async ({ session, member }) => {
    const result = session.result;
    const localOutcome = result.win === true ? 'win' : result.win === false ? 'lose' : null;
    const playReward = await creditPlayReward(member, localOutcome).catch(error => {
      console.error('[play-reward]', error.message);
      return null;
    });

    if (result?.rankBefore?.tier && result?.rankAfter?.tier) {
      const beforePts = lolRankPoints(result.rankBefore);
      const afterPts = lolRankPoints(result.rankAfter);
      // queueId 420 = Solo/Duo, 440 = Flex — seules queues classées suivies
      // (live/index.js ne track déjà que celles-ci), trackées séparément
      // puisque la progression des deux n'a rien à voir. Toute autre valeur
      // est ignorée par sécurité plutôt que rangée dans "solo" par défaut.
      const queueBucket = result.queueId === 420 ? 'lol-solo' : result.queueId === 440 ? 'lol-flex' : null;
      if (queueBucket && beforePts != null && afterPts != null) {
        recordRankGain(queueBucket, session.playerName, member.name, afterPts - beforePts)
          .catch(error => console.error('[rank-tracking]', error.message));
      }
    }

    const files = [];
    let imageName = null;
    if (result.items?.length) {
      const buffer = await buildItemsImage(result.items).catch(() => null);
      if (buffer) {
        imageName = `build-${member.id}.png`;
        files.push({ attachment: buffer, name: imageName });
      }
    }

    return { session, member, result, playReward, outcome: localOutcome, files, imageName };
  }));

  const stackBanner = playerData.length > 1
    ? `🔥 **STACK OLYCITY** — ${playerData.length} joueurs dans la même game !\n`
    : '';

  await Promise.all([...channelIds].map(async channelId => {
    const channelPlayers = playerData.filter(({ member }) =>
      trackersForPlayerGame(member.name, 'lol').some(t => t.channelId === channelId));
    if (channelPlayers.length === 0) return;

    const allFiles = [];
    const playerEmbeds = channelPlayers.map(({ member, result, playReward, outcome: localOutcome, files, imageName }) => {
      const win = result.win;
      const resultLabel = win === true ? 'Victoire' : win === false ? 'Défaite' : 'Terminée';
      const resultIcon = win === true ? '🏆' : win === false ? '💀' : '🎮';

      const rankBefore = result.rankBefore;
      const rankAfter = result.rankAfter;
      const rankBeforeLabel = formatLolRank(rankBefore);
      const rankAfterLabel = formatLolRank(rankAfter);
      const rankChanged = rankBefore?.tier && rankAfter?.tier
        && (rankBefore.tier !== rankAfter.tier || rankBefore.division !== rankAfter.division);
      let rankLine = null;
      if (rankBeforeLabel && rankAfterLabel) {
        if (rankChanged) {
          const beforePts = lolRankPoints(rankBefore);
          const afterPts = lolRankPoints(rankAfter);
          const arrow = afterPts != null && beforePts != null && afterPts > beforePts ? 'up ⬆️' : 'down ⬇️';
          rankLine = `📊 ${rankBeforeLabel} → **${rankAfterLabel}** — Rank ${arrow} !`;
        } else {
          const delta = rankAfter.lp != null && rankBefore.lp != null ? rankAfter.lp - rankBefore.lp : null;
          rankLine = delta != null ? `📊 ${rankAfterLabel} (${delta >= 0 ? '+' : ''}${delta} LP)` : `📊 ${rankAfterLabel}`;
        }
      } else if (rankAfterLabel) {
        rankLine = `📊 ${rankAfterLabel}`;
      }

      const title = `${member.name} — ${resultLabel} (${result.queueDescription || 'LoL'})`;
      const summaryLine = [
        resultIcon,
        `${result.kills ?? 0}/${result.deaths ?? 0}/${result.assists ?? 0}`,
        result.killParticipation != null ? `${result.killParticipation}% KP` : null,
        `${result.cs ?? 0} cs`,
        result.level ? `Niveau ${result.level}` : null,
        result.durationLabel,
        resultLabel,
      ].filter(Boolean).join(' | ');

      const rewardLine = formatPlayReward(playReward, localOutcome);
      const descriptionParts = [
        rankLine, '**Résumé de la partie**', summaryLine,
        rewardLine ? `\n${rewardLine}` : null,
      ];

      const embed = new EmbedBuilder()
        .setColor(win === true ? RESULT_COLORS.win : win === false ? RESULT_COLORS.loss : GAME_META.lol.color)
        .setAuthor({ name: title, iconURL: result.champion?.image || member.avatar || undefined })
        .setDescription(descriptionParts.filter(Boolean).join('\n'))
        .setTimestamp();
      if (imageName) {
        embed.setImage(`attachment://${imageName}`);
        allFiles.push(...files);
      }
      return embed;
    });

    const dpmButtons = channelPlayers
      .map(({ session, member, result }) => {
        const url = dpmLolUrl(session.playerName, session.matchId || result.matchId || matchId);
        return url ? new ButtonBuilder().setLabel(`🔎 ${member.name} sur dpm.lol`).setStyle(ButtonStyle.Link).setURL(url) : null;
      })
      .filter(Boolean);

    const bettingSection = formatBettingSection(betting?.[channelId]);
    const finalEmbeds = playerEmbeds.slice(0, 9);
    if (bettingSection) {
      finalEmbeds.push(new EmbedBuilder().setColor(GAME_META.lol.color).setDescription(bettingSection));
    }

    try {
      const channel = await client.channels.fetch(channelId);
      await channel.send({
        content: stackBanner || undefined,
        embeds: finalEmbeds,
        files: allFiles,
        components: chunkButtonRows(dpmButtons),
      });
    } catch (error) {
      console.error(`[notify:lol-end] échec envoi salon ${channelId} —`, error.message);
    }
  }));
}


function buildLolPlayerEmbed(member, session) {
  const championName = session.champion?.name || 'Champion inconnu';
  const positionIcon = POSITION_ICONS[session.position] || '';
  const embed = new EmbedBuilder()
    .setColor(GAME_META.lol.color)
    .setAuthor({
      name: `${positionIcon ? `${positionIcon} ` : ''}${member.name} — ${championName}`,
      iconURL: session.champion?.image || member.avatar || undefined,
    });

  const descriptionLines = [];
  if (session.queueDescription || session.mode) descriptionLines.push(`🎮 ${session.queueDescription || session.mode}`);
  const rankLabel = formatLolRank(session.rank);
  if (rankLabel) descriptionLines.push(`📊 ${rankLabel}`);
  if (session.matchup?.name) {
    embed.setThumbnail(session.matchup.image || null);
    descriptionLines.push(`🆚 **${session.matchup.name}**`);
  }
  if (descriptionLines.length > 0) embed.setDescription(descriptionLines.join('\n'));

  return embed;
}

const notifiedLolMatches = createBoundedSet();
const recentLolStarts = createExpiringMap(START_DEDUPE_WINDOW_MS); // idem Valorant

// Une game LoL peut réunir plusieurs joueurs du roster OLYCITY : on regroupe
// toutes les sessions actives partageant le même matchId (gameId Riot) en un
// seul message, avec un embed par joueur (champion + matchup).
async function notifyLolGameStart(session, snapshot) {
  // Seules les files classées sont suivies : pas de notif ni de paris sur une
  // normale, un ARAM ou un Co-op vs IA.
  if (isNonRankedLolQueue(session.queueId)) return;

  const matchId = session.matchId;
  if (matchId && notifiedLolMatches.has(matchId)) return;

  const sameMatch = Object.values(snapshot || {}).filter(s => s?.active && s.matchId === matchId);
  const rosterPlayers = sameMatch
    .map(s => ({ session: s, member: memberByIdentity(s) }))
    .filter(entry => entry.member);

  if (rosterPlayers.length === 0) {
    await recordDiscovered(session.playerName).catch(error => console.error('[discovered]', error.message));
    return;
  }

  const namesKey = rosterPlayers.map(({ member }) => member.name).sort().join(',');
  if (alreadyNotifiedRecently(recentLolStarts, namesKey)) return;

  if (matchId) notifiedLolMatches.add(matchId);

  const channelIds = new Set();
  rosterPlayers.forEach(({ member }) => {
    trackersForPlayerGame(member.name, 'lol').forEach(tracker => channelIds.add(tracker.channelId));
  });
  if (channelIds.size === 0) return;

  const embeds = rosterPlayers.map(({ session: s, member }) => buildLolPlayerEmbed(member, s)).slice(0, 10);
  const names = rosterPlayers.map(({ member }) => member.name).join(', ');
  const stackBanner = rosterPlayers.length > 1 ? `🔥 **STACK OLYCITY** — ${rosterPlayers.length} joueurs dans la même game !\n` : '';

  await Promise.all([...channelIds].map(async channelId => {
    try {
      const channel = await client.channels.fetch(channelId);
      await channel.send({ content: `${stackBanner}${GAME_META.lol.emoji} **${names}** en game LoL !`, embeds });
    } catch (error) {
      console.error(`[notify:lol] échec envoi salon ${channelId} —`, error.message);
    }
  }));

  const bettingPlayers = rosterPlayers.map(({ session: s, member }) => ({
    member, rank: s.rank || null, championOrAgentName: s.champion?.name || null,
  }));
  const viewUrl = porofessorUrl(sameMatch[0]?.region, session.playerName);
  [...channelIds].forEach(channelId => {
    openBettingRound('lol', matchId, channelId, bettingPlayers, viewUrl).catch(error => console.error('[betting:open]', error.message));
  });
}

function porofessorUrl(region, playerName) {
  if (!region || !playerName) return null;
  const [gameName, tagLine] = playerName.split('#');
  if (!gameName || !tagLine) return null;
  return `https://porofessor.gg/live/${region}/${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
}

function dpmLolUrl(playerName, matchId) {
  if (!playerName || !matchId) return null;
  const [gameName, tagLine] = playerName.split('#');
  if (!gameName || !tagLine) return null;
  return `https://dpm.lol/${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}?match=${encodeURIComponent(matchId)}`;
}

function buildBettingComponents(key, round, viewUrl) {
  const teamLabel = round.players.length <= 2 ? round.players.join(' & ') : `${round.players[0]} & co`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bet:${key}:win`).setLabel(`✅ Équipe de ${teamLabel} (x${round.oddsWin})`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`bet:${key}:lose`).setLabel(`❌ Équipe adverse (x${round.oddsLose})`).setStyle(ButtonStyle.Danger),
  );
  if (viewUrl) {
    row.addComponents(new ButtonBuilder().setLabel('🔎 Voir la game').setStyle(ButtonStyle.Link).setURL(viewUrl));
  }
  return [row];
}

async function disableBettingMessage(channelId, messageId) {
  if (!messageId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message || !message.components[0]) return;
    const disabledRow = ActionRowBuilder.from(message.components[0]);
    disabledRow.components.forEach(c => c.setDisabled(true));
    await message.edit({ components: [disabledRow] }).catch(() => {});
  } catch (error) {
    console.error('[betting:disable]', error.message);
  }
}

// setTimeout de fermeture des paris par round — purement pour l'annonce dans
// le salon, la fermeture réelle (refus des paris tardifs) est déjà garantie
// côté betting.js via `closesAt`, même si le bot redémarre entre-temps.
const bettingCloseTimers = new Map();

async function openBettingRound(game, matchId, channelId, rosterPlayers, viewUrl) {
  if (!channelId || !matchId || rosterPlayers.length === 0) return;
  const { key, round, isNew } = await openRound({ game, matchId, channelId, rosterPlayers });
  if (!isNew) return;

  let sentMessage = null;
  try {
    const channel = await client.channels.fetch(channelId);
    const minutes = Math.round(BETTING_WINDOW_MS / 60000);
    const probabilityPct = round.probability != null ? Math.round(round.probability * 100) : null;
    sentMessage = await channel.send({
      content: `🎲 **Paris ouverts !** ${round.players.join(', ')} en game ${GAME_META[game].label}.`,
      embeds: [new EmbedBuilder()
        .setColor(GAME_META[game].startColor)
        .setDescription(
          `Cote équipe suivie : **x${round.oddsWin}** · Cote équipe adverse : **x${round.oddsLose}**\n` +
          (probabilityPct != null ? `Probabilité de victoire estimée : **${probabilityPct}%**\n` : '') +
          `_${round.explanation}_\n` +
          `Paris ouverts pendant **${minutes} minutes**.`,
        )],
      components: buildBettingComponents(key, round, viewUrl),
    });
    await attachMessage(key, sentMessage.id);
  } catch (error) {
    console.error('[betting:announce]', error.message);
  }

  const timer = setTimeout(async () => {
    bettingCloseTimers.delete(key);
    const closed = await closeRound(key).catch(() => null);
    if (!closed) return;
    await disableBettingMessage(channelId, closed.messageId);
    try {
      const channel = await client.channels.fetch(channelId);
      await channel.send('⏱️ Paris fermés pour cette game.');
    } catch (error) {
      console.error('[betting:close-announce]', error.message);
    }
  }, BETTING_WINDOW_MS);
  timer.unref?.();
  bettingCloseTimers.set(key, timer);
}

// outcome: 'win' | 'lose' | null (null = résultat indisponible, on rembourse).
// Ne poste plus de message lui-même — retourne les données pour que l'appelant
// les intègre au même message que le résumé de fin de game (K/D, résultat...).
// La même game pouvant être trackée dans plusieurs salons (donc plusieurs
// rounds distincts, un par salon), on les résout tous et on retourne le
// résultat de chacun indexé par channelId — chaque salon n'affichera que
// son propre pool de paris. Retourne null si aucun round n'existait.
async function resolveBetting(game, matchId, outcome) {
  if (!matchId) return null;
  const entries = await roundsForMatch(game, matchId);
  if (entries.length === 0) return null;

  const byChannel = {};
  for (const [key, round] of entries) {
    const timer = bettingCloseTimers.get(key);
    if (timer) { clearTimeout(timer); bettingCloseTimers.delete(key); }
    await disableBettingMessage(round.channelId, round.messageId);

    if (!outcome) {
      await cancelRound(key);
      byChannel[round.channelId] = { cancelled: true, results: [] };
      continue;
    }

    const resolved = await resolveRound(key, outcome);
    if (resolved) byChannel[round.channelId] = { cancelled: false, results: resolved.results };
  }
  return byChannel;
}

// Récompense de participation (indépendante des paris) : 150 pts en cas de
// victoire, 50 en cas de défaite, créditée au joueur du roster qui a joué —
// nécessite que son avatar de roster pointe vers son ID Discord (cf roster.js).
async function creditPlayReward(member, outcome) {
  if (!member.discordId || !outcome) return null;
  let username = null;
  try { username = (await client.users.fetch(member.discordId)).username; } catch { /* best effort */ }
  return rewardForGamePlayed(member.discordId, outcome === 'win', username);
}

function formatPlayReward(amount, outcome) {
  if (!amount) return null;
  return `🎁 **+${amount} points** pour avoir ${outcome === 'win' ? 'gagné' : 'joué'} cette partie.`;
}

// Construit le bloc "💰 Paris" à intégrer dans le message de fin de game.
// Retourne null s'il n'y a rien à afficher (aucun round, ou round sans paris).
function formatBettingSection(betting) {
  if (!betting) return null;
  if (betting.cancelled) return '↩️ **Paris** — résultat indisponible, remboursés intégralement.';
  if (betting.results.length === 0) return null;
  const lines = betting.results.map(r => {
    const streakNote = r.won && r.streak >= 3 ? ` 🔥x${r.streak}` : '';
    return `${r.won ? '✅' : '❌'} **${r.username}** — ${r.amount} pts ${betChoiceLabel(r.choice)}${r.won ? ` → **+${r.payout}**` : ''}${streakNote}`;
  });
  return `**💰 Paris**\n${lines.join('\n')}`;
}

// Détection du début de game par transition inactive→active, et de la fin de
// game dès qu'un `result` apparaît sur une session inactive.
// Le premier snapshot reçu à la connexion sert uniquement de référence (pas de
// spam pour des games déjà en cours au démarrage du bot).
// Tolérance avant de considérer une clé de session comme réellement disparue :
// un snapshot Firebase peut momentanément ne pas inclure une clé pourtant
// toujours active côté DB (ex: reconnexion du flux SSE) — la purger tout de
// suite fait perdre la mémoire "déjà notifiée", et sa réapparition juste après
// est alors traitée comme une toute nouvelle game (double notification).
const SESSION_MISSING_TOLERANCE = 2;

// Le script local pousse active:false SANS résultat d'abord, puis le résultat
// arrive séparément quelques secondes après (le temps de récupérer les stats
// via l'API Riot) — sauf pour un dodge, où aucun résultat ne viendra jamais.
// Comme les deux cas sont indiscernables sur l'instant, on attend ce délai de
// grâce avant de conclure à un remboursement ; si le résultat arrive entre
// temps, on notifie normalement à la place.
const NO_RESULT_GRACE_MS = 25 * 1000;

// Deux joueurs OLYCITY dans la même game terminent leur poll indépendamment
// l'un de l'autre (cycles décalés de quelques secondes) — on attend une
// courte fenêtre après la fin détectée d'un joueur pour laisser le temps aux
// autres résultats de la même game d'arriver, puis on envoie un seul message
// groupé (un embed par joueur) au lieu d'un message séparé pour chacun.
const GROUPED_END_WINDOW_MS = 8 * 1000;
const pendingGroupedEnds = new Map(); // "game:matchId" -> { sessions: Map(clé session -> session), timer }

function scheduleGroupedEnd(game, sessionKey, session) {
  const matchId = session?.matchId || session?.result?.matchId;
  const notify = game === 'lol' ? notifyLolGameEnd : notifyValorantGameEnd;

  // Pas de matchId exploitable (rare) : impossible de regrouper, on notifie ce
  // joueur seul immédiatement.
  if (!matchId) {
    notify([session]).catch(error => console.error(`[notify:${game}-end]`, error.message));
    return;
  }

  const groupKey = `${game}:${matchId}`;
  let pending = pendingGroupedEnds.get(groupKey);
  if (!pending) {
    pending = { sessions: new Map(), timer: null };
    pendingGroupedEnds.set(groupKey, pending);
  }
  pending.sessions.set(sessionKey, session);
  if (pending.timer) clearTimeout(pending.timer);
  pending.timer = setTimeout(() => {
    pendingGroupedEnds.delete(groupKey);
    notify([...pending.sessions.values()]).catch(error => console.error(`[notify:${game}-end]`, error.message));
  }, GROUPED_END_WINDOW_MS);
  pending.timer.unref?.();
}

function watchGameSessions(game, firebasePath) {
  const previousActive = new Map();
  const resultNotified = new Set();
  const missingSince = new Map(); // clé -> nb de snapshots consécutifs sans cette clé
  const pendingNoResultTimers = new Map(); // clé -> timer d'attente du résultat
  // Comme pour les fins de partie, deux joueurs OLYCITY dans la même game
  // publient leur session Firebase à des cycles de poll indépendants (leurs
  // scripts locaux respectifs) — au moment exact où le premier passe actif,
  // le second peut ne pas encore être présent, ou pas encore sur le même
  // matchId stabilisé (le matchId peut prendre du temps à se stabiliser
  // pendant la sélection d'agent). On attend une fenêtre plus généreuse
  // qu'en fin de partie avant d'envoyer la notif de départ, en relisant le
  // DERNIER snapshot reçu (pas celui capturé au moment de la programmation)
  // pour laisser le temps aux coéquipiers plus lents d'apparaître. Repéré en
  // prod : avec 10s, un coéquipier resté "actif" en continu depuis le
  // pregame (donc sans transition inactif→actif détectable de notre côté)
  // n'était rattrapé que par le lookup sameMatch du premier joueur — et son
  // matchId n'avait pas toujours fini de se stabiliser à temps.
  const GROUPED_START_WINDOW_MS = 25 * 1000;
  const pendingStartTimers = new Map(); // matchId -> timer
  let latestSnapshot = null;
  let isFirstSnapshot = true;

  const clearPendingTimer = key => {
    const timer = pendingNoResultTimers.get(key);
    if (timer) { clearTimeout(timer); pendingNoResultTimers.delete(key); }
  };

  const scheduleGroupedStart = session => {
    const matchId = session.matchId;
    // Pas de matchId exploitable (rare) : impossible de regrouper, on notifie
    // tout de suite avec ce qu'on a.
    if (!matchId) {
      const notifyStart = game === 'lol' ? notifyLolGameStart(session, latestSnapshot) : notifyValorantGameStart(session, latestSnapshot);
      notifyStart.catch(error => console.error(`[notify:${game}]`, error.message));
      return;
    }
    if (pendingStartTimers.has(matchId)) return; // déjà programmé pour cette game
    const timer = setTimeout(() => {
      pendingStartTimers.delete(matchId);
      const notifyStart = game === 'lol' ? notifyLolGameStart(session, latestSnapshot) : notifyValorantGameStart(session, latestSnapshot);
      notifyStart.catch(error => console.error(`[notify:${game}]`, error.message));
    }, GROUPED_START_WINDOW_MS);
    timer.unref?.();
    pendingStartTimers.set(matchId, timer);
  };

  watchNode(firebasePath, snapshot => {
    latestSnapshot = snapshot;
    const entries = Object.entries(snapshot || {});
    const seenKeys = new Set();

    for (const [key, session] of entries) {
      seenKeys.add(key);
      missingSince.delete(key);
      const active = Boolean(session?.active);

      if (!active) {
        if (session?.result) {
          clearPendingTimer(key);
          if (!resultNotified.has(key)) {
            resultNotified.add(key);
            // Un état déjà inactif au tout premier snapshot correspond à une
            // game terminée AVANT que le bot ne se (re)connecte (redémarrage,
            // coupure réseau...) — pas un nouvel événement. Sans ce garde-fou,
            // il ne serait notifié qu'au prochain événement sur N'IMPORTE
            // QUELLE autre clé (la boucle réexamine tout à chaque callback),
            // avec potentiellement plusieurs heures de retard et l'air d'une
            // "nouvelle" fin de partie.
            if (!isFirstSnapshot) {
              scheduleGroupedEnd(game, key, session);
            }
          }
        } else if (!resultNotified.has(key) && !pendingNoResultTimers.has(key) && !isFirstSnapshot) {
          const timer = setTimeout(() => {
            pendingNoResultTimers.delete(key);
            if (resultNotified.has(key)) return; // un résultat est arrivé entre temps
            resultNotified.add(key);
            scheduleGroupedEnd(game, key, session);
          }, NO_RESULT_GRACE_MS);
          timer.unref?.();
          pendingNoResultTimers.set(key, timer);
        }
        previousActive.set(key, false);
        continue;
      }

      resultNotified.delete(key); // nouvelle game : on pourra renotifier sa fin plus tard
      clearPendingTimer(key); // une nouvelle game a démarré — le remboursement en attente pour la précédente ne s'applique plus
      if (previousActive.get(key)) continue; // déjà actif au tour précédent
      if (isFirstSnapshot) { previousActive.set(key, true); continue; }

      const playerName = session?.playerName;
      if (!playerName) continue; // identité pas encore connue, on retentera au prochain événement

      previousActive.set(key, true);
      scheduleGroupedStart(session);
    }

    for (const key of previousActive.keys()) {
      if (seenKeys.has(key)) continue;
      const misses = (missingSince.get(key) || 0) + 1;
      if (misses < SESSION_MISSING_TOLERANCE) {
        missingSince.set(key, misses);
        continue; // absence isolée tolérée — on garde la clé en mémoire
      }
      missingSince.delete(key);
      previousActive.delete(key); resultNotified.delete(key);
      clearPendingTimer(key);
    }

    isFirstSnapshot = false;
  }, error => console.error(`[firebase:${game}]`, error.message));
}

client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag} — pid=${process.pid}`);
  await ensureRoster();
  await loadTrackersOnce();
  startTrackerSync();
  watchGameSessions('valorant', 'live/sessions');
  watchGameSessions('lol', 'live/lolSessions');
  startWeeklyScheduler(client);
  startDailyRecapScheduler();
  startLolSoloRecapScheduler(client);
  startLolFlexRecapScheduler(client);
  startLolSoloWeeklyRecapScheduler(client);
  startLolFlexWeeklyRecapScheduler(client);
  startLolSoloMonthlyRecapScheduler(client);
  startLolFlexMonthlyRecapScheduler(client);
  startValoDailyRecapScheduler(client);
  startValoWeeklyRecapScheduler(client);
  startValoMonthlyRecapScheduler(client);
  startLeaderboardScheduler(client);
  console.log('👂 Écoute des sessions Valorant et LoL en cours...');
});

client.on('error', error => console.error('[client:error]', error));
client.on('warn', message => console.warn('[client:warn]', message));

client.login(DISCORD_TOKEN).catch(error => console.error('[startup] login() a échoué —', error));

// Exposé pour les tests : vérifier qu'aucun message ne part en deathmatch
// exige d'exercer réellement le chemin de notification, pas seulement le
// prédicat de mode.
module.exports = { __test: { notifyValorantGameStart, notifyValorantGameEnd, notifyLolGameStart, notifyLolGameEnd } };
