import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { simulatorState } from './simulator-state.js';
import { mediaLibrary } from './media-library.js';
import { nvrExporter } from './nvr-exporter.js';
import { onvifResponder } from './onvif-responder.js';
import { rtspBridge } from './rtsp-server.js';
import { INDEX_HTML, STYLE_CSS, APP_JS } from './embedded-assets.js';

const getBaseDir = () => {
  const candidate1 = path.resolve(process.cwd(), 'tools', 'cctv-simulator');
  if (fs.existsSync(candidate1)) return candidate1;
  const execDir = path.dirname(process.execPath);
  const candidate2 = path.resolve(execDir, 'tools', 'cctv-simulator');
  if (fs.existsSync(candidate2)) return candidate2;
  if (fs.existsSync(path.resolve(execDir, 'public'))) return execDir;
  return process.cwd();
};

const BASE_DIR = getBaseDir();
const PUBLIC_DIR = path.resolve(BASE_DIR, 'public');

const DEFAULT_PORT = Number(process.env.SIMULATOR_PORT) || 8190;
const HOST = process.env.SIMULATOR_HOST || '127.0.0.1';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.csv': 'text/csv; charset=utf-8',
  '.m3u': 'audio/x-mpegurl; charset=utf-8',
};

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method?.toUpperCase() || 'GET';

  // Enable CORS for cross-VMS queries
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    // ----------------------------------------------------
    // REST API Endpoints
    // ----------------------------------------------------
    if (pathname === '/api/state' && method === 'GET') {
      const state = simulatorState.getState();
      const clips = mediaLibrary.getAvailableClips();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ...state, availableClips: clips }));
    }

    if (pathname === '/api/cameras' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(simulatorState.getCameras()));
    }

    if (pathname === '/api/scale' && method === 'POST') {
      const raw = await readBody(req);
      const { count } = JSON.parse(raw || '{}');
      const updated = simulatorState.setCameraCount(Number(count) || 16);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, count: updated.length, cameras: updated }));
    }

    if (pathname.startsWith('/api/cameras/') && method === 'PUT') {
      const camId = pathname.replace('/api/cameras/', '');
      const raw = await readBody(req);
      const updates = JSON.parse(raw || '{}');
      const updated = simulatorState.updateCamera(camId, updates);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: Boolean(updated), camera: updated }));
    }

    if (pathname.startsWith('/api/motion/') && method === 'POST') {
      const camId = pathname.replace('/api/motion/', '');
      const result = simulatorState.triggerMotion(camId);

      // Dispatch webhook to Basic VMS
      rtspBridge.dispatchMotionToVms(camId, simulatorState.getState().vmsApiUrl);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }

    // Upload custom MP4 video clip
    if (pathname === '/api/upload-clip' && method === 'POST') {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw || '{}');
      const filename = parsed.filename;
      const base64Data = parsed.base64Data;
      if (!filename || !base64Data) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing filename or base64Data' }));
      }
      const cleanName = path.basename(filename).replace(/[^a-zA-Z0-9_.-]/g, '_');
      const destDir = mediaLibrary.getPrimaryMediaDir();
      const destPath = path.resolve(destDir, cleanName);
      fs.writeFileSync(destPath, Buffer.from(base64Data, 'base64'));
      const clips = mediaLibrary.getAvailableClips();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, filename: cleanName, availableClips: clips }));
    }

    // Auto-Sync Cameras to Basic VMS
    if (pathname === '/api/sync-vms' && method === 'POST') {
      const cameras = simulatorState.getCameras();
      const vmsPayload = nvrExporter.generateBasicVmsJson(cameras, HOST);

      // Also persist to data/simulated-cameras.json in root if accessible
      try {
        const rootDataDir = path.resolve(__dirname, '..', '..', 'data');
        if (!fs.existsSync(rootDataDir)) fs.mkdirSync(rootDataDir, { recursive: true });
        fs.writeFileSync(
          path.resolve(rootDataDir, 'simulated-cameras.json'),
          JSON.stringify(vmsPayload, null, 2),
          'utf-8'
        );
      } catch {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        message: `Successfully synchronized ${cameras.length} virtual cameras to Basic VMS!`,
        count: cameras.length,
      }));
    }

    // Batch NVR Exports
    if (pathname === '/api/export/cpplus.csv') {
      const csv = nvrExporter.generateCpPlusCsv(simulatorState.getCameras(), HOST);
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="cpplus_cameras_batch.csv"',
      });
      return res.end(csv);
    }

    if (pathname === '/api/export/hikvision.csv') {
      const csv = nvrExporter.generateHikvisionCsv(simulatorState.getCameras(), HOST);
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="hikvision_cameras_batch.csv"',
      });
      return res.end(csv);
    }

    if (pathname === '/api/export/dahua.csv') {
      const csv = nvrExporter.generateDahuaCsv(simulatorState.getCameras(), HOST);
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="dahua_cameras_batch.csv"',
      });
      return res.end(csv);
    }

    if (pathname === '/api/export/playlist.m3u') {
      const m3u = nvrExporter.generateRtspM3u(simulatorState.getCameras(), HOST);
      res.writeHead(200, {
        'Content-Type': 'audio/x-mpegurl',
        'Content-Disposition': 'attachment; filename="cctv_streams.m3u"',
      });
      return res.end(m3u);
    }

    // ONVIF SOAP endpoint for NVRs
    if (pathname.includes('/onvif/') && method === 'POST') {
      const rawSoap = await readBody(req);
      const camId = pathname.split('/')[2] || 'cam-01';
      const xml = onvifResponder.handleSoapRequest(camId, rawSoap, HOST, 8554);
      res.writeHead(200, { 'Content-Type': 'application/soap+xml; charset=utf-8' });
      return res.end(xml);
    }

    // ----------------------------------------------------
    // Static Files (UI & Media) - Zero-Dependency Embedded Fallback
    // ----------------------------------------------------
    if (pathname === '/' || pathname === '/index.html') {
      const diskIndex = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(diskIndex) && fs.statSync(diskIndex).isFile()) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return fs.createReadStream(diskIndex).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(INDEX_HTML);
    }

    if (pathname === '/style.css') {
      const diskCss = path.join(PUBLIC_DIR, 'style.css');
      if (fs.existsSync(diskCss) && fs.statSync(diskCss).isFile()) {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        return fs.createReadStream(diskCss).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      return res.end(STYLE_CSS);
    }

    if (pathname === '/app.js') {
      const diskJs = path.join(PUBLIC_DIR, 'app.js');
      if (fs.existsSync(diskJs) && fs.statSync(diskJs).isFile()) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        return fs.createReadStream(diskJs).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      return res.end(APP_JS);
    }

    let filePath = path.join(PUBLIC_DIR, pathname);

    // Check if file is in media directory
    if (pathname.startsWith('/media/')) {
      const mediaFile = pathname.replace('/media/', '');
      const resolved = mediaLibrary.getMediaFilePath(mediaFile);
      filePath = resolved || path.resolve(BASE_DIR, 'media', mediaFile);
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const stat = fs.statSync(filePath);

      // Support Range requests for MP4 video looping
      const range = req.headers.range;
      if (range && ext === '.mp4') {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunksize = end - start + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
        });
        return fileStream.pipe(res);
      }

      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    // Fallback: 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Internal Server Error: ${err.message}`);
  }
});

