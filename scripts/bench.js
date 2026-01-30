// Simple performance benchmark for core operations (mock fetch/render)
import { performance } from 'node:perf_hooks'
import { Config } from '../src/config.js'

async function mockOperation(name, fn) {
  const start = performance.now()
  await fn()
  const end = performance.now()
  const ms = (end - start).toFixed(2)
  console.log(`${name}: ${ms} ms`)
}

async function main() {
  console.log('COREPMS Benchmarks')
  console.log(`Mode=${Config.mode} API=${Config.apiBaseUrl}`)

  await mockOperation('Compute 1e6 sum', async () => {
    let s = 0
    for (let i = 0; i < 1_000_000; i++) s += i
    return s
  })

  await mockOperation('Simulated API', async () => {
    await new Promise(r => setTimeout(r, 50))
  })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

