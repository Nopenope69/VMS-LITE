let cameras = [];
let availableClips = [];
const animationFrames = {};
const cameraVideos = {};

// Procedural & Video File CCTV Scene Renderer for live canvas previews
function initCameraCanvas(canvas, camera) {
  const ctx = canvas.getContext('2d');
  let frame = 0;

  // Real video element for custom MP4 / WebM looping
  let videoEl = null;
  const isVideoFile = camera.mediaSource && (camera.mediaSource.endsWith('.mp4') || camera.mediaSource.endsWith('.webm'));

  if (isVideoFile && camera.mediaSource !== 'procedural-cctv') {
    if (!cameraVideos[camera.id] || cameraVideos[camera.id]._src !== camera.mediaSource) {
      const v = document.createElement('video');
      v.src = `/media/${encodeURIComponent(camera.mediaSource)}`;
      v.loop = true;
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      v._src = camera.mediaSource;
      v.play().catch(() => {});
      cameraVideos[camera.id] = v;
    }
    videoEl = cameraVideos[camera.id];
  }

  function render() {
    frame++;
    const width = canvas.width;
    const height = canvas.height;

    // 1. Draw Real Video Frame or Dark Surveillance Background
    if (videoEl && videoEl.readyState >= 2) {
      ctx.drawImage(videoEl, 0, 0, width, height);
    } else {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, width, height);
    }

    // 2. Scene-Specific Simulated Elements (only when no real video frame)
    if (!videoEl || videoEl.readyState < 2) {
    const ch = camera.channelNumber;
    const category = (camera.mediaSource || '').toLowerCase();

    if (category.includes('gate') || ch % 4 === 1) {
      // Security Gate Scene
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, height * 0.65, width, height * 0.35); // Road

      // Road markings
      ctx.strokeStyle = '#facc15';
      ctx.setLineDash([12, 12]);
      ctx.beginPath();
      ctx.moveTo(0, height * 0.82);
      ctx.lineTo(width, height * 0.82);
      ctx.stroke();
      ctx.setLineDash([]);

      // Security Booth
      ctx.fillStyle = '#334155';
      ctx.fillRect(width * 0.72, height * 0.42, 60, 70);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(width * 0.75, height * 0.46, 25, 20); // Window

      // Barrier Arm
      const barrierAngle = (camera.status === 'alarm') ? -0.7 : Math.sin(frame * 0.03) * 0.05;
      ctx.save();
      ctx.translate(width * 0.72, height * 0.65);
      ctx.rotate(barrierAngle);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-110, -5, 110, 8);
      ctx.restore();

      // Moving Vehicle
      const carX = ((frame * 2.2) % (width + 120)) - 60;
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(carX, height * 0.72, 70, 30);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(carX + 15, height * 0.65, 38, 16); // Cabin

      // Vehicle Bounding Box during alarm or motion
      if (camera.status === 'alarm' || (carX > width * 0.3 && carX < width * 0.6)) {
        ctx.strokeStyle = camera.status === 'alarm' ? '#ef4444' : '#eab308';
        ctx.lineWidth = 2;
        ctx.strokeRect(carX - 4, height * 0.63, 78, 44);
        ctx.fillStyle = camera.status === 'alarm' ? '#ef4444' : '#eab308';
        ctx.font = '10px monospace';
        ctx.fillText('VEHICLE: 98%', carX - 4, height * 0.60);
      }
    } else if (category.includes('warehouse') || ch % 4 === 2) {
      // Warehouse Loading Bay Scene
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, height * 0.75, width, height * 0.25);

      // Warehouse Racks
      ctx.fillStyle = '#475569';
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(30 + i * 75, height * 0.2, 55, height * 0.55);
        ctx.fillStyle = '#f97316';
        ctx.fillRect(35 + i * 75, height * 0.3, 45, 14); // Pallet
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(35 + i * 75, height * 0.48, 45, 14);
        ctx.fillStyle = '#475569';
      }

      // Moving Forklift
      const forkX = width * 0.5 + Math.sin(frame * 0.02) * 90;
      ctx.fillStyle = '#eab308';
      ctx.fillRect(forkX, height * 0.66, 45, 26);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(forkX + 38, height * 0.58, 4, 34); // Mast

      if (camera.status === 'alarm') {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.strokeRect(forkX - 4, height * 0.56, 54, 40);
        ctx.fillStyle = '#ef4444';
        ctx.font = '10px monospace';
        ctx.fillText('FORKLIFT: 95%', forkX - 4, height * 0.52);
      }
    } else if (category.includes('perimeter') || ch % 4 === 3) {
      // Perimeter Fence (Night IR Monochrome)
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, width, height);

      // Chainlink Fence
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, height * 0.3);
        ctx.lineTo(x + 12, height);
        ctx.moveTo(x + 12, height * 0.3);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // IR Patrol Beam
      const sweepX = (width * 0.5) + Math.sin(frame * 0.025) * (width * 0.35);
      const grad = ctx.createRadialGradient(sweepX, height * 0.6, 10, sweepX, height * 0.6, 90);
      grad.addColorStop(0, 'rgba(79, 195, 247, 0.25)');
      grad.addColorStop(1, 'rgba(79, 195, 247, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      if (camera.status === 'alarm') {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.strokeRect(sweepX - 20, height * 0.5, 40, 50);
        ctx.fillStyle = '#ef4444';
        ctx.font = '10px monospace';
        ctx.fillText('INTRUDER: 91%', sweepX - 20, height * 0.46);
      }
    } else {
      // Production Assembly Floor
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, height * 0.55, width, height * 0.16); // Conveyor

      // Moving packages
      for (let i = 0; i < 5; i++) {
        const pkgX = ((frame * 1.5 + i * 80) % (width + 60)) - 30;
        ctx.fillStyle = '#f97316';
        ctx.fillRect(pkgX, height * 0.52, 28, 20);
      }

      // Robotic arm
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = 5;
      const angle = Math.sin(frame * 0.04) * 0.4;
      ctx.beginPath();
      ctx.moveTo(width * 0.5, height * 0.25);
      ctx.lineTo(width * 0.5 + Math.cos(angle) * 50, height * 0.45);
      ctx.stroke();
    }
    }

    // 3. Scanline & CCTV Optical Noise
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    for (let y = 0; y < height; y += 4) {
      ctx.fillRect(0, y, width, 1.5);
    }

    // 4. Live CCTV OSD Clock
    const now = new Date();
    const ts = now.toISOString().replace('T', ' ').substring(0, 19) + '.' + String(now.getMilliseconds()).padStart(3, '0');
    ctx.fillStyle = '#4fc3f7';
    ctx.font = '11px monospace';
    ctx.fillText(`${camera.name.toUpperCase()} [REC]`, 10, 18);
    ctx.fillText(ts, width - 180, 18);

    // 5. Alarm flashing border
    if (camera.status === 'alarm') {
      ctx.strokeStyle = (frame % 20 < 10) ? '#ef4444' : 'transparent';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, width - 4, height - 4);
    }

    animationFrames[camera.id] = requestAnimationFrame(render);
  }

  render();
}

