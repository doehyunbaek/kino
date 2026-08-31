const $ = selector => document.querySelector(selector);
const state = { data: null, date: today(), favorites: new Set(JSON.parse(localStorage.getItem('kino-favorites') || '[]')), selectedCinemas: new Set(), favoritesOnly: false, ovOnly: localStorage.getItem('kino-ov-only') === 'true', focusedMovie: null, sortBy: null, sortDirection: 'desc' };
const weekdays = ['SO','MO','DI','MI','DO','FR','SA'];

function today(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
}
function dateObj(dateString) { return new Date(`${dateString}T12:00:00`); }
function escapeHtml(value = '') { const el = document.createElement('span'); el.textContent = value; return el.innerHTML; }
function safeUrl(value = '') { try { const url = new URL(value, location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } }
function languageCode(code = '') {
  return ({ deu: 'DE', ger: 'DE', eng: 'EN', fra: 'FR', fre: 'FR', spa: 'ES', ita: 'IT', jpn: 'JA', kor: 'KO' })[code.toLowerCase()] || code.slice(0, 2).toUpperCase();
}
function versionLabel(show) {
  const subtitles = languageCode(show.subtitledLanguage);
  if (show.isOriginalLanguage && show.isSubtitled) return subtitles === 'DE' ? 'OmU' : `OV · UT ${subtitles}`;
  if (show.isOriginalLanguage) return 'OV';
  if (show.isSubtitled) return `UT ${subtitles}`.trim();
  const language = languageCode(show.language);
  return language && language !== 'DE' ? language : '';
}
function versionTitle(show) {
  const parts = [];
  if (show.isOriginalLanguage) parts.push(`Originalversion${show.originalLanguage ? ` (${languageCode(show.originalLanguage)})` : ''}`);
  else if (show.language) parts.push(`Sprache: ${languageCode(show.language)}`);
  if (show.isSubtitled) parts.push(`Untertitel${show.subtitledLanguage ? `: ${languageCode(show.subtitledLanguage)}` : ''}`);
  return parts.join(', ');
}

function filteredFilms(date) {
  const query = $('#searchInput').value.trim().toLocaleLowerCase('de');
  const period = $('#timeFilter').value;
  return state.data.films.filter(film => {
    if (film.date !== date || !film.title.toLocaleLowerCase('de').includes(query)) return false;
    if (state.favoritesOnly && !state.favorites.has(film.id)) return false;
    return film.shows.some(show => {
      const hour = Number(show.time.slice(0, 2));
      const timeMatches = period === 'all' || (period === 'before18' && hour < 18) || (period === 'evening' && hour >= 18 && hour < 21) || (period === 'late' && hour >= 21);
      return state.selectedCinemas.has(show.cinemaId) && timeMatches && (!state.ovOnly || show.isOriginalLanguage);
    });
  });
}

function visibleShows(film) {
  const period = $('#timeFilter').value;
  return film.shows.filter(show => {
    const hour = Number(show.time.slice(0,2));
    return state.selectedCinemas.has(show.cinemaId) && (!state.ovOnly || show.isOriginalLanguage) && (period === 'all' || period === 'before18' && hour < 18 || period === 'evening' && hour >= 18 && hour < 21 || period === 'late' && hour >= 21);
  });
}

function renderDayShows(film) {
  if (!film) return '<span class="no-show">—</span>';
  const groups = visibleShows(film).reduce((map, show) => map.set(show.cinemaId, [...(map.get(show.cinemaId) || []), show]), new Map());
  return [...groups].map(([id, shows]) => `<div class="day-cinema"><span>${escapeHtml(state.data.cinemas.find(c => c.id === id)?.name || id)}</span><div>${shows.map(show => { const label = versionLabel(show); const detail = versionTitle(show); return `<a class="showtime" href="${escapeHtml(safeUrl(show.bookingUrl))}" target="_blank" rel="noopener" title="${escapeHtml(detail || 'Beim Kino prüfen und buchen')}"><span>${show.time}</span>${label ? `<small>${escapeHtml(label)}</small>` : ''}</a>`; }).join('')}</div></div>`).join('') || '<span class="no-show">—</span>';
}

function renderMovies() {
  const allDates = Array.from({ length: 14 }, (_, offset) => today(offset));
  const grouped = new Map();
  allDates.forEach(date => filteredFilms(date).forEach(film => {
    const key = film.title.toLocaleLowerCase('de');
    if (!grouped.has(key)) grouped.set(key, { key, representative: film, days: new Map() });
    grouped.get(key).days.set(date, film);
  }));
  const focused = state.focusedMovie ? grouped.get(state.focusedMovie) : null;
  if (state.focusedMovie && !focused) state.focusedMovie = null;
  const dates = focused ? allDates.filter(date => focused.days.has(date) && visibleShows(focused.days.get(date)).length) : allDates;
  const showingCount = (entry, date = null) => date
    ? visibleShows(entry.days.get(date) || { shows: [] }).length
    : [...entry.days.values()].reduce((sum, film) => sum + visibleShows(film).length, 0);
  const entries = focused ? [focused] : [...grouped.values()].sort((a, b) => {
    if (!state.sortBy) return a.representative.title.localeCompare(b.representative.title, 'de');
    const difference = showingCount(a, state.sortBy === 'total' ? null : state.sortBy) - showingCount(b, state.sortBy === 'total' ? null : state.sortBy);
    return (state.sortDirection === 'asc' ? difference : -difference) || a.representative.title.localeCompare(b.representative.title, 'de');
  });
  $('#dateHeading').textContent = focused ? `${focused.representative.title} · Spieltage` : state.favoritesOnly ? 'Deine Merkliste · 14 Tage' : 'Die nächsten 14 Tage';
  const board = $('#movieGrid');
  board.classList.toggle('movie-focused', Boolean(focused));
  const sortMark = key => state.sortBy === key ? `<i>${state.sortDirection === 'desc' ? '↓' : '↑'}</i>` : '';
  const header = `<div class="schedule-header"><button class="sort-header" data-sort="total" title="Nach Gesamtzahl der Vorstellungen sortieren"><span>${focused ? 'Film · Esc' : 'Film'}</span>${sortMark('total')}</button>${dates.map(date => { const d = dateObj(date), offset = allDates.indexOf(date); const label = offset === 0 ? 'Heute' : offset === 1 ? 'Morgen' : d.toLocaleDateString('de-DE', { weekday: 'short' }); return `<button class="sort-header" data-sort="${date}" title="Nach Vorstellungen an diesem Tag sortieren"><span>${escapeHtml(label)}</span><strong>${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</strong>${sortMark(date)}</button>`; }).join('')}</div>`;
  board.innerHTML = `<div class="schedule-table" style="--days:${dates.length}">${header}<div class="schedule-rows"></div></div>`;
  board.querySelectorAll('.sort-header').forEach(button => button.onclick = () => {
    const key = button.dataset.sort;
    if (state.sortBy === key) state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
    else { state.sortBy = key; state.sortDirection = 'desc'; }
    renderMovies();
  });
  const rows = board.querySelector('.schedule-rows');
  entries.forEach(({ key, representative: film, days }, index) => {
    const row = document.createElement('article');
    row.className = `schedule-row${focused ? ' focused' : ''}`;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `${film.title} fokussieren`);
    row.style.animationDelay = `${Math.min(index * 15, 180)}ms`;
    const total = [...days.values()].reduce((sum, dayFilm) => sum + visibleShows(dayFilm).length, 0);
    row.innerHTML = `<div class="movie-summary"><div class="movie-summary-top"><span class="rating">${escapeHtml(film.rating || 'FILM')}</span><button class="favorite ${state.favorites.has(film.id) ? 'active' : ''}" aria-label="Zur Merkliste hinzufügen">${state.favorites.has(film.id) ? '♥' : '♡'}</button></div><h3>${escapeHtml(film.title)}</h3><p>${escapeHtml(film.genre)}${film.duration ? ` · ${escapeHtml(film.duration)}` : ''}</p><small>${total} Vorstellungen${focused ? ' · Esc zum Schließen' : ' · Zeile fokussieren'}</small></div>${dates.map(date => `<div class="day-cell">${renderDayShows(days.get(date))}</div>`).join('')}`;
    const focusRow = () => { if (state.focusedMovie !== key) { state.focusedMovie = key; renderMovies(); $('#movieGrid .schedule-row')?.focus(); } };
    row.addEventListener('click', event => { if (!event.target.closest('a, button')) focusRow(); });
    row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusRow(); } });
    row.querySelector('.favorite').onclick = () => toggleFavorite(film.id);
    rows.appendChild(row);
  });
  if (!grouped.size) rows.innerHTML = `<div class="schedule-empty">${state.data.available ? 'Keine Vorstellungen für diese Filter gefunden.' : 'Live-Daten nicht verfügbar.'}</div>`;
}

