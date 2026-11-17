import { convert } from './conversion/convert'
import { browserInput, browserOutput } from './conversion/browser'
import { prepare, previewMetadata } from './conversion/inspect'

const input = document.querySelector<HTMLInputElement>('#file')!
const action = document.querySelector<HTMLButtonElement>('#action')!
const selected = document.querySelector<HTMLElement>('#selected')!
const status = document.querySelector<HTMLElement>('#status')!
const progress = document.querySelector<HTMLProgressElement>('#progress')!
const pickerArea = document.querySelector<HTMLElement>('.picker')!
const preview = document.querySelector<HTMLElement>('#preview')!
const icon = document.querySelector<HTMLCanvasElement>('#icon')!
const title = document.querySelector<HTMLElement>('#title')!
const publisher = document.querySelector<HTMLElement>('#publisher')!
const unsupported = document.querySelector<HTMLElement>('#unsupported')!
const canSave = 'showSaveFilePicker' in window
let file: File | null = null
let selectionVersion = 0
let busy = false
let completed = false

function setStatus(message: string, state = '') {
  status.textContent = message
  status.dataset.state = state
}

function clearFile() {
  selectionVersion++
  file = null
  completed = false
  input.value = ''
  pickerArea.hidden = false
  selected.textContent = ''
  preview.hidden = true
  progress.hidden = true
  progress.value = 0
  action.textContent = 'Convert to CIA'
  action.disabled = true
  setStatus('')
}

if (!canSave) {
  unsupported.hidden = false
  input.disabled = true
  setStatus('Please download the desktop app to convert this file')
}

async function selectFile(current: File | null) {
  if (busy || !canSave) return
  clearFile()
  if (!current) return
  if (!/\.(3ds|cci)$/i.test(current.name)) {
    setStatus('Choose a .3ds or .cci file')
    return
  }
  const version = selectionVersion
  file = current
  selected.textContent = `${current.name} · ${(current.size / 1024 / 1024).toFixed(1)} MB`
  try {
    const metadata = previewMetadata(await prepare(browserInput(current)))
    if (version !== selectionVersion || busy) return
    title.textContent = metadata.title || current.name
    publisher.textContent = metadata.publisher
    drawIcon(metadata.icon)
    preview.hidden = false
    action.disabled = false
  } catch (error) {
    if (version === selectionVersion) setStatus(error instanceof Error ? error.message : String(error))
  }
}

input.addEventListener('change', () => { void selectFile(input.files?.[0] ?? null) })

// Handle file drags across the whole page so the browser cannot open the ROM.
const isFileDrag = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files') || !!event.dataTransfer?.files.length
let dragDepth = 0
function clearDrag() {
  dragDepth = 0
  pickerArea.classList.remove('is-dragover')
}
document.addEventListener('dragenter', event => {
  if (!isFileDrag(event)) return
  event.preventDefault()
  dragDepth++
  if (!busy && canSave) pickerArea.classList.add('is-dragover')
})
document.addEventListener('dragover', event => {
  if (!isFileDrag(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = busy || !canSave ? 'none' : 'copy'
})
document.addEventListener('dragleave', event => {
  if (!isFileDrag(event)) return
  if (--dragDepth <= 0) clearDrag()
})
document.addEventListener('drop', event => {
  if (!isFileDrag(event)) return
  event.preventDefault()
  clearDrag()
  if (busy || !canSave) return
  const files = event.dataTransfer!.files
  if (files.length !== 1) {
    clearFile()
    setStatus('Drop one file at a time')
    return
  }
  void selectFile(files[0])
})
document.addEventListener('dragend', clearDrag)
window.addEventListener('blur', clearDrag)

function drawIcon(bytes: Uint8Array) {
  const context = icon.getContext('2d')!
  const data = context.createImageData(48, 48)
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
    const tile = (Math.floor(y / 8) * 6 + Math.floor(x / 8)) * 64
    const px = x & 7, py = y & 7
    const morton = (px & 1) | ((py & 1) << 1) | ((px & 2) << 1) | ((py & 2) << 2) | ((px & 4) << 2) | ((py & 4) << 3)
    const value = bytes[(tile + morton) * 2] | bytes[(tile + morton) * 2 + 1] << 8
    const index = (y * 48 + x) * 4
    data.data[index] = (value >> 11 & 31) * 255 / 31
    data.data[index + 1] = (value >> 5 & 63) * 255 / 63
    data.data[index + 2] = (value & 31) * 255 / 31
    data.data[index + 3] = 255
  }
  context.putImageData(data, 0, 0)
}

type SavePicker = (options: { suggestedName: string }) => Promise<{ createWritable(): Promise<FileSystemWritableFileStream> }>
action.addEventListener('click', async () => {
  if (!file || busy) return
  if (completed) { clearFile(); return }
  const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker
  if (!picker) { setStatus('Use a browser with local file saving support, or download the desktop app'); return }
  const current = file
  let writable: FileSystemWritableFileStream | undefined
  clearDrag()
  busy = true
  action.disabled = true
  input.disabled = true
  try {
    // Invoke the picker before any await to preserve the browser's user activation.
    const handle = await picker.call(window, { suggestedName: `${current.name.replace(/\.(cci|3ds)$/i, '')}.cia` })
    writable = await handle.createWritable()
    pickerArea.hidden = true
    progress.hidden = false
    progress.value = 0
    setStatus('Converting…')
    await convert(browserInput(current), browserOutput(writable), (done, total) => {
      progress.value = total ? done / total * 100 : 0
    })
    writable = undefined
    status.innerHTML = '<strong>Conversion complete</strong><span>Your CIA file has been saved to the selected location</span>'
    status.dataset.state = 'success'
    completed = true
    action.textContent = 'Clear file'
  } catch (error) {
    // Abort staged writes so errors cannot commit a partial CIA over an existing file.
    if (writable) await writable.abort().catch(() => {})
    pickerArea.hidden = false
    progress.hidden = true
    if (error instanceof DOMException && error.name === 'AbortError') setStatus('')
    else setStatus(error instanceof Error ? error.message : String(error))
  } finally {
    busy = false
    input.disabled = false
    action.disabled = false
  }
})
