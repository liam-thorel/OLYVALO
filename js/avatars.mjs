const AVATAR_COLORS = {
  Nico: '#ff4656',
  Liam: '#3fcfcf',
  Rayhan: '#f5c842',
  Mathis: '#a87fff',
  Noé: '#ff8200',
  Guest: '#8992aa',
};

function escapeAttribute(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function avatarLayersHTML(name, avatarUrl = '', fallbackImageUrl = '') {
  const label = String(name || '?').trim() || '?';
  const initial = escapeAttribute(Array.from(label)[0]?.toUpperCase() || '?');
  const safeLabel = escapeAttribute(label);
  const color = AVATAR_COLORS[label] || '#8992aa';
  const fallbackImage = fallbackImageUrl
    ? `<img class="user-avatar-fallback-image" src="${escapeAttribute(fallbackImageUrl)}" alt="" onerror="this.remove()">`
    : '';
  const primaryImage = avatarUrl
    ? `<img class="user-avatar-primary" src="${escapeAttribute(avatarUrl)}" alt="Photo de ${safeLabel}" onerror="this.remove()">`
    : '';

  return `<span class="user-avatar-initial" style="--avatar-color:${color}">${initial}</span>${fallbackImage}${primaryImage}`;
}