let currentPort = DEFAULT_PORT;

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[!] Port ${currentPort} is currently occupied. Retrying on port ${currentPort + 1}...`);
    currentPort++;
    server.listen(currentPort, HOST);
  } else {
    console.error('Server error:', err);
  }
});

server.listen(currentPort, HOST, () => {
  console.log(`
===================================================================
 🎥 UNIVERSAL CCTV & NVR CAMERA SIMULATOR (PORTABLE UTILITY)
===================================================================
 [✓] Simulator Engine Online: ${simulatorState.getCameras().length} Virtual Cameras Active
 [✓] Standard RTSP Protocols: Port 8554 (Main 1080p & Sub 360p)
 [✓] Standard ONVIF Profile S: WS-Discovery (Port 3702) & SOAP (:8000)
 [✓] Web Control Dashboard: http://${HOST}:${currentPort}
 [✓] Universal NVR Exports: CP Plus, Hikvision, Dahua Batch CSVs

 Press Ctrl+C to stop the simulator.
===================================================================
`);

  // Start ONVIF WS-Discovery responder
  onvifResponder.start(HOST, currentPort);

  // Auto-open browser on launch if not in test/ci
  if (process.env.NODE_ENV !== 'test' && !process.env.CI) {
    const startUrl = `http://${HOST}:${currentPort}`;
    const startCmd = process.platform === 'win32' ? `start ${startUrl}` : process.platform === 'darwin' ? `open ${startUrl}` : `xdg-open ${startUrl}`;
    exec(startCmd, () => {});
  }
});

export { server };
