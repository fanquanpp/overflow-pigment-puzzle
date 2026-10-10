#!/usr/bin/env node
/**
 * Zero-dependency static file server.
 *
 * ES modules, the import map and decodeAudioData all need a real HTTP origin, so
 * opening index.html from disk will not work — run this instead.
 *
 *   node tools/serve.mjs                                  → http://127.0.0.1:8080/
 *   node tools/serve.mjs --prefix=overflow-pigment-puzzle  → .../overflow-pigment-puzzle/
 *
 * The prefix exists to reproduce a GitHub Pages *project site*, which is served
 * from https://<user>.github.io/<repo>/ rather than from a domain root. Any path
 * in the source that started with a bare "/" would resolve to the root and 404,
 * so this catches that locally before deploying.
 *
 * Give the prefix WITHOUT a leading slash. Git Bash rewrites arguments that
 * begin with "/" into Windows paths, so `--prefix=/foo` would arrive as
 * `C:/Program Files/Git/foo`.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

// normalise: accept "foo", "/foo" or "foo/" and produce "/foo" (or "")
const rawPrefix = arg('prefix', process.env.PREFIX ?? '');
const PREFIX = rawPrefix ? '/' + rawPrefix.replace(/^\/+|\/+$/g, '') : '';
const PORT = Number(arg('port', process.env.PORT ?? (PREFIX ? 8081 : 8080)));
const HOST = process.env.HOST ?? '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);

    if (PREFIX) {
      if (pathname === PREFIX) {
        res.writeHead(302, { location: PREFIX + '/' }).end();
        return;
      }
      if (!pathname.startsWith(PREFIX + '/')) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end(`404 ${pathname} (outside ${PREFIX}/)`);
        return;
      }
      pathname = pathname.slice(PREFIX.length);
    }
    if (pathname === '' || pathname.endsWith('/')) pathname += 'index.html';

    // resolve inside ROOT only
    const target = normalize(join(ROOT, pathname));
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`404 ${pathname}`);
      return;
    }

    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end(`500 ${err.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  OVERFLOW — serving ${ROOT}`);
  if (PREFIX) console.log(`  simulating a GitHub Pages project site (prefix ${PREFIX}/)`);
  console.log(`  http://${HOST}:${PORT}${PREFIX}/\n`);
});
