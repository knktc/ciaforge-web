import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixture } from '../tests/fixtures'

const appUrl = new URL(process.env.CIAFORGE_TEST_URL ?? 'http://127.0.0.1:4173/')
const chromeBin = process.env.CHROME_BIN ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
const temporary = await mkdtemp(join(tmpdir(), 'ciaforge-drop-'))
const chrome = spawn(chromeBin, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${temporary}/profile`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })
let socket: WebSocket | undefined
let chromeErrors = ''
chrome.stderr.on('data', chunk => { chromeErrors += chunk })
try {
  let port: string | undefined
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(`${temporary}/profile/DevToolsActivePort`, 'utf8')).split('\n')[0]; break } catch {}
    if (chrome.exitCode !== null || chrome.signalCode !== null) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(port, `Chrome must start: ${chromeErrors}`)
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  socket = new WebSocket(targets.find((t: any) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise(resolve => socket!.addEventListener('open', resolve, { once: true }))
  const pending = new Map<number, { resolve: Function; reject: Function }>()
  let id = 0
  const send = (method: string, params = {}): Promise<any> => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    socket!.send(JSON.stringify({ id, method, params }))
  })
  socket.addEventListener('message', event => {
    const result = JSON.parse(String(event.data))
    if (!result.id) return
    const waiter = pending.get(result.id)!
    pending.delete(result.id)
    result.error ? waiter.reject(result.error) : waiter.resolve(result.result)
  })
  const evaluate = async (expression: string) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const until = async (expression: string) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`Timed out: ${expression}`)
  }
  await send('Page.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.smoke = { saved: 0, names: [], aborted: 0 };
    if (location.search.includes('unsupported')) delete window.showSaveFilePicker;
    else window.showSaveFilePicker = async ({ suggestedName }) => {
      window.smoke.names.push(suggestedName);
      await new Promise(resolve => window.releaseSave = resolve);
      return { createWritable: async () => ({
        write: async () => {}, close: async () => { window.smoke.saved++; },
        abort: async () => { window.smoke.aborted++; }
      }) };
    };
    window.addEventListener('dragover', event => {
      window.lastDragPrevented = event.defaultPrevented;
    });
  ` })
  await send('Page.navigate', { url: appUrl.href })
  await until(`document.readyState === 'complete' && !!document.querySelector('#action')`)
  const valid = `${temporary}/fixture.3ds`
  const replacement = `${temporary}/replacement.CCI`
  const invalid = `${temporary}/invalid.txt`
  await writeFile(valid, fixture())
  await writeFile(replacement, fixture([0, 1]))
  await writeFile(invalid, 'not a ROM')
  const drag = async (paths: string[], selector = '.picker') => {
    const { x, y } = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`)
    const data = { items: [], files: paths, dragOperationsMask: 1 }
    await send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data })
    await send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data })
    assert.equal(await evaluate('window.lastDragPrevented'), true, 'Dragging a file must suppress browser navigation and accept a drop')
    await send('Input.dispatchDragEvent', { type: 'drop', x, y, data })
  }
  await drag([valid])
  await until(`!document.querySelector('#preview').hidden && !document.querySelector('#action').disabled`)
  assert.equal(await evaluate(`document.querySelector('#title').textContent`), 'CiaForge 测试')
  assert.ok((await evaluate(`document.querySelector('#selected').textContent`)).startsWith('fixture.3ds'))
  await drag([replacement], 'header')
  await until(`document.querySelector('#selected').textContent.startsWith('replacement.CCI') && !document.querySelector('#action').disabled`)
  await evaluate(`document.querySelector('#action').click()`)
  await until(`typeof window.releaseSave === 'function'`)
  await drag([valid], 'header')
  assert.ok((await evaluate(`document.querySelector('#selected').textContent`)).startsWith('replacement.CCI'), 'Busy conversion must keep its selected file')
  await evaluate(`window.releaseSave()`)
  await until(`document.querySelector('#status').dataset.state === 'success'`)
  assert.deepEqual(await evaluate('window.smoke.names'), ['replacement.cia'])
  assert.equal(await evaluate('window.smoke.saved'), 1)
  await drag([valid], 'header')
  await until(`!document.querySelector('#action').disabled && document.querySelector('#action').textContent === 'Convert to CIA'`)
  assert.equal(await evaluate(`document.querySelector('.picker').hidden`), false)
  await drag([invalid])
  assert.equal(await evaluate(`document.querySelector('#action').disabled`), true)
  assert.match(await evaluate(`document.querySelector('#status').textContent`), /\.3ds|\.cci/)
  await drag([valid, replacement])
  assert.match(await evaluate(`document.querySelector('#status').textContent`), /one file/i)
  // The click picker must use the same selection path and allow the same file again.
  const { root } = await send('DOM.getDocument')
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file' })
  await send('DOM.setFileInputFiles', { nodeId, files: [valid] })
  await until(`!document.querySelector('#action').disabled && !document.querySelector('#preview').hidden`)
  await send('Page.navigate', { url: new URL('?unsupported', appUrl).href })
  await until(`document.readyState === 'complete' && !!document.querySelector('#action')`)
  await drag([valid])
  assert.equal(await evaluate(`document.querySelector('#action').disabled && document.querySelector('#file').disabled`), true)
  assert.equal(await evaluate(`document.querySelector('#preview').hidden`), true)
  console.log('PASS: native file drops, page-wide drops, preview, conversion, busy guard, replacement after success, invalid/multiple files, click picker and unsupported browser guard')
} finally {
  socket?.close()
  if (chrome.exitCode === null && chrome.signalCode === null) {
    const exited = new Promise(resolve => chrome.once('exit', resolve))
    chrome.kill()
    await exited
  }
  await rm(temporary, { recursive: true, force: true })
}
