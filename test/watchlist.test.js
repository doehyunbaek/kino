import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { normalizedTitle, matchesFilm, programFavorite, validFavorite, associatedWithPerson, personSources } from '../public/watchlist.js';

async function app({ saved = [], legacy = [], results = [], fail = false } = {}) {
  const storage = new Map([['tmdb-favorites', JSON.stringify(saved)], ['kino-favorites', JSON.stringify(legacy)]]);
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { hidden: true, classList: { toggle() {} }, setAttribute() {} });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    normalizedTitle, matchesFilm, programFavorite, associatedWithPerson, personSources, console: { warn() {} },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    document: { querySelector: node, querySelectorAll: selector => selector === '.catalog-favorite' ? [node('catalogButton')] : selector === '.saved-remove' ? [node('removeButton')] : [] },
    createWatchlistSync: () => ({ localChanged() {} }),
    fetch: async () => ({ ok: !fail, json: async () => ({ results, error: 'Unavailable' }) })
  });
  let source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  source = source.replace(/^import .*;\n/gm, '').split("$('#searchInput').addEventListener")[0];
  vm.runInContext(source + '\nrenderMovies = () => {}; escapeHtml = value => String(value || ""); globalThis.api = { state, toggleFavorite, isFilmMarked, bindCatalogButtons, showCatalogFavorites, migrateProgramFavorites };', context);
  return { ...context.api, node, storage };
}

const film = { id: 'king', title: 'King' };
const movie = { id: 123, mediaType: 'movie', title: 'King', originalTitle: 'King' };

test('Programm -> Merkliste -> unmark Programm', async () => {
  const a = await app({ results: [movie] });
  await a.toggleFavorite(film, {});
  assert.equal(a.state.catalogFavorites.size, 1);
  assert.equal(a.isFilmMarked(film), true);
  await a.toggleFavorite(film, {});
  assert.equal(a.state.catalogFavorites.size, 0);
  assert.equal(a.isFilmMarked(film), false);
});

test('failed, empty and unrelated TMDB results still save the correct film', async () => {
  for (const options of [{ fail: true }, {}, { results: [{ ...movie, title: 'Other', originalTitle: 'Other' }] }]) {
    const a = await app(options);
    await a.toggleFavorite(film, {});
    const item = [...a.state.catalogFavorites.values()][0];
    assert.equal(item.title, 'King');
    assert.equal(item.source, 'program');
    assert.equal(validFavorite(item), true);
    assert.equal(a.isFilmMarked(film), true);
  }
});

test('catalog add/remove updates Programm in both directions', async () => {
  const a = await app();
  const button = a.node('catalogButton');
  button.dataset = { favorite: 'movie:123' };
  a.bindCatalogButtons([movie]);
  await button.onclick();
  assert.equal(a.isFilmMarked(film), true);
  await button.onclick();
  assert.equal(a.isFilmMarked(film), false);
});

test('Merkliste removal clears Programm including migrated legacy hearts', async () => {
  const a = await app({ legacy: ['king'] });
  a.state.data = { films: [film] };
  a.migrateProgramFavorites();
  assert.equal(a.state.favorites.size, 0);
  assert.equal(a.isFilmMarked(film), true);
  const button = a.node('removeButton');
  button.dataset = { remove: [...a.state.catalogFavorites.keys()][0] };
  a.showCatalogFavorites();
  button.onclick();
  assert.equal(a.isFilmMarked(film), false);
  assert.equal(a.state.catalogFavorites.size, 0);
});

test('Merkliste renders people separately from films', async () => {
  const a = await app({ saved: [movie, { id: 99, mediaType: 'person', title: 'Example Actor', works: [movie] }] });
  a.showCatalogFavorites();
  const html = a.node('#favoritesResults').innerHTML;
  const [titlesTable, peopleTable] = html.split('<h3 class="saved-section-heading">Personen</h3>');
  assert.ok(titlesTable.includes('King'));
  assert.ok(!titlesTable.includes('Example Actor'));
  assert.ok(peopleTable.includes('Example Actor'));
  assert.ok(!peopleTable.includes('data-watched'));
  assert.ok(peopleTable.includes('Gespeicherte Personen'));
});

test('thanks-only credits do not boost films; substantive credits still do', () => {
  for (const role of ['Thanks', 'Special Thanks', 'Acknowledgments']) {
    const person = { mediaType: 'person', name: 'Denis Villeneuve', works: [{ ...movie, roles: [role] }] };
    assert.equal(associatedWithPerson([person], film), false);
    person.works[0].roles.push('Director');
    assert.deepEqual(personSources([person], film), [{ name: 'Denis Villeneuve', roles: ['Regie'] }]);
  }
});

test('priority sources show each person and deduplicated cast/crew roles', () => {
  const people = [
    { mediaType: 'person', name: 'Tom Cruise', works: [{ ...movie, roles: ['Cast: Digger', 'Producer', 'Cast: Digger'] }] },
    { mediaType: 'person', title: 'Director Name', works: [{ ...movie, roles: ['Director'] }] }
  ];
  assert.deepEqual(personSources(people, film), [
    { name: 'Tom Cruise', roles: ['Darsteller', 'Produktion'] },
    { name: 'Director Name', roles: ['Regie'] }
  ]);
  assert.deepEqual(personSources(people, { title: 'Unrelated' }), []);
});

test('person credits prioritize matching movies without individually marking them', () => {
  const person = { id: 99, mediaType: 'person', title: 'Example Actor', works: [movie, { id: 2, mediaType: 'tv', title: 'Other' }] };
  assert.equal(validFavorite(person), true);
  assert.equal(associatedWithPerson([person], film), true);
  assert.equal(associatedWithPerson([person], { title: 'Other' }), false);
  assert.equal(associatedWithPerson([], film), false);
});

test('catalog match replaces metadata-free entry without duplicate', async () => {
  const a = await app({ saved: [programFavorite(film, '2026-01-01')] });
  const button = a.node('catalogButton');
  button.dataset = { favorite: 'movie:123' };
  a.bindCatalogButtons([{ ...movie }]);
  await button.onclick();
  assert.equal(a.state.catalogFavorites.size, 1);
  assert.equal(a.state.catalogFavorites.get('movie:123').watchedAt, '2026-01-01');
  assert.equal(a.isFilmMarked(film), true);
});
