import express from 'express';
import * as cheerio from 'cheerio';

const server = express();
const app = express.Router();
const PORT = process.env.PORT || 3000;
const BASE_PATH = (process.env.BASE_PATH ?? '/kino').replace(/\/+$/, '');
if (BASE_PATH && !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(BASE_PATH)) {
  throw new Error('BASE_PATH must be / or a path such as /kino');
}
const CACHE_MS = 20 * 60 * 1000;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const cinemas = [
  { id: 'innenstadtkinos', name: 'Innenstadtkinos', address: 'Königstraße 22, 70173 Stuttgart', url: 'https://www.innenstadtkinos.de/', accent: '#ec5a39' },
  { id: 'arthaus', name: 'Atelier am Bollwerk', address: 'Hohe Straße 26, 70176 Stuttgart', url: 'https://arthaus-kino.de/', accent: '#f2b84b' },
  { id: 'delphi', name: 'Delphi Arthaus Kino', address: 'Tübinger Straße 6, 70178 Stuttgart', url: 'https://maps.app.goo.gl/6ti1rdxm2hEjyzUJ9', accent: '#527f91' },
  { id: 'cinemaxx', name: 'CinemaxX Stuttgart Liederhalle', address: 'Breitscheidstraße 4a, 70174 Stuttgart', url: 'https://maps.app.goo.gl/p3VnvFHRziNiqgeBA', accent: '#d71920' },
  { id: 'metropol', name: 'METROPOL – Traumpalast', address: 'Bolzstraße 10, 70173 Stuttgart', url: 'https://maps.app.goo.gl/x5uWMTWvhN2uLMWZ9', accent: '#8d58a8' }
];

const sources = cinemas.map(cinema => ({
  ...cinema,
  scrapeUrl: cinema.url,
  cineamoId: { innenstadtkinos: 778, delphi: 777, cinemaxx: 936, metropol: 1316 }[cinema.id] || null
}));
let cache = null;
let refreshPromise = null;

function localDate(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
}

function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== 'object') return [];
  return [value, ...flattenJsonLd(value['@graph'] || [])];
}

function normalizeEvent(item, cinema) {
  const type = String(item['@type'] || '').toLowerCase();
  if (!type.includes('event') && !item.startDate) return null;
  const work = item.workPresented || item.about || {};
  const title = work.name || item.name;
  const start = item.startDate;
  if (!title || !start) return null;
  const date = new Date(start);
  if (Number.isNaN(date.valueOf())) return null;
  return {
    title: String(title).replace(/\s*[–|-]\s*(vorstellung|kino).*$/i, '').trim(),
    date: date.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' }),
    time: date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }),
    cinemaId: cinema.id,
    bookingUrl: item.url || item.offers?.url || cinema.url,
    image: typeof item.image === 'string' ? item.image : item.image?.url,
    genre: work.genre || 'Film',
    duration: work.duration || '',
    rating: work.contentRating || ''
  };
}

const requestHeaders = {
  'user-agent': 'StuttgartImKino/1.0 (+local cinema guide; respectful 20-minute cache)',
  accept: 'application/json, text/html'
};

async function scrapeCineamo(source) {
  const start = `${localDate(0)}T00:00:00Z`;
  const end = `${localDate(15)}T00:00:00Z`;
  const base = `https://api.cineamo.com/showings?cinemaIds%5B0%5D=${source.cineamoId}&startDatetime=${encodeURIComponent(start)}&endDatetime=${encodeURIComponent(end)}`;
  const events = [];
  let page = 1;
  let pageCount = 1;
  do {
    const response = await fetch(`${base}&page=${page}`, { signal: AbortSignal.timeout(12000), headers: requestHeaders });
    if (!response.ok) throw new Error(`Cineamo HTTP ${response.status}`);
    const data = await response.json();
    pageCount = Math.min(Number(data._page_count) || 1, 50);
    for (const showing of data._embedded?.showings || []) {
      const content = showing._embedded?.content || {};
      const startDate = new Date(showing.startDatetime);
      if (!showing.startDatetime || Number.isNaN(startDate.valueOf())) continue;
      const title = showing.name || content.name;
      if (!title) continue;
      events.push({
        title, cinemaId: source.id,
        date: startDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' }),
        time: startDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }),
        bookingUrl: showing.ticketUrls?.default || showing.onlineTicketUrl || source.url,
        image: content.posterImageUrl || showing.imageUrl || '',
        genre: Array.isArray(content.genres) ? content.genres.map(g => g.name || g).join(' · ') : 'Film',
        duration: content.duration ? `${content.duration} Min.` : '',
        rating: content.ageRating != null ? `FSK ${content.ageRating}` : '',
        language: showing.language || '',
        originalLanguage: showing.originalLanguage || '',
        isOriginalLanguage: Boolean(showing.isOriginalLanguage),
        isSubtitled: Boolean(showing.isSubtitled),
        subtitledLanguage: showing.subtitledLanguage || ''
      });
    }
    page++;
  } while (page <= pageCount);
  return events;
}