function toggleFavorite(id) {
  state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
  localStorage.setItem('kino-favorites', JSON.stringify([...state.favorites])); updateFavCount(); renderMovies();
}
function updateFavCount() { $('#favCount').textContent = state.favorites.size; }

function renderCinemas() {
  state.selectedCinemas = new Set(state.data.cinemas.map(cinema => cinema.id));
  $('#cinemaToggles').innerHTML = state.data.cinemas.map(cinema => `<button type="button" class="cinema-toggle active" data-cinema="${cinema.id}" aria-pressed="true"><span style="background:${cinema.accent}"></span>${escapeHtml(cinema.name)}</button>`).join('');
  document.querySelectorAll('.cinema-toggle').forEach(button => button.onclick = () => {
    const id = button.dataset.cinema;
    state.selectedCinemas.has(id) ? state.selectedCinemas.delete(id) : state.selectedCinemas.add(id);
    button.classList.toggle('active', state.selectedCinemas.has(id));
    button.setAttribute('aria-pressed', String(state.selectedCinemas.has(id)));
    renderMovies();
  });
}

async function init() {
  updateFavCount();
  $('#ovToggle').classList.toggle('active', state.ovOnly);
  $('#ovToggle').setAttribute('aria-pressed', String(state.ovOnly));
  try {
    const response = await fetch('/api/showings'); if (!response.ok) throw new Error();
    state.data = await response.json();
    renderCinemas(); renderMovies();
    const status = $('#status');
    if (!state.data.available) {
      status.className = 'status notice';
      status.innerHTML = 'Live-Programm derzeit nicht verfügbar. Es werden ausschließlich verifizierte Spielzeiten angezeigt – keine Demo-Daten.';
    } else status.hidden = true;
  } catch { $('#status').innerHTML = 'Das Programm konnte gerade nicht geladen werden. Bitte versuche es später erneut.'; }
}

$('#searchInput').addEventListener('input', renderMovies);
$('#timeFilter').addEventListener('change', renderMovies);
$('#ovToggle').onclick = event => {
  state.ovOnly = !state.ovOnly;
  localStorage.setItem('kino-ov-only', String(state.ovOnly));
  event.currentTarget.classList.toggle('active', state.ovOnly);
  event.currentTarget.setAttribute('aria-pressed', String(state.ovOnly));
  renderMovies();
};
$('#favoritesNav').onclick = () => { state.favoritesOnly = !state.favoritesOnly; renderMovies(); location.hash = 'programm'; };
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.focusedMovie) {
    state.focusedMovie = null;
    renderMovies();
    $('#movieGrid').focus({ preventScroll: true });
  }
});
$('.menu').onclick = () => document.querySelector('nav').classList.toggle('open');
init();
