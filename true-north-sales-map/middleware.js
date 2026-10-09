// Second guard for private lead files. .vercelignore keeps them out of the
// deployment; this answers 404 for them anyway in case one slips back in.
// Only /data/city-centers.json and /data/manifest.json stay public (map chrome).
const PUBLIC_DATA = new Set(['/data/city-centers.json', '/data/manifest.json']);

export function isPrivateLeadPath(pathname) {
  let path = String(pathname || '');
  try { path = decodeURIComponent(path); } catch { /* keep raw path */ }
  path = path.toLowerCase().replace(/\/{2,}/g, '/');
  if (path.startsWith('/source/') || path === '/source') return true;
  if (path.startsWith('/data/')) return !PUBLIC_DATA.has(path);
  return false;
}

export default function middleware(request) {
  const { pathname } = new URL(request.url);
  if (isPrivateLeadPath(pathname)) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  return undefined;
}

export const config = {
  matcher: ['/data/:path*', '/source/:path*', '/source']
};
