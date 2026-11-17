# Production WASM engine

The generated `ciaforge_web.js`, type declarations and `ciaforge_web_bg.wasm`
are copied unchanged from `src/web/pkg/` in
[CiaForge](https://github.com/knktc/CiaForge) at commit
`39fa555a367a715ba406474016df1095c85a06f0`.

Only `snippets/ciaforge-web-b405ac4471b06a25/wasm-host.js` is adapted: its
`readAt`, `writeAt` and `finish` functions delegate to this project's
`ImageInput`/`ImageOutput` interfaces rather than File/writable host wrappers.
The Rust bridge copies output into an owned JavaScript buffer before writing.

Vite discovers the generated loader's `new URL(..., import.meta.url)` and emits
the binary as a hashed asset. Initialization is lazy, shared across conversions,
and retried after a failed load. No Rust toolchain is required for normal npm
builds or Cloudflare Pages deployment.

To update the engine, rebuild the upstream `crates/ciaforge-web` crate, copy its
generated package here, retain the host interface adaptation, and record the
new source commit. Run the synthetic parity/hash tests and benchmark before
shipping. Keep `tests/reference/wasm` frozen as a separate adapter reference.

License: MIT; see the root LICENSE and THIRD_PARTY_NOTICES.md.
