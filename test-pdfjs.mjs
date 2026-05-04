/**
 * Standalone test for pdfjs-dist v5 image extraction in Node.js
 *
 * Run: node test-pdfjs.mjs
 *
 * FINDINGS (documented here after investigation):
 *
 * BUG 1 — page.objs.get() is NOT synchronous after getOperatorList() resolves.
 *   The worker sends image data via a separate async message ("obj" channel).
 *   Some objects may arrive before getOperatorList() resolves (large PDFs),
 *   others arrive after. You MUST use the callback form:
 *     page.objs.get(name, callback)          ← async, waits for resolution
 *   The synchronous form throws if not yet resolved:
 *     page.objs.get(name)                    ← throws if not ready
 *
 * BUG 2 — Buffer.from(img.data.buffer ?? img.data) is wrong.
 *   img.data is a Uint8ClampedArray whose backing .buffer may be larger
 *   than the actual view (due to memory alignment / shared pool).
 *   Correct: Buffer.from(img.data)   — copies just the view bytes.
 *   Wrong:   Buffer.from(img.data.buffer ?? img.data) — may copy extra bytes.
 *
 * BUG 3 — Image channel count is NOT always 4 (RGBA).
 *   pdfjs v5 sets img.kind to one of ImageKind: GRAYSCALE_1BPP=1, RGB_24BPP=2, RGBA_32BPP=3.
 *   Most PDFs have RGB_24BPP (kind=2, channels=3). Passing channels:4 to sharp.raw
 *   when data is actually 3-channel will crash with "memory area too small".
 *
 * CORRECT APPROACH:
 *   1. Use getOperatorList() to collect image XObject names from OPS.paintImageXObject.
 *   2. For each name, call page.objs.get(name, callback) — wrap in Promise.
 *   3. Check img.kind to determine channels (ImageKind exported by pdfjs-dist).
 *   4. Buffer.from(img.data) to get a safe copy of the raw pixel data.
 *   5. Pass { raw: { width, height, channels } } to sharp.
 *   6. Do NOT call page.cleanup() until all callbacks have resolved.
 */

import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const require = createRequire(import.meta.url)

// ──────────────────────────────────────────────────────────────
// Setup pdfjs
// ──────────────────────────────────────────────────────────────
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href

const { ImageKind, OPS } = pdfjsLib
console.log('pdfjs-dist version:', pdfjsLib.version ?? '5.x')
console.log('OPS.paintImageXObject:', OPS.paintImageXObject)
console.log('ImageKind:', ImageKind)
console.log()

// ──────────────────────────────────────────────────────────────
// Helper: promisified page.objs.get()
// ──────────────────────────────────────────────────────────────
function getObjAsync(objs, name, timeoutMs = 8000) {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`timeout waiting for obj: ${name}`)), timeoutMs)
    objs.get(name, (data) => { clearTimeout(timer); res(data) })
  })
}

// ──────────────────────────────────────────────────────────────
// PDF 1: project PDFs (likely text-only, no embedded images)
// ──────────────────────────────────────────────────────────────
console.log('=== Project PDFs ===')
for (const pdfFile of ['vpr_test+instruction.pdf', 'vpr_test+answers.pdf']) {
  const pdfBuffer = readFileSync(resolve(pdfFile))
  const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), disableFontFace: true, verbosity: 0 }).promise
  let totalImages = 0
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p)
    const ops = await page.getOperatorList()
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === OPS.paintImageXObject) totalImages++
    }
    page.cleanup()
  }
  await pdfDoc.destroy()
  console.log(`  ${pdfFile}: ${totalImages} paintImageXObject ops (text-only PDF if 0)`)
}

// ──────────────────────────────────────────────────────────────
// PDF 2: test PDF with real embedded images
// ──────────────────────────────────────────────────────────────
const TEST_PDF = 'node_modules/pdf-parse/test/data/02-valid.pdf'
console.log(`\n=== Image extraction test: ${TEST_PDF} ===`)
const pdfBuffer = readFileSync(TEST_PDF)
const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), disableFontFace: true, verbosity: 0 }).promise
console.log(`Pages: ${pdfDoc.numPages}`)

// ── BUG 1 DEMO: synchronous vs async ──
console.log('\n--- BUG 1: page.objs.get() timing ---')
{
  const page = await pdfDoc.getPage(1)
  const ops = await page.getOperatorList()
  const names = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] === OPS.paintImageXObject) names.push(String(ops.argsArray[i][0]))
  }
  const uniqueNames = [...new Set(names)]
  console.log(`OPS found ${uniqueNames.length} image names: ${uniqueNames.join(', ')}`)

  // Sync check immediately — most will NOT be ready yet
  let syncReady = 0, syncNotReady = 0
  for (const name of uniqueNames) {
    if (page.objs.has(name)) syncReady++
    else syncNotReady++
  }
  console.log(`Immediately after getOperatorList(): ready=${syncReady}, not-ready=${syncNotReady}`)

  // Attempt sync get on a not-ready one
  const notReadyName = uniqueNames.find(n => !page.objs.has(n))
  if (notReadyName) {
    try {
      page.objs.get(notReadyName)
      console.log(`Sync get on not-ready obj: unexpectedly succeeded`)
    } catch(e) {
      console.log(`Sync get on not-ready obj THROWS: "${e.message}"`)
    }
  }

  // Async callback form — always works
  const imgData = await getObjAsync(page.objs, uniqueNames[0])
  console.log(`Callback get on ${uniqueNames[0]}: SUCCESS, kind=${imgData?.kind}, w=${imgData?.width}, h=${imgData?.height}`)
  page.cleanup()
}

