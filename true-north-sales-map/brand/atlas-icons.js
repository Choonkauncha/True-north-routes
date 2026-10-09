/** Small, local SVG icons. No font, network request, or image dependency. */
const paths = {
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/>',
  inspection:
    '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 3h6v4H9zM8 13l2 2 5-5"/>',
  forms: '<path d="M14 3H5v18h14V8zM14 3v5h5M9 12h6M9 16h4"/>',
  photos:
    '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 6-5 4 3 3-3 5 5"/>',
  training: '<path d="m3 8 9-5 9 5-9 5zM6 10v7c4 3 8 3 12 0v-7M21 8v8"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/>',
  overview:
    '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  appointments:
    '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2"/>',
  homeowners: '<path d="m3 10 9-7 9 7M5 9v12h14V9M10 21v-7h4v7"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  territories:
    '<circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M9 15l2-4 4-2-2 4z"/>',
  files: '<path d="M3 7V5h7l2 2h9v13H3zM3 10h18"/>',
  accounts:
    '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  shifts: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
};
export function atlasIcon(key) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key] || paths.arrow}</svg>`;
}
