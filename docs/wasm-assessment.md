# WASM assessment — 2026-11-06

## Decision

Use the original CiaForge Rust/WASM conversion engine in production. The
TypeScript UI, strict preflight validation, metadata preview and streaming I/O
interfaces remain in place. The former JavaScript serializer lives only under
`tests/reference/javascript` for regression comparisons and benchmarking.

The initial JavaScript implementation was functionally equivalent on the
synthetic fixtures, but its pure-JavaScript SHA-256 made the measured conversion
substantially slower. The small reduction in deployed assets does not justify
that cost for large images.

## Measurements and limits

Run the reproducible synthetic benchmark with:

```sh
node --import tsx scripts/benchmark.ts
```

Local Node 26.3.0 on this Mac, 64 MiB synthetic executable, output discarded:

| Engine | Three rounds (ms) |
| --- | --- |
| Former JavaScript / hash.js | 593, 602, 554 |
| Production Rust / WASM, including preflight and I/O adapter | 168, 129, 132 |

WASM is approximately 3.5–4.7 times faster in these paired rounds. These are
CPU/in-memory adapter measurements, not end-to-end browser disk benchmarks;
browser engines, storage and device speed can change results.

Bulk content hashing and CIA serialization now run in WASM. JavaScript hashes
only the small ExtHeader for preflight validation. The bridge copies input into
WASM memory and output back into owned JavaScript buffers; reads and copy
buffers are bounded at 1 MiB, rather than buffering entire images. Conversion
still runs on the main thread between asynchronous I/O operations.

The production build emits a roughly 210 kB WASM asset (59 kB gzip), plus the
JavaScript UI, loader, validation code, CSS, icon and HTML. `npm run build`
prints the current sizes. The checked-in prebuilt engine means normal builds
still need only Node/npm, including on Cloudflare Pages. See
[`src/conversion/wasm/README.md`](../src/conversion/wasm/README.md) for provenance
and update instructions.

## Behavior and validation

TypeScript checks every included NCCH partition before WASM writes any output,
including manuals and Download Play. Original-NCCH and fixed/zero-key encrypted
images remain rejected. The update partition is omitted. Progress translates
the engine's per-partition counters into aggregate image progress. The existing
browser save flow aborts staged output on conversion or I/O failure.

Four synthetic partition layouts produce byte-for-byte identical CIA files
with the production engine, frozen original engine, and former JavaScript
serializer. The two WASM copies share a binary, so that comparison primarily
checks adapter behavior; the JavaScript serializer supplies a separate
serialization implementation. Independent Node SHA-256 checks verify content
hashes. Tests also cover bounded reads, monotonic progress, invalid/encrypted
inputs, and read/write/close failures.

A local headless Chrome check also exercised the production build: metadata
preview, loading the hashed WASM asset, aborting after a simulated download
failure, retrying successfully, reaching 100% progress and clearing the file.
The browser output's SHA-256 matched the former JavaScript serializer. The save
picker/writable were simulated for this check; real browser filesystem behavior
and physical-console installation remain separate validation steps.

Synthetic parity does not prove installability for every real-world image.
No physical-console installation testing has been performed.

## Future encrypted images

WASM alone does not add encrypted-image support. That work still requires the
correct keys/key derivation, counter construction, NCCH crypto mode handling,
section-aware decryption and independently verified samples. It will require
coordinated preflight and engine/input-adapter changes. No decryption, key
material or key upload flow has been added.

## Source references

- Original engine: https://github.com/knktc/CiaForge
- Conversion behavior and templates: https://github.com/ihaveamac/3dsconv
- CIA format: https://www.3dbrew.org/wiki/CIA

The implementation and performance conclusions above are based on local source
inspection, synthetic regression tests and the benchmark, not a hosting or
format requirement.
