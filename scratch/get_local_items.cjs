const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/v1/inventory/items',
  method: 'GET',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log('HTTP Status:', res.statusCode);
      console.log('Items returned by local server:', parsed.data ? parsed.data.map(i => ({ id: i.id, short_id: i.short_id, name: i.name })) : parsed);
    } catch (e) {
      console.log('Raw data:', data);
    }
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.end();
