import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';

// R6: the page names its build, so the recording and the claim can point at one sha.
const sha = process.env.GITHUB_SHA || execSync('git rev-parse HEAD').toString().trim();

await rm('dist', { recursive: true, force: true });
await cp('app', 'dist', { recursive: true });

const html = await readFile('dist/index.html', 'utf8');
const patched = html.replace(/(<meta name="build" content=")[^"]*(")/, `$1${sha}$2`);
if (patched === html) throw new Error('index.html has no <meta name="build"> to fill');
await writeFile('dist/index.html', patched);

console.log(`built ${sha} -> dist/`);