async function loadSimulatorData() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    cameras = data.cameras || [];
    availableClips = data.availableClips || [];

    document.getElementById('cameraCountSlider').value = data.cameraCount;
    document.getElementById('cameraCountLabel').innerText = `${data.cameraCount} Cameras`;

    renderCameras();
  } catch (err) {
    showToast('Failed to connect to CCTV Simulator server');
  }
}

function renderCameras() {
  const grid = document.getElementById('cameraGrid');
  grid.innerHTML = '';

  // Cancel previous canvas animations
  Object.values(animationFrames).forEach(cancelAnimationFrame);

  cameras.forEach((cam) => {
    const card = document.createElement('div');
    card.id = `card-${cam.id}`;
    card.className = `camera-card ${cam.status === 'alarm' ? 'alarm-active' : ''}`;

    const isAlarm = cam.status === 'alarm';

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">${cam.name}</div>
        <div class="badge ${isAlarm ? 'badge-red' : 'badge-green'}" id="badge-${cam.id}">
          ${isAlarm ? '● ALARM ACTIVE' : '● LIVE 25 FPS'}
        </div>
      </div>
      <div class="video-container">
        <canvas id="canvas-${cam.id}" width="340" height="190"></canvas>
        <div class="osd-overlay">
          <span>${cam.ip}:554</span>
          <span>ONVIF :${cam.onvifPort}</span>
        </div>
        <div class="osd-bottom">
          <span>${cam.mainResolution} @ 25 FPS</span>
          <span id="ptz-${cam.id}">P:${cam.ptz.pan}° T:${cam.ptz.tilt}° Z:${cam.ptz.zoom}x</span>
        </div>
      </div>
      <div class="card-body">
        <div class="field-group">
          <div class="field-label">RTSP Main Stream URL</div>
          <div class="rtsp-box" onclick="copyToClipboard('${cam.rtspUrlMain}')" title="Click to Copy RTSP URL">
            <span>${cam.rtspUrlMain}</span>
            <span>📋</span>
          </div>
        </div>

        <div class="field-group" style="background: rgba(255, 255, 255, 0.04); padding: 5px 8px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.08); font-size: 11px;">
          <div style="display: flex; justify-content: space-between; color: #94a3b8;">
            <span>User: <strong style="color: #38bdf8;">${cam.username}</strong></span>
            <span>Pass: <strong style="color: #38bdf8;">${cam.password}</strong></span>
            <span>ONVIF: <strong style="color: #38bdf8;">:${cam.onvifPort}</strong></span>
          </div>
        </div>

        <div class="field-group">
          <div class="field-label">Video Clip Source</div>
          <select onchange="updateVideoSource('${cam.id}', this.value)">
            ${availableClips.map((clip) => `
              <option value="${clip.filename}" ${cam.mediaSource === clip.filename ? 'selected' : ''}>
                ${clip.title}
              </option>
            `).join('')}
          </select>
        </div>

        <button class="btn btn-danger" onclick="triggerMotion('${cam.id}')" style="width: 100%; justify-content: center;">
          🚨 TRIGGER MOTION ALARM
        </button>
      </div>
    `;

    grid.appendChild(card);

    // Start simulated visual canvas
    const canvas = document.getElementById(`canvas-${cam.id}`);
    if (canvas) {
      initCameraCanvas(canvas, cam);
    }
  });
}

async function setCameraCount(count) {
  document.getElementById('cameraCountLabel').innerText = `${count} Cameras`;
  try {
    const res = await fetch('/api/scale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: Number(count) }),
    });
    const data = await res.json();
    cameras = data.cameras || [];
    renderCameras();
    showToast(`Scaled simulator to ${count} virtual cameras`);
  } catch {
    showToast('Failed to scale cameras');
  }
}

async function triggerMotion(camId) {
  try {
    const res = await fetch(`/api/motion/${camId}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      const card = document.getElementById(`card-${camId}`);
      if (card) card.classList.add('alarm-active');
      const badge = document.getElementById(`badge-${camId}`);
      if (badge) {
        badge.className = 'badge badge-red';
        badge.innerText = '● ALARM ACTIVE';
      }
      showToast(`🚨 Motion Alert Injected on ${camId} (Dispatched to VMS & NVRs)`);

      setTimeout(() => {
        if (card) card.classList.remove('alarm-active');
        if (badge) {
          badge.className = 'badge badge-green';
          badge.innerText = '● LIVE 25 FPS';
        }
      }, 8000);
    }
  } catch {
    showToast('Error triggering motion alarm');
  }
}

