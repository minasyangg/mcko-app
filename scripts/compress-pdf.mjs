#!/usr/bin/env node
// Сжатие скан-PDF книги перед загрузкой в Storage (bucket book-documents).
// Обёртка над Ghostscript: пересжимает встроенные растровые картинки до ~150 DPI,
// не трогая текстовый слой. Для скан-учебников обычно даёт 3-6x уменьшение веса.
//
// Использование:
//   node scripts/compress-pdf.mjs <input.pdf> [output.pdf] [--dpi 150] [--quality ebook|screen|printer]
//
// Требует установленный Ghostscript (gswin64c на Windows, gs на Linux/macOS).
// Установка на Windows: choco install ghostscript

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const input = args.find(a => !a.startsWith('--'))
if (!input) {
  console.error('Usage: node scripts/compress-pdf.mjs <input.pdf> [output.pdf] [--dpi 150] [--quality ebook]')
  process.exit(1)
}
if (!fs.existsSync(input)) {
  console.error(`Файл не найден: ${input}`)
  process.exit(1)
}

function flag(name, def) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}

const positional = args.filter(a => !a.startsWith('--'))
const output = positional[1] ?? input.replace(/\.pdf$/i, '.compressed.pdf')
const dpi = flag('dpi', '150')
// screen=72dpi/меньше всего, ebook=150dpi/баланс (по умолчанию), printer=300dpi/крупнее
const quality = flag('quality', 'ebook')

function findGhostscript() {
  const candidates = process.platform === 'win32'
    ? ['gswin64c', 'gswin64c.exe', 'gswin32c', 'gswin32c.exe', 'C:\\Program Files\\gs\\gs10.08.0\\bin\\gswin64c.exe']
    : ['gs']
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore' })
      return bin
    } catch { /* пробуем следующий */ }
  }
  // Поиск любой установленной версии в стандартном пути Windows
  if (process.platform === 'win32' && fs.existsSync('C:\\Program Files\\gs')) {
    const versions = fs.readdirSync('C:\\Program Files\\gs').filter(d => d.startsWith('gs'))
    for (const v of versions) {
      const p = `C:\\Program Files\\gs\\${v}\\bin\\gswin64c.exe`
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

const gsBin = findGhostscript()
if (!gsBin) {
  console.error('Ghostscript не найден. Установка: choco install ghostscript (Windows) / apt install ghostscript (Linux) / brew install ghostscript (macOS)')
  process.exit(1)
}

const originalSize = fs.statSync(input).size

console.log(`Сжатие ${input} (${(originalSize / 1024 / 1024).toFixed(1)} МБ), качество=${quality}, dpi=${dpi}...`)

const gsArgs = [
  '-sDEVICE=pdfwrite',
  '-dCompatibilityLevel=1.4',
  `-dPDFSETTINGS=/${quality}`,
  '-dNOPAUSE', '-dBATCH', '-dQUIET',
  `-dColorImageResolution=${dpi}`,
  `-dGrayImageResolution=${dpi}`,
  `-dMonoImageResolution=${Math.max(Number(dpi), 300)}`, // ч/б текст-скан не размывать сильнее
  '-dDownsampleColorImages=true',
  '-dDownsampleGrayImages=true',
  '-dDownsampleMonoImages=true',
  `-sOutputFile=${output}`,
  input,
]

try {
  execFileSync(gsBin, gsArgs, { stdio: 'inherit' })
} catch (e) {
  console.error('Ghostscript завершился с ошибкой:', e.message)
  process.exit(1)
}

const newSize = fs.statSync(output).size
const ratio = (100 * (1 - newSize / originalSize)).toFixed(0)
console.log(`Готово: ${(newSize / 1024 / 1024).toFixed(1)} МБ (экономия ${ratio}%) → ${output}`)

// Sanity-check: если сжатие вдруг ничего не дало или испортило файл (0 байт) — не подсовываем его молча
if (newSize === 0) {
  console.error('Результат — пустой файл, что-то пошло не так. Оригинал не тронут.')
  fs.unlinkSync(output)
  process.exit(1)
}
if (newSize > originalSize) {
  console.warn('⚠ Сжатый файл оказался больше оригинала (редко бывает на уже оптимизированных PDF) — используйте оригинал.')
}
