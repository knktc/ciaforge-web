import type { ImageInput, ImageOutput } from './types'

export function browserInput(file: File): ImageInput {
  return {
    name: file.name,
    size: file.size,
    async read(offset, length) {
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())
    },
  }
}

export function browserOutput(writable: FileSystemWritableFileStream): ImageOutput {
  return {
    async write(position, bytes) {
      // The WASM bridge copies bytes into an owned JS buffer before this write.
      await writable.write({ type: 'write', position, data: bytes as Uint8Array<ArrayBuffer> })
    },
    async finish() { await writable.close() },
  }
}
