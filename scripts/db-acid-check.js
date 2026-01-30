// Basic ACID compliance checks against MySQL using mysql2/promise
import mysql from 'mysql2/promise'

async function run() {
  const url = process.env.FLYWAY_URL || 'jdbc:mysql://127.0.0.1:3306/corepms'
  const match = url.match(/jdbc:mysql:\/\/([^:/]+):?(\d+)?\/(.+)/)
  if (!match) throw new Error('Invalid FLYWAY_URL')
  const host = match[1]
  const port = Number(match[2] || 3306)
  const database = match[3]
  const user = process.env.FLYWAY_USER || 'root'
  const password = process.env.FLYWAY_PASSWORD || 'example'
  const conn = await mysql.createConnection({ host, port, database, user, password })
  await conn.query(`CREATE TABLE IF NOT EXISTS acid_test (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64))`)
  const [rows0] = await conn.query(`SELECT COUNT(*) as c FROM acid_test`)
  const baseCount = rows0[0].c
  try {
    await conn.beginTransaction()
    await conn.query(`INSERT INTO acid_test (name) VALUES ('tx-commit-1'), ('tx-commit-2')`)
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  }
  let [rows1] = await conn.query(`SELECT COUNT(*) as c FROM acid_test`)
  if (rows1[0].c !== baseCount + 2) throw new Error('Commit did not persist changes')
  try {
    await conn.beginTransaction()
    await conn.query(`INSERT INTO acid_test (name) VALUES ('tx-rollback-1')`)
    throw new Error('force-rollback')
  } catch (e) {
    await conn.rollback()
  }
  let [rows2] = await conn.query(`SELECT COUNT(*) as c FROM acid_test`)
  if (rows2[0].c !== baseCount + 2) throw new Error('Rollback did not revert changes')
  await conn.end()
  console.log('ACID checks passed')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
