const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ICON_SIZE = 32;
const GAP = 3;

// Compose une rangée d'icônes d'items (URLs Data Dragon) en une seule image
// PNG, pour reproduire visuellement un "build" façon overlay LoL classique.
// Retourne un Buffer PNG, ou null si aucune icône n'a pu être chargée.
async function buildItemsImage(items) {
  const urls = (items || []).map(item => item?.image).filter(Boolean);
  if (urls.length === 0) return null;

  const images = await Promise.all(urls.map(url => loadImage(url).catch(() => null)));
  const loaded = images.filter(Boolean);
  if (loaded.length === 0) return null;

  const canvas = createCanvas(loaded.length * ICON_SIZE + (loaded.length - 1) * GAP, ICON_SIZE);
  const ctx = canvas.getContext('2d');
  loaded.forEach((image, index) => {
    ctx.drawImage(image, index * (ICON_SIZE + GAP), 0, ICON_SIZE, ICON_SIZE);
  });

  return canvas.encode('png');
}

module.exports = { buildItemsImage };