// ── BUG 2 DEMO: Buffer.from(.buffer) vs Buffer.from(data) ──
console.log('\n--- BUG 2: Buffer.from(img.data.buffer) vs Buffer.from(img.data) ---')
{
  const pdfDoc2 = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), disableFontFace: true, verbosity: 0 }).promise
  const page = await pdfDoc2.getPage(1)
  await page.getOperatorList()
  const img = await getObjAsync(page.objs, 'img_p0_3')
  const data = img.data
  console.log(`img_p0_3: ${img.width}x${img.height} kind=${img.kind}`)
  console.log(`  data.length: ${data.length} (correct size)`)
  console.log(`  data.buffer.byteLength: ${data.buffer.byteLength} (may be larger — ArrayBuffer alignment)`)
  const buggy = Buffer.from(data.buffer ?? data)
  const correct = Buffer.from(data)  // copies just the view
  console.log(`  WRONG  Buffer.from(data.buffer).length: ${buggy.length} ${buggy.length !== data.length ? '<-- BUG: wrong size!' : ''}`)
  console.log(`  CORRECT Buffer.from(data).length: ${correct.length} ${correct.length === data.length ? '<-- correct' : ''}`)
  page.cleanup()
  await pdfDoc2.destroy()
}

// ── BUG 3 DEMO: wrong channels=4 for RGB_24BPP data ──
console.log('\n--- BUG 3: ImageKind and correct channels for sharp ---')
{
  const kindNames = { [ImageKind.GRAYSCALE_1BPP]: 'GRAYSCALE_1BPP(1ch)', [ImageKind.RGB_24BPP]: 'RGB_24BPP(3ch)', [ImageKind.RGBA_32BPP]: 'RGBA_32BPP(4ch)' }
  const pdfDoc3 = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), disableFontFace: true, verbosity: 0 }).promise

  for (let p = 1; p <= Math.min(2, pdfDoc3.numPages); p++) {
    const page = await pdfDoc3.getPage(p)
    const ops = await page.getOperatorList()
    const names = new Set()
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === OPS.paintImageXObject) names.add(String(ops.argsArray[i][0]))
    }
    for (const name of names) {
      const img = await getObjAsync(page.objs, name)
      const ch = img.kind === ImageKind.RGBA_32BPP ? 4 : img.kind === ImageKind.RGB_24BPP ? 3 : 1
      const expectedBytes = img.width * img.height * ch
      console.log(`  Page ${p} ${name}: kind=${kindNames[img.kind]}, ${img.width}x${img.height}, data=${img.data.length}B, expected=${expectedBytes}B, match=${img.data.length===expectedBytes}`)
    }
    page.cleanup()
  }
  await pdfDoc3.destroy()
}

await pdfDoc.destroy()

// ──────────────────────────────────────────────────────────────
// CORRECT implementation
// ──────────────────────────────────────────────────────────────
console.log('\n=== CORRECT extractImagesWithPdfjs implementation ===')

async function extractImagesWithPdfjs(pdfBuffer) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createRequire } = await import('module')
  const { pathToFileURL } = await import('url')
  const require = createRequire(import.meta.url)
  const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href

  const { OPS, ImageKind } = pdfjsLib

  const pdfDoc = await pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableFontFace: true,
    verbosity: 0,
  }).promise

  const images = []

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum)
    try {
      const ops = await page.getOperatorList()
      const seenNames = new Set()
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] === OPS.paintImageXObject) {
          seenNames.add(String(ops.argsArray[i][0]))
        }
      }

      for (const name of seenNames) {
        // FIX 1: always use callback form — synchronous get() throws if not yet resolved
        const img = await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error(`timeout: ${name}`)), 8000)
          page.objs.get(name, (data) => { clearTimeout(t); res(data) })
        })

        if (!img?.data || !img.width || !img.height) continue
        if (img.width < 32 || img.height < 32) continue

        // FIX 2: use Buffer.from(img.data) not Buffer.from(img.data.buffer)
        // img.data is a typed array view; .buffer may be larger than the view
        const rawBuf = Buffer.from(img.data)

        // FIX 3: derive channels from img.kind, not hardcoded 4
        const channels =
          img.kind === ImageKind.RGBA_32BPP ? 4
          : img.kind === ImageKind.RGB_24BPP ? 3
          : 1  // GRAYSCALE_1BPP

        images.push({
          data: rawBuf,
          channels,
          index: images.length,
          width: img.width,
          height: img.height,
        })
      }
    } catch (e) {
      console.warn(`[pdfjs] page ${pageNum} error:`, e.message)
    } finally {
      page.cleanup()
    }
  }

  await pdfDoc.destroy()
  return images
}

const buf = readFileSync(TEST_PDF)
const images = await extractImagesWithPdfjs(buf)
console.log(`Extracted ${images.length} images:`)
for (const img of images) {
  const expectedBytes = img.width * img.height * img.channels
  console.log(`  [${img.index}] ${img.width}x${img.height} ch=${img.channels} rawBytes=${img.data.length} bytesOK=${img.data.length===expectedBytes}`)
}

process.exit(0)
