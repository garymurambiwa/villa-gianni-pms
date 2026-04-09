const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/db/query',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

const postData = JSON.stringify({ sql: 'SELECT 1 as test' });

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('API Response:', JSON.parse(data));
    process.exit(0);
  });
});

req.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
req.setTimeout(3000, () => { console.error('Timeout - API not responding'); process.exit(1); });
req.write(postData);
req.end();
