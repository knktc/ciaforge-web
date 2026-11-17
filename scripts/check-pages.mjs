import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'

const output = new URL('../dist/', import.meta.url)
const read = path => readFile(new URL(path, output))
const html = await read('index.html')
assert.ok(!html.toString().includes('/src/main.ts'), 'HTML must reference built JavaScript')

// Pages reads these files from the build output, rather than the source tree.
for (const name of ['_headers', '_redirects']) {
  assert.deepEqual(await read(name), await readFile(new URL(`../public/${name}`, import.meta.url)),
    `${name} must be copied into dist`)
}

// Catch missing local assets before a Git-integrated Pages build can publish.
for (const [, path] of html.toString().matchAll(/(?:src|href)=["'](\/[^"']+)["']/g)) {
  assert.ok((await stat(new URL(`.${path}`, output))).isFile(), `Missing asset: ${path}`)
}
const assets = await readdir(new URL('assets/', output))
const wasm = assets.filter(name => name.endsWith('.wasm'))
assert.ok(wasm.length > 0, 'The production WASM engine must be included')
for (const name of wasm) {
  assert.ok(WebAssembly.validate(await read(`assets/${name}`)), `Invalid WASM asset: ${name}`)
}

// Cloudflare Pages' per-file limit also applies to the WASM engine.
let count = 0
for (const path of await readdir(output, { recursive: true })) {
  const entry = await stat(new URL(path, output))
  if (!entry.isFile()) continue
  assert.ok(entry.size <= 25 * 1024 * 1024, `Pages asset exceeds 25 MiB: ${path}`)
  count++
}
assert.ok(count <= 20_000, 'Static output exceeds the Pages Free plan file limit')
console.log(`Pages build verified: ${count} files, ${wasm.length} valid WASM asset(s).`)
