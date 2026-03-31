import fs from 'fs';
import pkg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');

let dbUrl = '';
for (const line of envFile.split('\n')) {
  if (line.trim().startsWith('DATABASE_URL=')) {
    dbUrl = line.substring(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
    break;
  }
}

async function run() {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const res = await client.query(`
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE state = 'idle in transaction' AND pid <> pg_backend_pid();
    `);
    console.log(`Terminated ${res.rowCount} idle connections.`);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
