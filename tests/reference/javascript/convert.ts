import { sha256 } from '../../../src/conversion/sha256'
import { prepare, readExact, view } from '../../../src/conversion/inspect'
import { certificateChain, ticketAndTmd } from './templates'
import type { ImageInput, ImageOutput, OnProgress } from '../../../src/conversion/types'

export const CHUNK_SIZE = 1024 * 1024
const RECORDS_OFFSET = 0x38c4

/** Convert one unencrypted image using bounded reads and incremental SHA-256. */
export async function convert(input: ImageInput, output: ImageOutput, onProgress: OnProgress) {
  const game = await prepare(input)
  const { partitions, titleId } = game.layout
  const count = partitions.length
  const total = partitions.reduce((sum, p) => sum + p.size, 0)
  const records = new Uint8Array(count * 0x30)
  for (let i = 0; i < count; i++) {
    const partition = partitions[i]
    view(records).setUint32(i * 0x30, partition.index)
    view(records).setUint16(i * 0x30 + 4, partition.index)
    view(records).setBigUint64(i * 0x30 + 8, BigInt(partition.size))
  }
  const header = new Uint8Array(0x3900 + (count - 1) * 0x40)
  const fields = [0x2020, 0, 0xa00, 0x350, 0xb34 + (count - 1) * 0x30, 0x3ac0]
  fields.forEach((field, i) => view(header).setUint32(i * 4, field, true))
  view(header).setBigUint64(0x18, BigInt(total), true)
  header[0x20] = partitions.reduce((mask, p) => mask | (0x80 >> p.index), 0)
  header.set(certificateChain, 0x2040)
  header.set(ticketAndTmd, 0x2a40)
  header[0x2f9f] = count
  view(header).setBigUint64(0x2c1c, titleId)
  view(header).setBigUint64(0x2f4c, titleId)
  header.set(game.extheader.subarray(0x1c0, 0x1c4), 0x2f5a)
  header.set(records, RECORDS_OFFSET)
  await output.write(0, header)
  let position = header.length
  let done = 0
  onProgress(0, total)
  for (const partition of partitions) {
    const hash = sha256.create()
    let copied = 0
    if (partition.index === 0) {
      for (const bytes of [game.ncch, game.extheader]) {
        hash.update(bytes)
        await output.write(position, bytes)
        position += bytes.length
        copied += bytes.length
        done += bytes.length
      }
    }
    while (copied < partition.size) {
      const bytes = await readExact(input, partition.offset + copied, Math.min(CHUNK_SIZE, partition.size - copied))
      hash.update(bytes)
      await output.write(position, bytes)
      position += bytes.length
      copied += bytes.length
      done += bytes.length
      onProgress(done, total)
    }
    const recordIndex = partitions.indexOf(partition)
    const digest = hash.digest()
    records.set(digest, recordIndex * 0x30 + 0x10)
    await output.write(RECORDS_OFFSET + recordIndex * 0x30 + 0x10, digest)
  }
  const recordHash = sha256(records)
  const info = new Uint8Array(0x900)
  info[3] = count
  info.set(recordHash, 4)
  await output.write(0x2fc7, Uint8Array.of(count))
  await output.write(0x2fc8, recordHash)
  await output.write(0x2fa4, sha256(info))
  const meta = new Uint8Array(0x3ac0)
  meta.set(game.extheader.subarray(0x40, 0x1c0))
  view(meta).setUint32(0x300, 2, true)
  meta.set(game.smdh, 0x400)
  await output.write(position, meta)
  await output.finish()
  onProgress(total, total)
}
