import { spawnSync } from 'node:child_process'

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (res.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(' ')}`)
    process.exit(res.status || 1)
  }
}

console.log('Running npm audit (moderate+)...')
run('npm', ['audit', '--audit-level=moderate'])

console.log('Security check complete.')