function parseGermanDate(text) {
  const match = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : null;
}

async function scrapeArthaus(source) {
  const response = await fetch(source.scrapeUrl, { signal: AbortSignal.timeout(12000), headers: requestHeaders });
  if (!response.ok) throw new Error(`Arthaus HTTP ${response.status}`);
  const $ = cheerio.load(await response.text());
  const movieNames = new Map();
  $('.movie-item').each((_, item) => {
    const name = $(item).find('.movie-info').attr('data-name') || $(item).find('h5').text().trim();
    const image = $(item).find('img').attr('src') || '';
    const id = image.match(/-(\d+)\.v\d+/)?.[1];
    if (id && name) movieNames.set(id, { name, image });
  });
  const events = [];
  $('.accordion-movies-wrapper').each((_, wrapper) => {
    const date = parseGermanDate($(wrapper).find('.accordion').first().text());
    if (!date) return;
    $(wrapper).find('.accordio-item-movie').each((_, item) => {
      const details = $(item).find('p').first().text().replace(/\s+/g, ' ').trim();
      if (!/Atelier am Bollwerk/i.test(details)) return;
      const time = details.match(/\b(\d{1,2}:\d{2})\b/)?.[1];
      const movieId = $(item).attr('data-movie-id');
      const movie = movieNames.get(movieId);
      if (!time || !movie) return;
      const flag = [$(item).attr('data-flag'), $(item).find('[data-flag]').attr('data-flag'), details].filter(Boolean).join(' ');
      const isSubtitled = /\b(OmU|OmdU|subtit)/i.test(flag);
      const isOriginalLanguage = isSubtitled || /\b(OV|OF)\b/i.test(flag);
      events.push({
        title: movie.name, date, time: time.padStart(5, '0'), cinemaId: source.id,
        bookingUrl: $(item).find('a[href]').attr('href') || source.url,
        image: movie.image, genre: 'Film', duration: '', rating: '',
        language: '', originalLanguage: '', isOriginalLanguage, isSubtitled,
        subtitledLanguage: isSubtitled ? 'deu' : ''
      });
    });
  });
  return events;
}

async function scrapeJsonLd(source) {
  const response = await fetch(source.scrapeUrl, { signal: AbortSignal.timeout(9000), headers: requestHeaders });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const $ = cheerio.load(await response.text());
  const events = [];
  $('script[type="application/ld+json"]').each((_, script) => {
    try {
      for (const item of flattenJsonLd(JSON.parse($(script).text()))) {
        const event = normalizeEvent(item, source);
        if (event) events.push(event);
      }
    } catch { /* ignore malformed third-party JSON-LD */ }
  });
  return events;
}

async function scrapeSource(source) {
  if (source.cineamoId) return scrapeCineamo(source);
  if (source.id === 'arthaus') return scrapeArthaus(source);
  return scrapeJsonLd(source);
}

function aggregate(events) {
  const films = new Map();
  for (const event of events) {
    const key = `${event.date}|${event.title.toLocaleLowerCase('de')}`;
    if (!films.has(key)) films.set(key, {
      id: Buffer.from(event.title).toString('base64url').slice(0, 16), title: event.title,
      date: event.date, genre: event.genre || 'Film', duration: event.duration || '', rating: event.rating || '',
      image: event.image || '', shows: []
    });
    const film = films.get(key);
    if (!film.shows.some(show => show.time === event.time && show.cinemaId === event.cinemaId && show.isOriginalLanguage === Boolean(event.isOriginalLanguage) && show.isSubtitled === Boolean(event.isSubtitled))) {
      film.shows.push({
        time: event.time,
        cinemaId: event.cinemaId,
        bookingUrl: event.bookingUrl,
        language: event.language || '',
        originalLanguage: event.originalLanguage || '',
        isOriginalLanguage: Boolean(event.isOriginalLanguage),
        isSubtitled: Boolean(event.isSubtitled),
        subtitledLanguage: event.subtitledLanguage || ''
      });
    }
  }
  return [...films.values()].map(f => ({ ...f, shows: f.shows.sort((a, b) => a.time.localeCompare(b.time)) }));
}

async function collect() {
  const results = await Promise.allSettled(sources.map(scrapeSource));
  const live = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const usableLive = live.filter(event => event.date >= localDate(0) && event.date < localDate(15));
  return {
    updatedAt: new Date().toISOString(), available: usableLive.length > 0, films: aggregate(usableLive), cinemas,
    sources: sources.map((source, i) => ({ name: source.name, url: source.url, ok: results[i].status === 'fulfilled', events: results[i].status === 'fulfilled' ? results[i].value.length : 0 }))
  };
}

