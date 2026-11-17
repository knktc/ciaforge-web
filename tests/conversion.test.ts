import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { convert, CHUNK_SIZE } from '../src/conversion/convert'
import { prepare, previewMetadata } from '../src/conversion/inspect'
import { sha256 } from '../src/conversion/sha256'
import { fixture, memoryInput, MemoryOutput } from './fixtures'
import initProductionWasm from '../src/conversion/wasm/ciaforge_web.js'
import { convert as convertJavaScript } from './reference/javascript/convert'
// Frozen upstream host/engine reference is never shipped by Vite.
import initWasm, * as original from './reference/wasm/ciaforge_web.js'
await initWasm({ module_or_path: await readFile(new URL('./reference/wasm/ciaforge_web_bg.wasm', import.meta.url)) })
await initProductionWasm({ module_or_path: await readFile(new URL('../src/conversion/wasm/ciaforge_web_bg.wasm', import.meta.url)) })

for (const indices of [[0], [0, 1], [0, 2], [0, 1, 2]]) {
  test(`byte-for-byte WASM parity: partitions ${indices.join(',')}`, async () => {
    const bytes = fixture(indices)
    const output = new MemoryOutput()
    const reference = new MemoryOutput()
    const file = new File([bytes], 'fixture.3ds')
    await original.convert({ file }, { writable: {
      async write({ position, data }: { position: number; data: Uint8Array }) { await reference.write(position, data) },
      async close() { await reference.finish() },
    } }, file.name, file.size, () => {})
    await convert(memoryInput(bytes), output, () => {})
    assert.deepEqual(output.bytes, reference.bytes)
    const javascript = new MemoryOutput()
    await convertJavaScript(memoryInput(bytes), javascript, () => {})
    assert.deepEqual(output.bytes, javascript.bytes)
    assert.equal(output.finished, true)
    const metadata = previewMetadata(await prepare(memoryInput(bytes)))
    assert.equal(metadata.title, await original.preview_title({ file }, file.name, file.size))
    assert.equal(metadata.publisher, await original.preview_publisher({ file }, file.name, file.size))
    assert.deepEqual(metadata.icon, await original.preview_icon({ file }, file.name, file.size))
  })
}

test('multi-chunk conversion uses bounded reads, monotonic aggregate progress and valid TMD hashes', async () => {
  const bytes = fixture([0, 1, 2], CHUNK_SIZE * 2 + 0x6000)
  const input = memoryInput(bytes)
  let maximumRead = 0
  const read = input.read
  input.read = async (offset, length) => { maximumRead = Math.max(maximumRead, length); return read(offset, length) }
  const output = new MemoryOutput()
  const updates: number[] = []
  await convert(input, output, (done, total) => { assert.ok(done <= total); updates.push(done) })
  assert.ok(maximumRead <= CHUNK_SIZE)
  assert.ok(updates.every((done, i) => i === 0 || done >= updates[i - 1]))
  assert.equal(updates.at(-1), bytes.length - 0x400)
  let start = 0x3980
  for (let i = 0; i < 3; i++) {
    const record = output.bytes.subarray(0x38c4 + i * 0x30, 0x38f4 + i * 0x30)
    const size = Number(new DataView(record.buffer, record.byteOffset).getBigUint64(8))
    assert.deepEqual(record.slice(0x10), new Uint8Array(createHash('sha256').update(output.bytes.subarray(start, start + size)).digest()))
    start += size
  }
})

for (const flags of [0, 1]) test(`reject encryption flags ${flags} before writing output`, async () => {
  const bytes = fixture()
  bytes[0x400 + 0x18f] = flags
  const output = new MemoryOutput()
  await assert.rejects(convert(memoryInput(bytes), output, () => {}), /encryption/)
  assert.equal(output.bytes.length, 0)
})

test('reject encrypted optional partitions', async () => {
  const bytes = fixture([0, 1])
  bytes[0x400 + 0x6000 + 0x18f] = 0
  const output = new MemoryOutput()
  await assert.rejects(convert(memoryInput(bytes), output, () => {}), /encryption/)
  assert.equal(output.bytes.length, 0)
})

test('WASM read failures reject conversion without finishing output', async () => {
  const bytes = fixture([0], CHUNK_SIZE * 2)
  const input = memoryInput(bytes)
  const read = input.read
  input.read = async (offset, length) => length === CHUNK_SIZE ? new Uint8Array(0) : read(offset, length)
  const output = new MemoryOutput()
  await assert.rejects(convert(input, output, () => {}), error => /browser I\/O failed/.test(String(error)))
  assert.equal(output.finished, false)
})

test('WASM propagates write and close failures', async () => {
  for (const failOnClose of [false, true]) {
    const output = {
      async write() { if (!failOnClose) throw new Error('write failed') },
      async finish() { throw new Error('close failed') },
    }
    await assert.rejects(convert(memoryInput(fixture()), output, () => {}), error => /browser I\/O failed/.test(String(error)))
  }
})

test('reject invalid headers, ranges, ExtHeader hashes and missing icons', async () => {
  await assert.rejects(prepare(memoryInput(new Uint8Array(0x200))), /NCSD/)
  await assert.rejects(prepare(memoryInput(fixture().slice(0, 0x500))), /partition/)
  let bytes = fixture()
  bytes[0x600] ^= 1
  await assert.rejects(prepare(memoryInput(bytes)), /ExtHeader/)
  bytes = fixture()
  bytes[0xa00] = 0
  await assert.rejects(prepare(memoryInput(bytes)), /icon/)
})

test('incremental SHA-256 agrees with node crypto across chunk boundaries', () => {
  for (const length of [0, 1, 55, 56, 63, 64, 65, 1024, CHUNK_SIZE + 13]) {
    const bytes = Uint8Array.from({ length }, (_, i) => i & 255)
    const state = sha256.create()
    for (let offset = 0; offset < length; offset += 37) state.update(bytes.subarray(offset, offset + 37))
    assert.deepEqual(state.digest(), new Uint8Array(createHash('sha256').update(bytes).digest()))
  }
})
