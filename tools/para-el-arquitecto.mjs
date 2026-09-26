#!/usr/bin/env node
// tools/para-el-arquitecto.mjs
// DOC-004: genera `para-el-arquitecto/`, una copia PLANA (sin subcarpetas) del código y la documentación del proyecto para
// que el usuario la arrastre de una vez al "Proyecto" de Claude.ai, donde el arquitecto revisa sin poder abrir carpetas.
// Nombre plano = ruta relativa con `/` cambiado por `__` (sin el punto inicial de carpetas ocultas: `.github/x` -> `github__x`).
// SOLO PARA LECTURA EXTERNA: ninguna instancia de Claude Code debe leerla ni usarla como fuente de verdad (los originales mandan).
// Uso: node tools/para-el-arquitecto.mjs        Sin dependencias.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_NAME = 'para-el-arquitecto';
const OUT = join(ROOT, OUT_NAME);
const MAX_BYTES = 400 * 1024;
const TEXT_EXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.md', '.yml', '.yaml', '.txt']);
// Carpetas que NUNCA se recorren (contienen llaves, dependencias, código generado o la propia salida).
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'android', 'signing', OUT_NAME]);
// Carpetas ocultas: solo se admiten estas rutas exactas (el resto, p. ej. .claude/settings.local.json, puede ser personal).
const HIDDEN_ALLOWED = (rel) => rel.startsWith('.github/workflows/') || rel === '.claude/launch.json';
// Nombres que nunca deben copiarse.
const SECRET_NAME = /(\.keystore|\.jks|\.p12|\.pem|\.key)$/i;
const ENV_NAME = /^\.env/i;

/** Devuelve el motivo por el que un archivo (ruta relativa con `/`) NO debe copiarse, o null si puede copiarse. */
export function excludeReason(rel, size = 0) {
  const parts = rel.split('/');
  const name = parts[parts.length - 1];
  if (parts.slice(0, -1).some((d) => EXCLUDED_DIRS.has(d)) || EXCLUDED_DIRS.has(parts[0])) return 'carpeta excluida';
  if (SECRET_NAME.test(name) || ENV_NAME.test(name)) return 'nombre sensible (llave/.env)';
  if (name === 'package-lock.json') return 'package-lock.json';
  if (parts[0].startsWith('.') && !HIDDEN_ALLOWED(rel)) return 'carpeta oculta no admitida';
  if (!TEXT_EXT.has(extname(name).toLowerCase())) return 'extensión no de texto';
  if (size > MAX_BYTES) return 'más de 400 KB';
  return null;
}

/** Nombre plano: `www/js/ui/lock.js` -> `www__js__ui__lock.js`; `.github/x.yml` -> `github__x.yml`. */
export function flatName(rel) {
  return rel.split('/').join('__').replace(/^\./, '');
}

function fail(msg) {
  console.error(`\nERROR: ${msg}\nNo se dejó una carpeta a medias: bórrala y repara antes de subir nada.`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = relative(ROOT, abs).split(sep).join('/');
    if (entry.isSymbolicLink()) continue; // nunca se sigue un enlace
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name) && dir === ROOT) continue;
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(abs, out);
    } else if (entry.isFile()) {
      out.push({ abs, rel });
    }
  }
  return out;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function isBinary(abs) {
  return readFileSync(abs).includes(0);
}

function main() {
  if (!existsSync(join(ROOT, 'www'))) fail(`no encuentro la carpeta www/ en ${ROOT}: ¿el script está en tools/ del proyecto?`);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT);

  const copied = []; // { flat, rel, size }
  const skipped = []; // { rel, why }
  const byFlat = new Map();

  for (const { abs, rel } of walk(ROOT).sort((a, b) => a.rel.localeCompare(b.rel))) {
    const size = statSync(abs).size;
    let why = excludeReason(rel, size);
    if (!why && isBinary(abs)) why = 'binario';
    if (why) {
      // Solo se listan los omitidos "interesantes" (no las carpetas excluidas enteras, que ni se recorren).
      if (why !== 'extensión no de texto' && why !== 'carpeta oculta no admitida') skipped.push({ rel, why });
      continue;
    }
    const flat = flatName(rel);
    if (byFlat.has(flat)) fail(`dos archivos generarían el mismo nombre plano «${flat}»: ${byFlat.get(flat)} y ${rel}`);
    byFlat.set(flat, rel);
    copyFileSync(abs, join(OUT, flat));
    copied.push({ flat, rel, size });
  }

  // ---- verificación DESPUÉS de copiar: nada excluido puede haberse colado ----
  for (const c of copied) {
    const why = excludeReason(c.rel, c.size);
    if (why) fail(`se copió un archivo excluido (${why}): ${c.rel}`);
  }
  for (const entry of readdirSync(OUT, { withFileTypes: true })) {
    if (!entry.isFile()) fail(`hay una subcarpeta o entrada rara dentro de ${OUT_NAME}/: ${entry.name}`);
    if (SECRET_NAME.test(entry.name) || ENV_NAME.test(entry.name)) fail(`nombre sensible dentro de ${OUT_NAME}/: ${entry.name}`);
    if (lstatSync(join(OUT, entry.name)).isSymbolicLink()) fail(`enlace simbólico dentro de ${OUT_NAME}/: ${entry.name}`);
  }

  // ---- _INDICE.md ----
  const version = /APP_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(join(ROOT, 'www/js/version.js'), 'utf8'));
  const hash = git(['rev-parse', '--short', 'HEAD']) || '(sin git)';
  const dirty = git(['status', '--porcelain']).split('\n').filter((l) => l && !l.includes(`${OUT_NAME}/`));
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ` +
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const lines = [
    '# _INDICE — copia plana para el arquitecto',
    '',
    '> Solo para lectura externa. Ninguna instancia de Claude Code debe usar esta carpeta para trabajar: los archivos originales son la verdad.',
    '',
    `- Generada: ${stamp}`,
    `- Último commit: \`${hash}\``,
    `- APP_VERSION: \`${version ? version[1] : '?'}\``,
    `- Cambios sin commitear: ${dirty.length ? `SÍ (${dirty.length}): ${dirty.map((l) => '`' + l.trim() + '`').join(', ')}` : 'no'}`,
    `- Archivos copiados: ${copied.length}`,
    '',
    '| Nombre plano | Ruta original |',
    '|---|---|',
    ...copied.map((c) => `| \`${c.flat}\` | \`${c.rel}\` |`),
  ];
  if (skipped.length) {
    lines.push('', '## Omitidos por regla (tamaño, binario, nombre sensible)', '', ...skipped.map((s) => `- \`${s.rel}\`: ${s.why}`));
  }
  writeFileSync(join(OUT, '_INDICE.md'), lines.join('\n') + '\n');

  console.log(`Listo: ${copied.length} archivos + _INDICE.md en ${OUT_NAME}/ (commit ${hash}${dirty.length ? ', con cambios sin commitear' : ''}).`);
  if (skipped.length) console.log(`Omitidos por regla: ${skipped.length} (ver _INDICE.md).`);
}

// Solo se ejecuta al lanzarlo directamente (los tests importan `excludeReason`/`flatName` sin generar nada).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
