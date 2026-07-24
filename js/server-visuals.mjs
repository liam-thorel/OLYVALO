const COMMONS_FILE = 'https://commons.wikimedia.org/wiki/Special:Redirect/file/';

const CITY_VISUALS = {
  Paris: {
    file: 'Paris skyline view (Unsplash).jpg',
    source: 'https://commons.wikimedia.org/wiki/File:Paris_skyline_view_(Unsplash).jpg',
    credit: 'Anthony Delanoix · CC0',
  },
  Francfort: {
    file: 'Frankfurt Skyline at night (Unsplash).jpg',
    source: 'https://commons.wikimedia.org/wiki/File:Frankfurt_Skyline_at_night_(Unsplash).jpg',
    credit: 'Mathias Konrath · CC0',
  },
  Londres: {
    file: 'Cloudy London skyline (Unsplash).jpg',
    source: 'https://commons.wikimedia.org/wiki/File:Cloudy_London_skyline_(Unsplash).jpg',
    credit: 'Rob Bye · CC0',
  },
  Madrid: {
    file: 'Madrid - Skyline de Madrid desde el Cerro de San Isidro 1.jpg',
    source: 'https://commons.wikimedia.org/wiki/File:Madrid_-_Skyline_de_Madrid_desde_el_Cerro_de_San_Isidro_1.jpg',
    credit: 'Zarateman · CC0',
  },
  Stockholm: {
    file: 'Stockholm Skyline.jpg',
    source: 'https://commons.wikimedia.org/wiki/File:Stockholm_Skyline.jpg',
    credit: 'Mightanddelight · CC BY-SA 4.0',
  },
  Varsovie: {
    file: 'Skyline Warsaw.jpg',
    source: 'https://commons.wikimedia.org/wiki/File:Skyline_Warsaw.jpg',
    credit: 'Ulfer · Domaine public',
  },
  Istanbul: {
    file: 'The skyline of Istanbul.JPG',
    source: 'https://commons.wikimedia.org/wiki/File:The_skyline_of_Istanbul.JPG',
    credit: 'Thingstodoeverywhere · CC0',
  },
  'Dubaï': {
    file: 'Dubai-Skyline-2019.jpg',
    source: 'https://commons.wikimedia.org/wiki/File:Dubai-Skyline-2019.jpg',
    credit: 'CommunistSquared · CC0',
  },
};

export function serverVisual(serverName) {
  const visual = CITY_VISUALS[serverName];
  if (!visual) return null;
  return {
    image: `${COMMONS_FILE}${encodeURIComponent(visual.file)}?width=640`,
    source: visual.source,
    credit: visual.credit,
  };
}
