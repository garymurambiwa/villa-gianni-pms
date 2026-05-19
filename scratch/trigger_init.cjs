const http = require('http');

http.get('http://localhost:3001/api/v1/inventory/init?key=confirm', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      console.log('Init Response:', JSON.stringify(JSON.parse(data), null, 2));
    } catch (e) {
      console.log('Raw Output:', data);
    }
  });
}).on('error', (err) => {
  console.error('Error triggering init:', err.message);
});
