// Environment variable validator for CI and local use
// Validates presence and format of required AWS and Vite variables
import fs from 'node:fs'
import path from 'node:path'

try {
  // Load local .env if present (non-CI)
  const dotenvPath = path.resolve(process.cwd(), '.env')
  if (fs.existsSync(dotenvPath)) {
    const dotenv = await import('dotenv')
    dotenv.config({ path: dotenvPath })
  }
} catch {}

const useOidc = !!process.env.AWS_ROLE_TO_ASSUME
const rules = [
  { key: 'AWS_ROLE_TO_ASSUME', optional: true, pattern: /^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_-]+$/ },
  { key: 'AWS_ACCESS_KEY_ID', optional: useOidc, pattern: /^(AKIA|ASIA)[A-Z0-9]{16}$/ },
  { key: 'AWS_SECRET_ACCESS_KEY', optional: useOidc, pattern: /^[A-Za-z0-9/+=]{40}$/ },
  { key: 'AWS_REGION', optional: false, pattern: /^[a-z]{2}-[a-z]+-\d$/ },
  { key: 'ECR_REPOSITORY', optional: false, pattern: /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/ },
  { key: 'ECS_CLUSTER', optional: false, pattern: /^[A-Za-z0-9/_-]{1,255}$/ },
  { key: 'ECS_SERVICE', optional: false, pattern: /^[A-Za-z0-9/_-]{1,255}$/ },
  { key: 'CONTAINER_NAME', optional: false, pattern: /^[A-Za-z0-9_-]{1,128}$/ },
  { key: 'VITE_SUPABASE_URL', optional: false, pattern: /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/.*)?$/ },
  { key: 'VITE_SUPABASE_ANON_KEY', optional: false, pattern: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/ },
  { key: 'VITE_API_BASE_URL', optional: false, pattern: /^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/.*)?$/ },
  { key: 'VITE_SENTRY_DSN', optional: true, pattern: /^https:\/\/[A-Za-z0-9]+@[^/]+\/\d+$/ },
  { key: 'HEALTHCHECK_URL', optional: true, pattern: /^https?:\/\/[^\s]+$/ }
]

const errors = []
for (const rule of rules) {
  const val = process.env[rule.key]
  if (!val) {
    if (!rule.optional) errors.push(`${rule.key} is required but missing`)
    continue
  }
  if (rule.pattern && !rule.pattern.test(String(val))) {
    errors.push(`${rule.key} format invalid`)
  }
}

if (errors.length) {
  console.error('Environment validation failed:')
  for (const e of errors) console.error(` - ${e}`)
  process.exit(1)
}

console.log('Environment validation passed.')
