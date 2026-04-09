const http = require('http');

const postData = JSON.stringify({
  sql: 'SELECT id, name FROM public.inv_locations LIMIT 5'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/db/query',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      console.log('Locations:', JSON.stringify(response.data || response, null, 2));
    } catch (e) {
      console.log('Response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.write(postData);
req.end();
