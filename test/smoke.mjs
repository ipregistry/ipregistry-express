/*
 * Packaging smoke test: packs the library, installs the tarball into a
 * temporary project, and verifies that both module systems can load it and
 * that the exports map, dist files, and default export survive packaging.
 *
 * Run with: npm run test:smoke (requires network access for npm install).
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workdir = mkdtempSync(join(tmpdir(), 'ipregistry-express-smoke-'))

const CJS_CHECK = `
const assert = require('node:assert')
const lib = require('@ipregistry/express')
assert.strictEqual(typeof lib.ipregistry, 'function', 'named export missing')
assert.strictEqual(lib.default, lib.ipregistry, 'default export mismatch')
assert.strictEqual(typeof lib.blockCountries, 'function')
const middleware = lib.ipregistry({ apiKey: 'test' })
assert.strictEqual(middleware.length, 3, 'middleware must take (req, res, next)')
console.log('cjs ok')
`

const ESM_CHECK = `
import assert from 'node:assert'
import ipregistry, { blockCountries, fakeIpregistry } from '@ipregistry/express'
assert.strictEqual(typeof ipregistry, 'function', 'default export missing')
assert.strictEqual(typeof blockCountries, 'function')
assert.strictEqual(typeof fakeIpregistry, 'function')
const middleware = ipregistry({ apiKey: 'test' })
assert.strictEqual(middleware.length, 3, 'middleware must take (req, res, next)')
console.log('esm ok')
`

let tarball

try {
    // Lifecycle script output (prepack build logs) precedes the JSON on
    // stdout, so parse from the last line that opens the JSON array. Colors
    // are disabled because ANSI escape codes also contain '['.
    const packOutput = execFileSync('npm', ['pack', '--json'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    })
    const packed = JSON.parse(
        packOutput.slice(packOutput.lastIndexOf('\n[') + 1),
    )
    tarball = join(root, packed[0].filename)

    writeFileSync(
        join(workdir, 'package.json'),
        JSON.stringify({ name: 'smoke', private: true }),
    )
    execFileSync('npm', ['install', '--no-save', '--no-audit', tarball], {
        cwd: workdir,
        stdio: 'inherit',
    })

    writeFileSync(join(workdir, 'check.cjs'), CJS_CHECK)
    writeFileSync(join(workdir, 'check.mjs'), ESM_CHECK)

    execFileSync('node', ['check.cjs'], { cwd: workdir, stdio: 'inherit' })
    execFileSync('node', ['check.mjs'], { cwd: workdir, stdio: 'inherit' })

    console.log('packaging smoke test passed')
} finally {
    rmSync(workdir, { recursive: true, force: true })
    if (tarball) {
        rmSync(tarball, { force: true })
    }
}
