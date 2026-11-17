# Conversion regression references

`wasm/` is copied without modification from `src/web/pkg/` in the local CiaForge
checkout at commit `39fa555a367a715ba406474016df1095c85a06f0`.
Source: https://github.com/knktc/CiaForge

It is used only by regression tests. Application code must not import it. It is
not copied into `public` or `dist`. The production engine now uses the same WASM
binary with a different host adapter under `src/conversion/wasm`, so comparison
with this frozen copy primarily checks adapter parity.

`javascript/` preserves the former JavaScript serializer and embedded templates
for regression comparisons and the synthetic benchmark. It shares validation
and SHA-256 helpers with production. Independent Node crypto checks also verify
the hashes of the resulting CIA contents.

See the root LICENSE and THIRD_PARTY_NOTICES.md for inherited attribution.
