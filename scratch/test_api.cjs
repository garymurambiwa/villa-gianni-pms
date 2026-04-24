
const http = require('http');

http.get('http://localhost:3001/api/v1/inventory/items', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      console.log(JSON.stringify(JSON.parse(data), null, 2));
    } catch (e) {
      console.log('Raw output:', data);
    }
  });
}).on('error', (err) => {
  console.log('Error:', err.message);
});