async function updateVideoSource(camId, source) {
  try {
    await fetch(`/api/cameras/${camId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaSource: source }),
    });
    // Immediately re-initialize canvas playback with the new video clip
    const cam = cameras.find((c) => c.id === camId);
    if (cam) {
      cam.mediaSource = source;
      if (cameraVideos[camId]) {
        delete cameraVideos[camId];
      }
      const canvas = document.getElementById(`canvas-${camId}`);
      if (canvas) {
        if (animationFrames[camId]) cancelAnimationFrame(animationFrames[camId]);
        initCameraCanvas(canvas, cam);
      }
    }
    showToast(`✓ Updated video source for ${camId}: ${source}`);
  } catch {
    showToast('Failed to update video source');
  }
}

async function handleClipFileUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  showToast(`Uploading ${file.name} to media folder...`);
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const base64Data = reader.result.split(',')[1];
      const res = await fetch('/api/upload-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, base64Data }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✓ Video "${file.name}" uploaded successfully! Now available in all camera dropdowns.`);
        await loadSimulatorData();
      } else {
        showToast(`Upload failed: ${data.error || 'Server error'}`);
      }
    } catch {
      showToast('Error uploading video clip');
    }
  };
  reader.readAsDataURL(file);
}

async function syncToBasicVms() {
  try {
    const res = await fetch('/api/sync-vms', { method: 'POST' });
    const data = await res.json();
    showToast(data.message || 'Auto-Synced cameras to Basic VMS!');
  } catch {
    showToast('Failed to auto-sync to Basic VMS');
  }
}

function exportCpPlus() {
  window.location.href = '/api/export/cpplus.csv';
  showToast('Downloading CP Plus NVR Batch CSV');
}

function exportHikvision() {
  window.location.href = '/api/export/hikvision.csv';
  showToast('Downloading Hikvision NVR Batch CSV');
}

function exportDahua() {
  window.location.href = '/api/export/dahua.csv';
  showToast('Downloading Dahua NVR Batch CSV');
}

function exportM3u() {
  window.location.href = '/api/export/playlist.m3u';
  showToast('Downloading RTSP M3U Playlist');
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
  showToast(`Copied to clipboard: ${text}`);
}

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerText = msg;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 4000);
}

// Initial boot
window.addEventListener('DOMContentLoaded', loadSimulatorData);
