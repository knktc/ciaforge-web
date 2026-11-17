# CiaForge Web

A local, browser-based `.3ds` / `.cci` to `.cia` converter, extracted from
[CiaForge](https://github.com/knktc/CiaForge). The original dark interface, file
picker, game title/publisher/icon preview, conversion progress, save dialog,
success state and clear-file action are retained. The GitHub footer now points
at this repository. ROM contents are never uploaded by the converter.

## Run locally

Node.js 22.16+ (or another supported Node version >=22.12):

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Vite. Use a browser that implements
`showSaveFilePicker` (such as desktop Chrome or Edge). Browsers without it show
the original desktop-download fallback. Production requires HTTPS; localhost
works for development. This migration does not add a whole-file Blob download
fallback, which could exhaust memory on large images.

```sh
npm test
npm run build
npm run preview
```

Select a `.3ds` / `.cci` file with the picker or drop one anywhere on the page.
File drops highlight the picker; unsupported file types and multiple-file drops
show an error. A running conversion keeps its current file.

The optional browser regression check uses an installed Chrome with a temporary
profile and synthetic images. With `npm run preview` running, use a second shell:

```sh
npm run test:browser
```

Set `CIAFORGE_TEST_URL` if the server uses a different URL (default:
`http://127.0.0.1:4173/`) and `CHROME_BIN` if Chrome is not at its default macOS
location or available as `google-chrome` on Linux. This check covers native
file drops, preview, the conversion flow and selection guards; the save picker
and output writable are simulated.

## Cloudflare Pages

This is a static Pages site: HTML, CSS, JavaScript, WebP and the prebuilt WASM
engine are served from `dist`. All file access and conversion run in the
visitor's browser.

Use Pages' Git integration for automatic builds from `knktc/ciaforge-web`:

1. Commit and push the application files to GitHub. Pages builds the remote
   repository; local uncommitted files are not available to its build service.
2. In Cloudflare's **Workers & Pages** dashboard, create a **Pages** project
   and connect the GitHub repository. Choose the Git import flow rather than
   Direct Upload so subsequent pushes can trigger automatic deployments.
3. Configure the project with these settings, then save and deploy:

| Setting | Value |
| --- | --- |
| Project name | `ciaforge-web` (or another available name) |
| Production branch | `main` |
| Framework preset | None |
| Root directory | Repository root (leave blank) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | `22.16.0` (also recorded in `.node-version`) |

Pages installs the npm dependencies before the build. If configuring a Node
version explicitly with `NODE_VERSION` in the dashboard, use the same version
as `.node-version` for both production and preview builds. Enable build image
v3 if the project still uses an older image.
The Rust/WASM engine is checked in as a prebuilt artifact, so the Pages build
needs no Rust or wasm-pack installation. No Pages Functions, server storage,
bindings or secrets are needed. Pages only serves static assets; conversion
runs on the visitor's device.

`public/_headers` sets `application/wasm` for the engine, adds MIME-sniffing
protection and enables immutable caching for Vite's hashed assets.
`public/_redirects` redirects the former `/web.html` entry to `/`.
Both files are included in `dist`. No SPA wildcard redirect or cross-origin
isolation headers are required. Vite emits the production engine from
`src/conversion/wasm` as a hashed `.wasm` asset. The `tests/reference` files are
test-only and are not included in the deployed build.

`npm run build` also runs `check:pages`: it verifies that the hosting rules and
local HTML assets are included, validates the emitted WASM, and checks Pages'
static file size/count limits. CI uses the same build command. To recheck an
existing output directory, run `npm run check:pages`.

After deployment, open the HTTPS URL shown by Pages in desktop Chrome or Edge.
Check that metadata preview and conversion work with an unencrypted image, that
the `.wasm` network response has `Content-Type: application/wasm`, and that
`/web.html` redirects to `/`. `npm run preview` is a Vite preview: it does not
apply Cloudflare's `_headers` or `_redirects` rules.

Custom domains can be added from the Pages project's **Custom domains** tab
after its first deployment. Use the hostname that Pages actually assigns;
`ciaforge-web.pages.dev` is not guaranteed to be available. No Cloudflare project
has been created or published as part of this repository preparation.

Official references:
[build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/),
[static sites](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/),
[Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/),
[Node/build image](https://developers.cloudflare.com/pages/configuration/build-image/),
[headers](https://developers.cloudflare.com/pages/configuration/headers/),
[asset limits](https://developers.cloudflare.com/pages/platform/limits/).

## Supported images and future encryption

Only **unencrypted NCCH** images are supported. Both original-NCCH encryption
and fixed/zero-key encryption are rejected before any output bytes are written.
All included partitions are checked, including manuals and Download Play.
The update partition is omitted, matching the source converter.

TypeScript validates input and provides random-access input/output interfaces;
the Rust/WASM core serializes CIA contents and computes their hashes. Future
decryption will need coordinated validation and engine/input-adapter changes.
There is no boot9 uploader, bundled key material or enabled decryption
implementation in this release. Supporting encryption will require key
derivation, crypto-mode-specific handling and independently verified fixtures;
adding an AES call alone will not be sufficient.

## Implementation and validation

The TypeScript UI uses the original CiaForge Rust/WASM conversion engine.
TypeScript retains strict input validation and metadata preview; `hash.js`
checks only the small ExtHeader during validation. Bulk copying, incremental
content SHA-256 and CIA serialization run in WASM. File contents are read and
written in chunks up to 1 MiB; whole images are never accumulated in application
memory. Browser write staging and actual disk usage are controlled by the
browser. A failed write aborts the staged writable stream. Progress covers the
aggregate size of all contents, including across partition boundaries.

Tests use generated synthetic images, with no game dumps. Four partition layouts
are compared byte-for-byte with both the frozen original engine and the former
JavaScript serializer; metadata is compared too. Independent hash checks and
additional tests cover bounded reads, progress, I/O failures and invalid or
encrypted inputs. This does not replace installation testing on a real 3DS.

See [the WASM assessment](docs/wasm-assessment.md) for the tradeoffs, measurements
and future options. CI runs the tests and build on Linux using Node 22.

## License

MIT. Embedded certificate/ticket/TMD templates and conversion behavior inherit
CiaForge / 3dsconv attribution; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
