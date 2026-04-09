const http = require('http');

const sql = `
INSERT INTO public.inv_items (id, name, category, base_uom_id, inserted_at) 
VALUES 
('item_onions', 'Fresh Onions', 'Food', 'uom_case', NOW()),
('item_tomatoes', 'Fresh Tomatoes', 'Food', 'uom_case', NOW()),
('item_beans', 'Dry Beans', 'Food', 'uom_case', NOW())
ON CONFLICT (id) DO NOTHING;
`;

const postData = JSON.stringify({ sql });

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/db/exec',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const resp = JSON.parse(data);
    console.log('Items created:', resp.ok ? 'YES ✓' : 'FAILED ✗');
    if (!resp.ok) console.log('Error:', resp.error);
    else console.log('Test items ready for GRN creation');
  });
});

req.on('error', (e) => console.error('Error:', e));
req.write(postData);
req.end();