async function getCachedShowings() {
  if (cache && Date.now() - cache.time < CACHE_MS) return cache.data;
  // Deduplicate simultaneous requests so only one scrape can run at a time.
  if (!refreshPromise) {
    refreshPromise = collect()
      .then(data => {
        cache = { time: Date.now(), data };
        return data;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

function tmdbOptions() {
  const token = process.env.TMDB_API_TOKEN;
  return token ? { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } } : { headers: { accept: 'application/json' } };
}

async function tmdbFetch(path, parameters = {}) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!process.env.TMDB_API_TOKEN && !apiKey) {
    const error = new Error('TMDB is not configured. Set TMDB_API_TOKEN or TMDB_API_KEY.');
    error.status = 503;
    throw error;
  }
  const url = new URL(`${TMDB_BASE_URL}${path}`);
  url.search = new URLSearchParams({ language: process.env.TMDB_LANGUAGE || 'en-US', ...parameters, ...(apiKey ? { api_key: apiKey } : {}) });
  const response = await fetch(url, { ...tmdbOptions(), signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    const error = new Error(`TMDB HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function tmdbImage(path, size = 'w342') {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : '';
}

function normalizeTmdbTitle(item) {
  const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
  return {
    id: item.id,
    mediaType,
    title: item.title || item.name || '',
    originalTitle: item.original_title || item.original_name || '',
    date: item.release_date || item.first_air_date || '',
    overview: item.overview || '',
    image: tmdbImage(item.poster_path),
    popularity: item.popularity || 0,
    voteAverage: item.vote_average || 0,
    tmdbUrl: `https://www.themoviedb.org/${mediaType}/${item.id}`
  };
}

app.get('/api/catalog/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2) return res.status(400).json({ error: 'Enter at least two characters.' });
  try {
    const data = await tmdbFetch('/search/multi', { query, include_adult: 'false', page: '1' });
    const results = data.results.slice(0, 20).map(item => item.media_type === 'person' ? {
      id: item.id,
      mediaType: 'person',
      name: item.name,
      department: item.known_for_department || '',
      image: tmdbImage(item.profile_path),
      knownFor: (item.known_for || []).map(normalizeTmdbTitle),
      popularity: item.popularity || 0,
      tmdbUrl: `https://www.themoviedb.org/person/${item.id}`
    } : normalizeTmdbTitle(item));
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ query, results });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.get('/api/catalog/person/:id/credits', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid person ID.' });
  try {
    const [person, credits] = await Promise.all([
      tmdbFetch(`/person/${req.params.id}`),
      tmdbFetch(`/person/${req.params.id}/combined_credits`)
    ]);
    const works = new Map();
    for (const credit of [...(credits.cast || []), ...(credits.crew || [])]) {
      if (!['movie', 'tv'].includes(credit.media_type)) continue;
      const key = `${credit.media_type}:${credit.id}`;
      if (!works.has(key)) works.set(key, { ...normalizeTmdbTitle(credit), roles: [] });
      const role = credit.character ? `Cast: ${credit.character}` : credit.job || credit.department;
      if (role && !works.get(key).roles.includes(role)) works.get(key).roles.push(role);
    }
    const sortedWorks = [...works.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.popularity - a.popularity);
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ person: { id: person.id, name: person.name, biography: person.biography || '', image: tmdbImage(person.profile_path), tmdbUrl: `https://www.themoviedb.org/person/${person.id}` }, works: sortedWorks });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.get('/api/showings', async (_req, res) => {
  try {
    const data = await getCachedShowings();
    const age = cache ? Math.floor((Date.now() - cache.time) / 1000) : 0;
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.set('Age', String(age));
    res.json(data);
  } catch (error) {
    // Keep serving the last verified result if a refresh fails.
    if (cache?.data) return res.status(200).json(cache.data);
    res.status(500).json({ error: 'Das Kinoprogramm konnte nicht geladen werden.', detail: error.message });
  }
});
app.use(express.static(new URL('./public/', import.meta.url).pathname));
// Relative browser URLs require a trailing slash at the app's entry point.
if (BASE_PATH) {
  server.use((req, res, next) => {
    if (req.path !== BASE_PATH) return next();
    const query = req.originalUrl.slice(req.path.length);
    res.redirect(308, `${BASE_PATH}/${query}`);
  });
}
server.use(BASE_PATH || '/', app);
server.listen(PORT, () => console.log(`Stuttgart im Kino: http://localhost:${PORT}${BASE_PATH}/`));
