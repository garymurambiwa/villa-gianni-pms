const http = require('http');

function checkPort(port, name) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: port,
      path: '/',
      method: 'GET',
      timeout: 1000
    }, (res) => {
      console.log(`${name} (Port ${port}) is ACTIVE. Status:`, res.statusCode);
      resolve(true);
    });
    
    req.on('error', (err) => {
      console.log(`${name} (Port ${port}) is INACTIVE. Error:`, err.message);
      resolve(false);
    });
    
    req.on('timeout', () => {
      console.log(`${name} (Port ${port}) TIMEOUT.`);
      req.destroy();
      resolve(false);
    });
    
    req.end();
  });
}

async function run() {
  await checkPort(8081, 'Frontend');
  await checkPort(3001, 'Backend');
}

run();
