import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawCdnModule = /https:\/\/cdn\.jsdelivr\.net\/[^'"\s]*\/(?:lib\.esm|dist\/esm)\//;
const sourceExts = new Set(['.js', '.mjs', '.html', '.css']);

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (sourceExts.has(extname(name))) files.push(path);
  }
  return files;
}

const badSample = [
  "import('https://cdn.jsdelivr.net/npm/tus-js-client@4.2.3/lib.esm/browser/index.js')",
  'import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js")',
  "from 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js'"
];
for (const sample of badSample) assert.match(sample, rawCdnModule);
const coreBase = "const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';";
assert.equal(coreBase.match(rawCdnModule), null);

const hits = [];
for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8');
  const found = text.match(new RegExp(rawCdnModule.source, 'g'));
  if (found) hits.push(`${file.slice(root.length + 1)}: ${found.join(', ')}`);
}
assert.deepEqual(hits, [], `raw jsDelivr /lib.esm/ or /dist/esm/ import:\n${hits.join('\n')}`);

const media = readFileSync(join(root, 'tn-files/training-media.js'), 'utf8');
assert.match(media, /import\('\.\.\/vendor\/ffmpeg\/index\.js'\)/);
assert.match(media, /import\('\.\.\/vendor\/ffmpeg\/util\/index\.js'\)/);
assert.match(media, /tus-js-client@4\.2\.3\/\+esm/);
assert.match(media, /\(\{ Upload \}\)/);
assert.match(media, /jszip@3\.10\.1\/\+esm/);
assert.match(media, /pdfjs-dist@4\.6\.82\/build\/pdf\.min\.mjs/);
assert.match(media, /GlobalWorkerOptions\.workerSrc = 'https:\/\/cdn\.jsdelivr\.net\/npm\/pdfjs-dist@4\.6\.82\/build\/pdf\.worker\.min\.mjs'/);

const page = readFileSync(join(root, 'tn-files/training-page.js'), 'utf8');
assert.match(page, /@vimeo\/player@2\.24\.0\/\+esm/);

const classes = readFileSync(join(root, 'vendor/ffmpeg/classes.js'), 'utf8');
assert.match(classes, /new URL\("\.\/worker\.js", import\.meta\.url\)/);
for (const rel of ['index.js', 'classes.js', 'worker.js', 'const.js', 'errors.js', 'types.js', 'utils.js', 'util/index.js', 'util/const.js', 'util/errors.js', 'util/types.js']) {
  const source = readFileSync(join(root, 'vendor/ffmpeg', rel), 'utf8');
  const specifiers = [...source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]);
  for (const specifier of specifiers) {
    assert.ok(specifier.startsWith('.'), `${rel} imports a non-relative specifier ${specifier}`);
  }
}

const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const ffmpegHeader = vercel.headers.find((entry) => entry.source === '/vendor/ffmpeg/(.*)');
assert.ok(ffmpegHeader, 'vercel.json is missing a /vendor/ffmpeg header');
const contentType = ffmpegHeader.headers.find((header) => header.key.toLowerCase() === 'content-type');
assert.equal(contentType?.value, 'text/javascript; charset=utf-8');

console.log('training-cdn-imports tests ok');
