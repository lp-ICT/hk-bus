import data from './resident-data.json';

export const residentUpdatedAt = data.updatedAt;
export const residentRoutes = data.routes;

export function searchResidentRoutes(query: string) {
  const text = query.trim();
  const number = text.toUpperCase().replace(/\s/g, '');
  return residentRoutes.filter(route => !text || route.route.includes(number) || route.description.includes(text) || route.region.includes(text))
    .sort((a, b) => Number(b.route === number || b.route.replace(/^(NR|HR|KR)/, '') === number) - Number(a.route === number || a.route.replace(/^(NR|HR|KR)/, '') === number) || a.route.localeCompare(b.route, 'en', { numeric: true }));
}
