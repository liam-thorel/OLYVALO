// Native, independent links: one click downloads only the requested tool.
export function updateScriptDownload(button, updateNeeded = false, version = '') {
  if (!button) return;
  button.hidden = false;
  const label = button.querySelector('[data-download-label]');
  if (label) label.textContent = updateNeeded ? 'Mettre à jour le script' : 'Télécharger le script';
  button.title = version
    ? `Script OLYCITY Live pour Windows · dernière version publiée : v${version}`
    : 'Script OLYCITY Live pour Windows · archive ZIP';
}
