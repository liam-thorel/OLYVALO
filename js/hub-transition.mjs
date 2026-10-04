/**
 * Passage animé du tracker vers olycity.fr : la roue du logo grandit et
 * glisse jusqu'à sa place au centre de l'accueil du hub, puis la page change.
 *
 * Les deux sites sont des ORIGINES différentes (tracker.olycity.fr et
 * olycity.fr) : les transitions natives entre documents ne fonctionnent
 * qu'au sein d'une même origine. On reproduit donc l'effet à la main :
 *   1. une copie de la roue du hub (même SVG) se pose sur la roue du tracker ;
 *   2. elle vole jusqu'à la position EXACTE qu'aura la roue sur le hub, en
 *      finissant sur un tour complet — l'angle où la roue du hub démarre ;
 *   3. le reste de la page s'efface vers le fond du hub ;
 *   4. on navigue vers olycity.fr/?roue : le hub affiche sa roue en place
 *      tout de suite, et fait apparaître le reste autour d'elle.
 */

const DURATION_MS = 780;
// Même courbe que les cartes du hub : la roue « atterrit » dans son décor.
const EASING = 'cubic-bezier(.22,1,.36,1)';
// Fond du hub (--bg d'olycity-hub/index.html).
const HUB_BACKGROUND = '#0a0c10';
// Ombre portée de la roue du hub (.hero img) : elle apparaît pendant le vol
// pour que l'arrivée ne la fasse pas surgir d'un coup.
const HUB_SHADOW = 'drop-shadow(0 10px 30px rgba(255,70,86,.25))';
const SPIN_DEG_PER_SEC = 30; // le hub fait un tour en 12 s

const clamp = (min, value, max) => Math.min(max, Math.max(min, value));

/**
 * Rectangle de la roue sur l'accueil du hub, pour une fenêtre donnée.
 *
 * Reproduit le CSS d'olycity-hub/index.html — À GARDER SYNCHRONISÉ :
 *   main  { padding-top: clamp(40px, 8vh, 96px) }   (premier élément de la page)
 *   .hero img { width: clamp(84px, 12vw, 112px); height: auto }  (SVG 200×220)
 *   .hero centré horizontalement.
 *
 * `innerWidth`/`innerHeight` servent aux unités vw/vh, qui incluent la barre
 * de défilement ; `clientWidth` sert au centrage, qui ne l'inclut pas.
 */
export function hubLogoRect({ innerWidth, innerHeight, clientWidth = innerWidth }) {
  const width = clamp(84, innerWidth * 0.12, 112);
  const height = width * 220 / 200;
  return {
    left: (clientWidth - width) / 2,
    top: clamp(40, innerHeight * 0.08, 96),
    width,
    height,
  };
}

/**
 * Angle de fin du vol : le premier tour complet au-delà d'un demi-tour.
 * La roue du hub démarre à 0° : finir sur un multiple de 360° évite le saut.
 */
export function landingAngle(startDeg) {
  return Math.ceil((startDeg + 180) / 360) * 360;
}

/** Transformation qui pose la roue (taille finale) sur sa position de départ. */
export function startTransform(from, to) {
  const scale = from.width / to.width;
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${scale})`;
}

/** Un clic qui doit ouvrir un onglet, une fenêtre… ne doit pas être détourné. */
export function isPlainClick(event) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** Adresse d'arrivée : `?roue` dit au hub d'accueillir la roue en place. */
export function arrivalUrl(href) {
  const url = new URL(href);
  url.searchParams.set('roue', '');
  return url.href.replace(/roue=(?=&|#|$)/, 'roue');
}

// SVG de la roue, sans sa feuille de style : injectée telle quelle, son
// `.wheel { animation: spin … }` s'appliquerait à toute la page du tracker.
let svgMarkup = null;
function loadSvg() {
  svgMarkup ??= fetch('./assets/logo.svg')
    .then(response => (response.ok ? response.text() : Promise.reject()))
    .then(text => text.replace(/<defs>[\s\S]*?<\/defs>/, ''))
    .catch(() => null);
  return svgMarkup;
}

function prefetch(href) {
  if (document.querySelector(`link[rel="prefetch"][href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = href;
  document.head.append(link);
}

