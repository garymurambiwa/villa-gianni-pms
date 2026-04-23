import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import url from "url";
import { fileURLToPath } from 'url';
import { execSync } from "child_process";
import pkg from "./package.json";

const getCommitHash = () => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch (e) {
    return "dev";
  }
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Use relative base for production so Electron can load file:// dist
  base: mode === 'development' ? '/' : './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD_INFO__: JSON.stringify(mode === 'development' ? getCommitHash() : ''),
  },
  server: {
    host: "::",
    // Prefer 8081 to align with package.json dev script; allow fallback if busy
    port: 8081,
    strictPort: false,
    hmr: { overlay: false },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  plugins: [
    react(),
    {
      name: "rooms-api",
      apply: 'serve',
      configureServer(server) {
        const dir = path.resolve(__dirname, "server/data");
        const roomsFile = path.join(dir, "rooms.json");
        const auditFile = path.join(dir, "audit.json");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // Seed files if missing
        if (!fs.existsSync(roomsFile)) {
          const seed = [
            { id: 'R101', number: '101', type: 'Standard King', status: 'VC', floor: 1, rate: 120 },
            { id: 'R102', number: '102', type: 'Standard Queen', status: 'OC', floor: 1, rate: 110, guestId: 'G001' },
            { id: 'R103', number: '103', type: 'Deluxe King', status: 'VD', floor: 1, rate: 150 },
            { id: 'R104', number: '104', type: 'Suite', status: 'OC', floor: 1, rate: 250, guestId: 'G002' },
            { id: 'R201', number: '201', type: 'Standard King', status: 'VC', floor: 2, rate: 120 },
            { id: 'R202', number: '202', type: 'Deluxe Queen', status: 'OD', floor: 2, rate: 140, guestId: 'G003' },
            { id: 'R203', number: '203', type: 'Standard King', status: 'VC', floor: 2, rate: 120 },
            { id: 'R204', number: '204', type: 'Suite', status: 'OOO', floor: 2, rate: 250 },
            { id: 'R301', number: '301', type: 'Deluxe King', status: 'VC', floor: 3, rate: 150 },
            { id: 'R302', number: '302', type: 'Standard Queen', status: 'VC', floor: 3, rate: 110 },
            { id: 'R303', number: '303', type: 'Suite', status: 'OC', floor: 3, rate: 250, guestId: 'G004' },
            { id: 'R304', number: '304', type: 'Deluxe King', status: 'VD', floor: 3, rate: 150 }
          ];
          fs.writeFileSync(roomsFile, JSON.stringify(seed, null, 2));
        }
        if (!fs.existsSync(auditFile)) fs.writeFileSync(auditFile, JSON.stringify([], null, 2));

        const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf-8'));
        const writeJSON = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
        const isManager = (role) => ['admin','manager'].includes(String(role||'').toLowerCase());

        const send = (res, status, data) => { res.statusCode = status; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(data)); };
        const parseBody = async (req) => {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return {}; }
        };

        server.middlewares.use(async (req, res, next) => {
          const pathname = url.parse(req.url).pathname || '';
          if (!pathname.startsWith('/api/rooms')) return next();
          const role = req.headers['x-role'];
          try {
            if (req.method === 'GET' && pathname === '/api/rooms') {
              return send(res, 200, readJSON(roomsFile));
            }
            if (req.method === 'GET' && pathname === '/api/rooms/audit') {
              return send(res, 200, readJSON(auditFile));
            }
            if (req.method === 'POST' && pathname === '/api/rooms') {
              if (!isManager(role)) return send(res, 403, { ok:false, error:'Unauthorized' });
              const body = await parseBody(req);
              const rooms = readJSON(roomsFile);
              const number = String(body.number||'').trim();
              const type = String(body.type||'').trim();
              if (number.length < 3 || !/^[a-zA-Z0-9-]+$/.test(number)) return send(res, 400, { ok:false, error:'Invalid room number' });
              if (!type || type.length > 50) return send(res, 400, { ok:false, error:'Invalid room name' });
              if (rooms.some(r=> r.number.toLowerCase() === number.toLowerCase())) return send(res, 409, { ok:false, error:'Duplicate room number' });
              const room = { id: `R${Date.now()}`, number, type, status: body.status || 'VC', floor: Number(body.floor||1), rate: Number(body.rate||0) };
              rooms.unshift(room);
              writeJSON(roomsFile, rooms);
              const audit = readJSON(auditFile);
              audit.unshift({ id:`AUD${Date.now()}`, timestamp:new Date().toISOString(), action:'add', roomId: room.id, after: room, user: body.user||null });
              writeJSON(auditFile, audit);
              return send(res, 200, { ok:true, room });
            }
            if (req.method === 'PUT' && pathname.match(/^\/api\/rooms\/[A-Za-z0-9_-]+$/)) {
              if (!isManager(role)) return send(res, 403, { ok:false, error:'Unauthorized' });
              const id = pathname.split('/').pop();
              const body = await parseBody(req);
              const rooms = readJSON(roomsFile);
              const idx = rooms.findIndex(r=> r.id === id);
              if (idx === -1) return send(res, 404, { ok:false, error:'Not found' });
              const current = rooms[idx];
              const number = body.number!==undefined ? String(body.number).trim() : current.number;
              const type = body.type!==undefined ? String(body.type).trim() : current.type;
              if (number.length < 3 || !/^[a-zA-Z0-9-]+$/.test(number)) return send(res, 400, { ok:false, error:'Invalid room number' });
              if (!type || type.length > 50) return send(res, 400, { ok:false, error:'Invalid room name' });
              if (rooms.some(r=> r.number.toLowerCase() === number.toLowerCase() && r.id !== id)) return send(res, 409, { ok:false, error:'Duplicate room number' });
              const updated = { ...current, ...body, number, type };
              rooms[idx] = updated;
              writeJSON(roomsFile, rooms);
              const audit = readJSON(auditFile);
              audit.unshift({ id:`AUD${Date.now()}`, timestamp:new Date().toISOString(), action:'update', roomId: id, before: current, after: updated, user: body.user||null });
              writeJSON(auditFile, audit);
              return send(res, 200, { ok:true, room: updated });
            }
            if (req.method === 'DELETE' && pathname.match(/^\/api\/rooms\/[A-Za-z0-9_-]+$/)) {
              if (!isManager(role)) return send(res, 403, { ok:false, error:'Unauthorized' });
              const id = pathname.split('/').pop();
              const rooms = readJSON(roomsFile);
              const existing = rooms.find(r=> r.id === id);
              if (!existing) return send(res, 404, { ok:false, error:'Not found' });
              writeJSON(roomsFile, rooms.filter(r=> r.id !== id));
              const audit = readJSON(auditFile);
              audit.unshift({ id:`AUD${Date.now()}`, timestamp:new Date().toISOString(), action:'delete', roomId: id, before: existing });
              writeJSON(auditFile, audit);
              return send(res, 200, { ok:true });
            }
            if (req.method === 'POST' && pathname === '/api/rooms/revert') {
              if (!isManager(role)) return send(res, 403, { ok:false, error:'Unauthorized' });
              const { auditId } = await parseBody(req);
              const audit = readJSON(auditFile);
              const entry = audit.find(a=> a.id === auditId);
              if (!entry || !entry.before) return send(res, 400, { ok:false, error:'Invalid audit revert target' });
              const rooms = readJSON(roomsFile);
              const idx = rooms.findIndex(r=> r.id === entry.roomId);
              if (idx === -1) return send(res, 404, { ok:false, error:'Room not found' });
              rooms[idx] = { ...rooms[idx], ...entry.before };
              writeJSON(roomsFile, rooms);
              audit.unshift({ id:`AUD${Date.now()}`, timestamp:new Date().toISOString(), action:'revert', roomId: entry.roomId, before: entry.after, after: entry.before });
              writeJSON(auditFile, audit);
              return send(res, 200, { ok:true });
            }
            if (req.method === 'POST' && pathname === '/api/rooms/bulk/status') {
              if (!isManager(role)) return send(res, 403, { ok:false, error:'Unauthorized' });
              const { ids, status } = await parseBody(req);
              const rooms = readJSON(roomsFile);
              const next = rooms.map(r => ids.includes(r.id) ? { ...r, status } : r);
              writeJSON(roomsFile, next);
              const audit = readJSON(auditFile);
              ids.forEach(id => audit.unshift({ id:`AUD${Date.now()}_${id}`, timestamp:new Date().toISOString(), action:'update', roomId: id, message:'Status updated (bulk)' }));
              writeJSON(auditFile, audit);
              return send(res, 200, { ok:true });
            }
            if (req.method === 'POST' && pathname === '/api/rooms/bulk/delete') {
              if (!isManager(role)) return send(res, 403, { ok:false, error:'Unauthorized' });
              const { ids } = await parseBody(req);
              const rooms = readJSON(roomsFile);
              writeJSON(roomsFile, rooms.filter(r=> !ids.includes(r.id)));
              return send(res, 200, { ok:true });
            }
            if (req.method === 'POST' && pathname === '/api/rooms/bulk/floor') {
              if (!isManager(role)) return send(res, 403, { ok:false, error:'Unauthorized' });
              const { ids, floor } = await parseBody(req);
              const rooms = readJSON(roomsFile);
              const next = rooms.map(r => ids.includes(r.id) ? { ...r, floor: Number(floor) } : r);
              writeJSON(roomsFile, next);
              return send(res, 200, { ok:true });
            }
            if (req.method === 'POST' && pathname === '/api/rooms/bulk/rate') {
              if (!isManager(role)) return send(res, 403, { ok:false, error:'Unauthorized' });
              const { ids, rate } = await parseBody(req);
              const rooms = readJSON(roomsFile);
              const next = rooms.map(r => ids.includes(r.id) ? { ...r, rate: Number(rate) } : r);
              writeJSON(roomsFile, next);
              return send(res, 200, { ok:true });
            }
            return next();
          } catch (err) {
            return send(res, 500, { ok:false, error: String(err) });
          }
        });
      }
    },
    {
      name: 'rbac-mock',
      apply: 'serve',
      configureServer(server) {
        const send = (res: any, status: number, body: any) => {
          res.statusCode = status
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(body))
        }
        const parseBody = async (req: any) => {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          const raw = Buffer.concat(chunks).toString('utf-8')
          try { return raw ? JSON.parse(raw) : {} } catch { return {} }
        }
        server.middlewares.use(async (req, res, next) => {
          const pathname = url.parse(req.url).pathname || ''
          if (!pathname.startsWith('/api/rbac')) return next()
          try {
            // Provision permissions: deterministic success
            if (req.method === 'POST' && pathname === '/api/rbac/provision') {
              const body = await parseBody(req)
              return send(res, 200, {
                ok: true,
                applied: {
                  userId: body?.userId ?? 'MOCK_USER',
                  role: body?.role ?? 'viewer',
                  departments: body?.departments ?? [],
                },
                ts: new Date().toISOString(),
              })
            }
            // Optional revoke endpoint for completeness
            if (req.method === 'POST' && pathname === '/api/rbac/revoke') {
              const body = await parseBody(req)
              return send(res, 200, {
                ok: true,
                revoked: {
                  userId: body?.userId ?? 'MOCK_USER',
                  role: body?.role ?? 'viewer',
                },
                ts: new Date().toISOString(),
              })
            }
            return next()
          } catch (err) {
            return send(res, 500, { ok:false, error: String(err) })
          }
        })
      }
    },
    {
      name: 'env-inject-and-transform',
      config(config, { mode }) {
        const buildVersion = process.env.GITHUB_SHA?.slice(0,7) || Date.now().toString();
        const buildTime = new Date().toISOString();
        config.define = Object.assign({}, config.define, {
          __BUILD_VERSION__: JSON.stringify(buildVersion),
          __BUILD_TIME__: JSON.stringify(buildTime),
        });
      },
      generateBundle() {
        // Placeholder for target-specific transforms post-bundle
      }
    }
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: mode === 'production' ? 'hidden' : true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
    minify: 'esbuild',
    target: 'es2019',
  },
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  test: {
    environment: 'jsdom',
    setupFiles: [fileURLToPath(new URL('./vitest.setup.ts', import.meta.url))],
    globals: true,
    exclude: ['tests/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
}));
