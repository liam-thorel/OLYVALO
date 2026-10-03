// Presentation only: a connected script does not prove that its player is ready.
// Confirmed match states outrank incidental presence/standby fields.
export function normalizeLolClientState(client = {}) {
  const phases = {
    Lobby:['idle', 'menu'], Matchmaking:['idle', 'queue'],
    ReadyCheck:['idle', 'ready-check'], ChampSelect:['agent-select', 'agent-select'],
    GameStart:['idle', 'loading'], InProgress:['in-game', 'in-game'],
    Reconnect:['in-game', 'reconnect'], WaitingForStats:['game-ended', 'ended'],
    PreEndOfGame:['game-ended', 'ended'], EndOfGame:['game-ended', 'ended'],
  };
  const [state, activity] = phases[client.phase] || ['idle', 'unknown'];
  return { ...client, online:client.connected === true, state, activity, riotClient:client.connected === true };
}

export function liveClientStatus(client = {}, { recovering = false } = {}) {
  if (client.online === false || client.state === 'stopped') return { key:'offline', label:'Script arrêté', tone:'offline' };
  if (recovering) return { key:'recovering', label:'Signal interrompu', tone:'error' };
  if (client.state === 'in-game') return {
    key:'inGame', label:client.activity === 'reconnect' ? 'Reconnexion à la partie' : 'Partie en cours', tone:'in-game',
  };
  if (client.state === 'agent-select') return { key:'agentSelect', label:'Sélection en cours', tone:'agent-select' };
  const legacyStandby = client.riotClient === true && client.state === 'error'
    && /^Presence:\s*HTTP 404$/i.test(String(client.error || '').trim());
  if (client.state === 'error' && !legacyStandby) return { key:'issues', label:'Erreur de synchronisation', tone:'error' };
  if (client.state === 'riot-offline' || client.riotClient === false) return { key:'clientClosed', label:'Client Riot non détecté', tone:'online' };
  if (client.state === 'game-ended') return { key:'ended', label:'Partie terminée', tone:'idle' };
  if (['idle', 'online'].includes(client.state)) {
    const count = value => typeof value === 'number' ? value
      : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    const size = count(client.partySize), capacity = count(client.partyCapacity);
    const party = Number.isInteger(size) && Number.isInteger(capacity)
      && size > 0 && capacity >= size && capacity <= 100 ? `${size}/${capacity}` : '';
    const activities = {
      menu:{ key:'menu', label:party ? `Dans le lobby · ${party}` : 'Dans le menu', tone:'idle' },
      queue:{ key:'queue', label:party ? `En recherche · ${party}` : 'En recherche de partie', tone:'agent-select' },
      away:{ key:'away', label:'Absent', tone:'away' },
      'ready-check':{ key:'loading', label:'Partie trouvée', tone:'agent-select' },
      loading:{ key:'loading', label:'Chargement de la partie', tone:'agent-select' },
    };
    if (activities[client.activity]) return activities[client.activity];
  }
  if (client.riotClient === true || client.standby || legacyStandby) return { key:'clientOpen', label:'Client Riot ouvert', tone:'idle' };
  return { key:'scriptOnly', label:'Script connecté', tone:'online' };
}

export function liveClientSummaryText(summary = {}) {
  return [
    summary.inGame && `${summary.inGame} en partie`,
    summary.agentSelect && `${summary.agentSelect} en sélection`,
    summary.queue && `${summary.queue} en recherche`,
    summary.loading && `${summary.loading} en chargement`,
    summary.menu && `${summary.menu} dans le menu`,
    summary.away && `${summary.away} absent${summary.away > 1 ? 's' : ''}`,
    summary.clientOpen && `${summary.clientOpen} client${summary.clientOpen > 1 ? 's' : ''} Riot ouvert${summary.clientOpen > 1 ? 's' : ''}`,
    summary.clientClosed && `${summary.clientClosed} sans client Riot détecté`,
    summary.ended && `${summary.ended} partie${summary.ended > 1 ? 's' : ''} terminée${summary.ended > 1 ? 's' : ''}`,
    summary.scriptOnly && `${summary.scriptOnly} état${summary.scriptOnly > 1 ? 's' : ''} de jeu inconnu${summary.scriptOnly > 1 ? 's' : ''}`,
    summary.issues && `${summary.issues} en erreur`,
  ].filter(Boolean).join(' · ');
}

export function liveWaitingState(summary = {}) {
  if (summary.inGame) return { title:'Partie détectée', detail:'Le script transmet les informations de la partie.' };
  if (summary.agentSelect) return { title:'Sélection en cours', detail:'Les compositions apparaîtront dès que la map sera connue.' };
  if (summary.loading) return { title:'Partie en préparation', detail:'Le Live suivra automatiquement le chargement.' };
  if (summary.queue) return { title:'Recherche de partie en cours', detail:'Le Live apparaîtra lorsqu’une partie sera trouvée.' };
  if (summary.issues) return { title:'Suivi à vérifier', detail:'Le script est connecté mais ne peut pas confirmer l’état du jeu.' };
  return {
    title:`${summary.total || 0} script${summary.total === 1 ? '' : 's'} connecté${summary.total === 1 ? '' : 's'}`,
    detail:summary.total && summary.clientClosed === summary.total
      ? 'Ouvre le jeu pour que le script puisse détecter ta partie.'
      : 'Aucune partie confirmée pour le moment. Le suivi est automatique.',
  };
}