function cleanup(nodes) {
  nodes.forEach(node => node.remove());
}

export function initHubTransition(link = document.querySelector('a.brand')) {
  const canvas = link?.querySelector('canvas');
  if (!link || !canvas) return;
  const destination = arrivalUrl(link.href);

  // Préparer dès que l'intention se dessine : le SVG à faire voler, et la
  // page du hub, pour que l'arrivée suive l'animation sans attendre le réseau.
  const warm = () => { loadSvg(); prefetch(destination); };
  ['pointerenter', 'focus', 'touchstart'].forEach(type => link.addEventListener(type, warm, { once: true, passive: true }));

  let leaving = false;
  const created = [];

  // Retour arrière depuis le hub : la page revient du cache telle qu'on l'a
  // quittée, recouverte par l'animation. On rend la page.
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    cleanup(created.splice(0));
    canvas.style.opacity = '';
    leaving = false;
  });

  link.addEventListener('click', async event => {
    if (!isPlainClick(event) || leaving) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return; // lien normal
    event.preventDefault();
    leaving = true;

    const markup = await Promise.race([loadSvg(), new Promise(resolve => setTimeout(() => resolve(null), 150))]);
    const from = canvas.getBoundingClientRect();
    const to = hubLogoRect({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      clientWidth: document.documentElement.clientWidth,
    });

    const veil = document.createElement('div');
    veil.setAttribute('aria-hidden', 'true');
    veil.style.cssText = `position:fixed;inset:0;z-index:2147483646;background:${HUB_BACKGROUND};opacity:0;pointer-events:none`;

    const flyer = document.createElement('div');
    flyer.setAttribute('aria-hidden', 'true');
    flyer.style.cssText = `position:fixed;z-index:2147483647;left:${to.left}px;top:${to.top}px;width:${to.width}px;height:${to.height}px;transform-origin:0 0;pointer-events:none;will-change:transform,filter`;
    if (markup) {
      flyer.innerHTML = markup;
    } else {
      // SVG pas encore chargé : l'image animée fait l'affaire, sans la
      // synchronisation de l'angle.
      flyer.innerHTML = '<img src="./assets/logo.svg" alt="" style="width:100%;height:100%">';
    }
    const svg = flyer.querySelector('svg');
    if (svg) { svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%'); }

    document.body.append(veil, flyer);
    created.push(veil, flyer);

    const startDeg = ((canvas.wheelAngle || 0) * 180 / Math.PI) % 360;
    const wheel = flyer.querySelector('.wheel');
    if (wheel) {
      wheel.style.transformOrigin = '100px 100px';
      wheel.animate(
        [{ transform: `rotate(${startDeg}deg)` }, { transform: `rotate(${landingAngle(startDeg)}deg)` }],
        // Décélère jusqu'à la vitesse de croisière du hub plutôt qu'à l'arrêt.
        { duration: DURATION_MS, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'forwards' },
      );
    }

    // La copie remplace la roue du tracker en fondu : les deux dessins
    // diffèrent légèrement, et une substitution sèche se verrait.
    canvas.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' });
    const flight = flyer.animate([
      { transform: startTransform(from, to), filter: 'drop-shadow(0 0 0 rgba(255,70,86,0))', opacity: 0, offset: 0 },
      { opacity: 1, offset: 0.18 },
      { transform: 'none', filter: HUB_SHADOW, opacity: 1, offset: 1 },
    ], { duration: DURATION_MS, easing: EASING, fill: 'forwards' });
    veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION_MS * 0.6, delay: DURATION_MS * 0.15, easing: 'ease-out', fill: 'forwards' });

    await flight.finished.catch(() => {});
    window.location.href = destination;

    // Navigation bloquée ou réseau coupé : on ne laisse pas la page masquée.
    setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      cleanup(created.splice(0));
      canvas.getAnimations().forEach(animation => animation.cancel());
      leaving = false;
    }, 6000);
  });
}
