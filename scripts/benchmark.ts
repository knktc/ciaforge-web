// Synthetic in-memory CPU benchmark, not browser disk throughput.
import { readFile } from 'node:fs/promises'
import { convert } from '../src/conversion/convert'
import { convert as convertJavaScript } from '../tests/reference/javascript/convert'
import { fixture, memoryInput } from '../tests/fixtures'
import initWasm from '../src/conversion/wasm/ciaforge_web.js'
await initWasm({ module_or_path: await readFile(new URL('../src/conversion/wasm/ciaforge_web_bg.wasm', import.meta.url)) })
const bytes = fixture([0], 64 * 1024 * 1024)
for (let round = 0; round < 3; round++) {
  let start = performance.now()
  await convertJavaScript(memoryInput(bytes), { async write() {}, async finish() {} }, () => {})
  console.log(`JS round ${round + 1}: ${(performance.now() - start).toFixed(0)} ms`)
  start = performance.now()
  await convert(memoryInput(bytes), { async write() {}, async finish() {} }, () => {})
  console.log(`WASM round ${round + 1}: ${(performance.now() - start).toFixed(0)} ms`)
}
