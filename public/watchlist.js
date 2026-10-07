export function normalizedTitle(value = '') {
  return String(value || '').trim().toLocaleLowerCase('de').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function matchesFilm(item, film) {
  const title = normalizedTitle(film.title);
  return item.mediaType === 'movie' && Boolean(title) &&
    [item.programTitle, item.title, item.originalTitle].some(value => normalizedTitle(value) === title);
}

export function programFavorite(film, watchedAt) {
  return { id: `program:${normalizedTitle(film.title)}`, source: 'program', mediaType: 'movie', title: film.title, programTitle: film.title, watchedAt };
}

export function personSources(items, film) {
  return [...items].filter(item => item.mediaType === 'person').flatMap(item => {
    const works = (item.works || []).filter(work => matchesFilm(work, film) &&
      (!work.roles?.length || work.roles.some(role => !/\bthanks\b|\bthank you\b|\backnowledg(?:e)?ments?\b/i.test(role))));
    if (!works.length) return [];
    const roles = [...new Set(works.flatMap(work => work.roles || []).filter(role => !/\bthanks\b|\bthank you\b|\backnowledg(?:e)?ments?\b/i.test(role)).map(role =>
      role.startsWith('Cast:') ? 'Darsteller' : ({ Director: 'Regie', Producer: 'Produktion', 'Executive Producer': 'Ausführende Produktion', Writer: 'Drehbuch', Screenplay: 'Drehbuch' })[role] || role
    ))];
    return [{ name: item.title || item.name, roles }];
  });
}

export function associatedWithPerson(items, film) {
  return personSources(items, film).length > 0;
}

export function validFavorite(item) {
  return Boolean(item && ['movie', 'tv', 'person'].includes(item.mediaType) &&
    (Number.isFinite(Number(item.id)) ||
      (item.source === 'program' && item.mediaType === 'movie' && typeof item.id === 'string' && item.id.startsWith('program:') && item.title)));
}
