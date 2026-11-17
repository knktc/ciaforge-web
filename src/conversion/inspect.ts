import { sha256 } from './sha256'
import type { EncryptionMode, ImageInput, InspectedImage, Partition, PreparedImage } from './types'

export const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const magic = (bytes: Uint8Array, offset: number, value: string) =>
  [...value].every((char, i) => bytes[offset + i] === char.charCodeAt(0))

export async function readExact(input: ImageInput, offset: number, length: number, end = input.size) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > end) {
    throw new Error(`${input.name} has an invalid or truncated image range`)
  }
  const bytes = await input.read(offset, length)
  if (bytes.length !== length) throw new Error(`${input.name}: short file read`)
  return bytes
}

function assertUnencrypted(mode: EncryptionMode, name: string) {
  if (mode !== 'unencrypted') {
    throw new Error(`${name} uses ${mode} encryption, which is not implemented yet`)
  }
}

export async function inspect(input: ImageInput): Promise<InspectedImage> {
  const header = await readExact(input, 0, 0x200)
  if (!magic(header, 0x100, 'NCSD')) throw new Error(`${input.name} is not a CCI file: missing NCSD magic`)
  const partitions: Partition[] = []
  for (let index = 0; index < 3; index++) {
    const offset = view(header).getUint32(0x120 + index * 8, true) * 0x200
    const size = view(header).getUint32(0x124 + index * 8, true) * 0x200
    if (index !== 0 && offset === 0 && size === 0) continue
    if (offset < 0x200 || size < (index === 0 ? 0x600 : 0x200) || offset + size > input.size) {
      throw new Error(`${input.name} has an invalid partition ${index} range`)
    }
    if (partitions.some(p => offset < p.offset + p.size && p.offset < offset + size)) {
      throw new Error(`${input.name} has overlapping partitions`)
    }
    partitions.push({ index, offset, size })
  }
  // Check every included NCCH, not just the executable: encrypted manuals must not slip through.
  for (const partition of partitions) {
    const ncch = await readExact(input, partition.offset, 0x200)
    if (!magic(ncch, 0x100, 'NCCH')) throw new Error(`${input.name} is not a CCI file: missing NCCH magic`)
    const flags = ncch[0x18f]
    const mode: EncryptionMode = flags & 4 ? 'unencrypted' : flags & 1 ? 'zero-key' : 'original-ncch'
    assertUnencrypted(mode, input.name)
  }
  // Future encrypted-image support belongs in inspect/prepare and a decrypting input adapter.
  return { titleId: view(header).getBigUint64(0x108, true), partitions, encryption: 'unencrypted' }
}

export async function prepare(input: ImageInput): Promise<PreparedImage> {
  const layout = await inspect(input)
  const game = layout.partitions[0]
  const end = game.offset + game.size
  const ncch = await readExact(input, game.offset, 0x200, end)
  const extheader = await readExact(input, game.offset + 0x200, 0x400, end)
  const digest = sha256(extheader)
  if (!digest.every((byte, i) => byte === ncch[0x160 + i])) {
    throw new Error(`${input.name} has an invalid ExtHeader SHA-256 hash`)
  }
  extheader[0x0d] |= 2
  ncch.set(sha256(extheader), 0x160)
  const exefsOffset = view(ncch).getUint32(0x1a0, true) * 0x200
  if (exefsOffset < 0x600) throw new Error(`${input.name} has an invalid ExeFS offset`)
  const exefs = await readExact(input, game.offset + exefsOffset, 0x200, end)
  // ExeFS contains ten entries; the rest of its header contains reserved bytes and hashes.
  for (let offset = 0; offset < 10 * 0x10; offset += 0x10) {
    if (magic(exefs, offset, 'icon') && exefs[offset + 4] === 0) {
      const size = view(exefs).getUint32(offset + 12, true)
      if (size < 0x36c0) throw new Error(`${input.name} has a truncated ExeFS icon`)
      const start = game.offset + exefsOffset + 0x200 + view(exefs).getUint32(offset + 8, true)
      const smdh = await readExact(input, start, 0x36c0, end)
      if (!magic(smdh, 0, 'SMDH')) throw new Error(`${input.name} has an invalid SMDH icon`)
      return { layout, ncch, extheader, smdh }
    }
  }
  throw new Error(`${input.name} does not contain an ExeFS icon`)
}

export function previewMetadata(game: PreparedImage) {
  const text = (offset: number) => {
    const bytes = game.smdh.subarray(offset, offset + 0x80)
    let end = 0
    while (end < bytes.length && (bytes[end] || bytes[end + 1])) end += 2
    return new TextDecoder('utf-16le').decode(bytes.subarray(0, end))
  }
  return { title: text(0x208), publisher: text(0x388), icon: game.smdh.slice(0x24c0, 0x36c0) }
}
