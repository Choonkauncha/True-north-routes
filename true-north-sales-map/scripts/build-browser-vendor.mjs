import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'vendor/supabase');
await mkdir(output, { recursive: true });
const dependency = path.join(root, 'node_modules/@supabase/supabase-js');
const metadata = JSON.parse(await readFile(path.join(dependency, 'package.json'), 'utf8'));
await build({
  entryPoints: [path.join(dependency, 'dist/index.mjs')], bundle: true,
  platform: 'browser', format: 'esm', minify: true, legalComments: 'inline',
  outfile: path.join(output, 'supabase.js'),
  banner: { js: `// Supabase JS ${metadata.version}; generated from package-lock.json. Run npm run build:vendor to refresh.` }
});
await copyFile(path.join(dependency, 'LICENSE'), path.join(output, 'LICENSE'));
await writeFile(path.join(output, 'README.md'), `Supabase JS ${metadata.version}, bundled locally with esbuild from the locked dependencies.\n\nRefresh with npm ci and npm run build:vendor. This is upstream SDK code; make application changes in the app modules.\n`);
console.log(`Bundled Supabase JS ${metadata.version} for same-origin browser loading.`);
