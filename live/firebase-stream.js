/**
 * Écoute continue d'un nœud Firebase (flux SSE de l'API REST), partagée par le
 * livechat et le signal de mise à jour.
 *
 * Firebase redirige parfois le flux vers un autre serveur, coupe sans prévenir
 * ou laisse une connexion morte ouverte (Wi-Fi reconnecté) : on suit les
 * redirections, on se reconnecte avec un délai croissant, et un flux qui n'a
 * plus rien reçu depuis 90 s — pas même le keep-alive envoyé toutes les ~30 s —
 * est rouvert.
 */
const https = require('https');
const { createSseParser } = require('./livechat-utils.js');

const STREAM_STALL_MS = 90 * 1000;

function openFirebaseStream({ host, path, onEvent }) {
  let stream = null;
  let lastEventAt = 0;
  let reconnectDelay = 2000;
  let stopped = false;

  function connect(url = `https://${host}/${path}.json`, redirects = 3) {
    if (stopped) return;
    const parse = createSseParser(({ event, data }) => {
      lastEventAt = Date.now();
      if (event === 'put' || event === 'patch') {
        reconnectDelay = 2000;
        onEvent(event, data);
      } else if (event === 'cancel' || event === 'auth_revoked') {
        stream?.destroy();
      }
    });
    const request = https.get(url, { headers: { Accept: 'text/event-stream' } }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        connect(new URL(res.headers.location, url).toString(), redirects - 1);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); request.destroy(new Error(`HTTP ${res.statusCode}`)); return; }
      lastEventAt = Date.now();
      res.setEncoding('utf8');
      res.on('data', parse);
      res.on('end', retry);
      res.on('error', () => {});
    });
    request.on('error', () => {});
    request.on('close', retry);
    stream = request;

    let retried = false;
    function retry() {
      if (retried || stopped || stream !== request) return;
      retried = true;
      stream = null;
      const delay = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, 60000);
      setTimeout(() => connect(), delay).unref?.();
    }
  }

  connect();
  const watchdog = setInterval(() => {
    if (stream && Date.now() - lastEventAt > STREAM_STALL_MS) stream.destroy();
  }, 15000);
  watchdog.unref?.();

  return {
    stop() {
      stopped = true;
      clearInterval(watchdog);
      stream?.destroy();
    },
  };
}

module.exports = { openFirebaseStream, STREAM_STALL_MS };
