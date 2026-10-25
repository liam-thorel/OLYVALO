// Fenêtre de l'extension : compte Discord, et réactivation à distance du
// livechat pour Liam (le Worker refuse tout autre compte).
const $ = id => document.getElementById(id);
const ask = message => chrome.runtime.sendMessage(message);
const status = (text, kind = '') => { $('status').textContent = text; $('status').className = `status ${kind}`; };

async function render() {
  const res = await ask({ type: 'account' });
  const me = res?.ok ? res.result : null;
  const box = $('account');
  box.textContent = '';
  if (me?.member) {
    if (me.member.avatar) { const img = document.createElement('img'); img.src = me.member.avatar; img.alt = ''; box.appendChild(img); }
    const name = document.createElement('span');
    name.textContent = `${me.member.name} · connecté avec Discord`;
    box.appendChild(name);
    const out = document.createElement('button');
    out.className = 'ghost';
    out.textContent = 'Se déconnecter';
    out.addEventListener('click', async () => { await ask({ type: 'logout' }); render(); });
    box.after(out);
  } else {
    const login = document.createElement('button');
    login.className = 'discord';
    login.textContent = 'Se connecter avec Discord';
    login.addEventListener('click', async () => {
      status('Connexion…');
      const result = await ask({ type: 'login' });
      if (!result?.ok) status(result?.error || 'Connexion impossible.', 'err');
      else if (!result.result) status('Ton compte Discord ne fait pas partie du roster OLYCITY.', 'err');
      else status('');
      location.reload();
    });
    box.appendChild(login);
  }
  $('admin').hidden = !me?.admin;
  if (me?.admin) {
    const targets = await ask({ type: 'targets' });
    (targets?.ok ? targets.result : []).forEach(member => {
      const option = document.createElement('option');
      option.value = member.id;
      option.textContent = `${member.muted ? '🔇 ' : member.online ? '● ' : '○ '}${member.name}`;
      $('who').appendChild(option);
    });
  }
}

$('reenable').addEventListener('click', async () => {
  status('Envoi…');
  const res = await ask({ type: 'reenable', target: $('who').value });
  status(res?.ok ? 'Livechat réactivé.' : res?.error || 'Impossible.', res?.ok ? 'ok' : 'err');
});

render();
