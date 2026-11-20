import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getLedgerFilePath } from './app-paths.js'

export { getLedgerFilePath }

/**
 * @returns {Promise<{ entries: any[], path: string }>}
 */
export async function loadLedgerFile() {
  const path = getLedgerFilePath()
  try {
    const raw = await readFile(path, 'utf8')
    const data = JSON.parse(raw)
    const entries = Array.isArray(data?.entries)
      ? data.entries
      : Array.isArray(data)
        ? data
        : []
    return { entries, path }
  } catch (err) {
    if (err && err.code === 'ENOENT') return { entries: [], path }
    throw err
  }
}

/**
 * @param {any[]} entries
 */
export async function saveLedgerFile(entries) {
  const path = getLedgerFilePath()
  await mkdir(dirname(path), { recursive: true })
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: Array.isArray(entries) ? entries : []
  }
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf8')
  return { ok: true, path }
}
