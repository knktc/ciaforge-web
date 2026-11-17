import { createHash } from 'node:crypto'
import type { ImageInput, ImageOutput } from '../src/conversion/types'

export function fixture(indices = [0], gameSize = 0x6000) {
  const sizes = indices.map(index => index === 0 ? gameSize : 0x400)
  const bytes = new Uint8Array(0x400 + sizes.reduce((a, b) => a + b, 0))
  const view = new DataView(bytes.buffer)
  const magic = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset)
  magic(0x100, 'NCSD')
  view.setBigUint64(0x108, 0x0004000001234500n, true)
  let start = 0x400
  indices.forEach((index, i) => {
    const size = sizes[i]
    view.setUint32(0x120 + index * 8, start / 0x200, true)
    view.setUint32(0x124 + index * 8, size / 0x200, true)
    magic(start + 0x100, 'NCCH')
    bytes[start + 0x18f] = 4
    if (index === 0) {
      for (let p = 0x200; p < size; p++) bytes[start + p] = (p * 17 + 3) & 255
      bytes.fill(0, start + 0x600, start + 0x800)
      bytes.set(createHash('sha256').update(bytes.subarray(start + 0x200, start + 0x600)).digest(), start + 0x160)
      view.setUint32(start + 0x1a0, 3, true)
      magic(start + 0x600, 'icon')
      view.setUint32(start + 0x608, 0, true)
      view.setUint32(start + 0x60c, 0x36c0, true)
      magic(start + 0x800, 'SMDH')
      const text = (offset: number, value: string) => {
        bytes.fill(0, start + 0x800 + offset, start + 0x800 + offset + 0x80)
        for (let i = 0; i < value.length; i++) view.setUint16(start + 0x800 + offset + i * 2, value.charCodeAt(i), true)
      }
      text(0x208, 'CiaForge 测试')
      text(0x388, 'Synthetic fixture')
    }
    start += size
  })
  return bytes
}

export function memoryInput(bytes: Uint8Array): ImageInput {
  return { name: 'fixture.3ds', size: bytes.length, async read(offset, size) { return bytes.slice(offset, offset + size) } }
}
export class MemoryOutput implements ImageOutput {
  bytes = new Uint8Array(0)
  finished = false
  async write(offset: number, bytes: Uint8Array) {
    if (offset + bytes.length > this.bytes.length) {
      const next = new Uint8Array(offset + bytes.length)
      next.set(this.bytes)
      this.bytes = next
    }
    this.bytes.set(bytes, offset)
  }
  async finish() { this.finished = true }
}
