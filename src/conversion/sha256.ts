import hash from 'hash.js'

// Incremental pure-JS SHA-256. Never pass whole game content to SubtleCrypto.digest().
function create() {
  const state = hash.sha256()
  return {
    update(bytes: Uint8Array) { state.update(bytes); return this },
    digest(): Uint8Array { return Uint8Array.from(state.digest()) },
  }
}
export const sha256 = Object.assign(
  (bytes: Uint8Array) => create().update(bytes).digest(),
  { create },
)
