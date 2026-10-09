// Which URL paths count as private lead files. .vercelignore keeps those files
// out of the deployment; this helper documents and tests the same rule.
// (Not a Vercel middleware: this project has no framework, and a root
// middleware.js broke the deploy.)
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
