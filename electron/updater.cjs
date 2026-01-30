const https = require('https')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFile } = require('child_process')

function logTo(filePath, message) {
  try {
    const line = `[${new Date().toISOString()}] ${message}\n`
    fs.appendFileSync(filePath, line, 'utf8')
  } catch {}
}

function isHttpsUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:'
  } catch {
    return false
  }
}

function isVersionNewer(current, latest) {
  const toParts = (v) => String(v || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  const a = toParts(current)
  const b = toParts(latest)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ai = a[i] || 0
    const bi = b[i] || 0
    if (bi > ai) return true
    if (bi < ai) return false
  }
  return false
}

function verifyChecksum(filePath, expectedSha256) {
  return new Promise((resolve, reject) => {
    try {
      const hash = crypto.createHash('sha256')
      const stream = fs.createReadStream(filePath)
      stream.on('error', (e) => reject(e))
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', () => {
        const digest = hash.digest('hex')
        resolve(digest.toLowerCase() === String(expectedSha256 || '').toLowerCase())
      })
    } catch (e) {
      reject(e)
    }
  })
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        res.resume()
        return
      }
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
  })
}

function downloadWithProgress(url, outFile, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outFile)
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        res.resume()
        return
      }
      const total = Number(res.headers['content-length'] || 0)
      let downloaded = 0
      res.on('data', (chunk) => {
        downloaded += chunk.length
        if (typeof onProgress === 'function' && total > 0) {
          onProgress({ downloaded, total, pct: Number(((downloaded / total) * 100).toFixed(2)) })
        }
      })
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve({ ok: true, path: outFile })))
    })
    req.on('error', (err) => {
      try { fs.unlinkSync(outFile) } catch {}
      reject(err)
    })
  })
}

async function runNsisInstaller(installerPath, loggerPath) {
  return new Promise((resolve, reject) => {
    try {
      const child = execFile(installerPath, ['/S'], { windowsHide: true, detached: true }, (err) => {
        if (err) {
          logTo(loggerPath, `Installer error: ${err.message}`)
          reject(err)
          return
        }
        resolve({ ok: true })
      })
      child.unref()
    } catch (e) {
      logTo(loggerPath, `Failed to start installer: ${e.message}`)
      reject(e)
    }
  })
}

module.exports = {
  isHttpsUrl,
  isVersionNewer,
  verifyChecksum,
  fetchJson,
  downloadWithProgress,
  runNsisInstaller,
  logTo,
}
