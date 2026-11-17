import initWasm, { convert as convertWasm } from './wasm/ciaforge_web.js'
import { prepare, readExact } from './inspect'
import type { ImageInput, ImageOutput, OnProgress } from './types'

export const CHUNK_SIZE = 1024 * 1024
let initialization: ReturnType<typeof initWasm> | undefined

function ensureWasm() {
  // Share initialization across conversions, and allow a failed download to retry.
  return initialization ??= initWasm().catch(error => {
    initialization = undefined
    throw error
  })
}

/** Validate before writing, then stream conversion and SHA-256 through Rust/WASM. */
export async function convert(input: ImageInput, output: ImageOutput, onProgress: OnProgress) {
  const { layout } = await prepare(input)
  await ensureWasm()
  const total = layout.partitions.reduce((sum, partition) => sum + partition.size, 0)
  let completed = 0
  let partition = 0
  onProgress(0, total)
  await convertWasm(
    { read: (offset: number, length: number) => readExact(input, offset, length) },
    output,
    input.name,
    input.size,
    (done: number) => {
      // The original engine restarts its counter for each content partition.
      onProgress(completed + done, total)
      if (done === layout.partitions[partition].size) {
        completed += done
        partition++
      }
    },
  )
  onProgress(total, total)
}
