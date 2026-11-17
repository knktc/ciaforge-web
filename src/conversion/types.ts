/** Random access keeps multi-GB images out of memory and leaves an I/O seam for future decryption. */
export interface ImageInput {
  readonly name: string
  readonly size: number
  read(offset: number, length: number): Promise<Uint8Array>
}
export interface ImageOutput {
  write(offset: number, bytes: Uint8Array): Promise<void>
  finish(): Promise<void>
}
export type EncryptionMode = 'unencrypted' | 'zero-key' | 'original-ncch'
export interface Partition { index: number; offset: number; size: number }
export interface InspectedImage {
  titleId: bigint
  partitions: Partition[]
  encryption: EncryptionMode
}
export interface PreparedImage {
  layout: InspectedImage
  ncch: Uint8Array
  extheader: Uint8Array
  smdh: Uint8Array
}
export type OnProgress = (completed: number, total: number) => void
