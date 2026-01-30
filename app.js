/* ============================================================
   RetroClip - Video Editor
   ============================================================ */

(function () {
  'use strict';

  // ──── State ────────────────────────────────────────────────
  const state = {
    videoLoaded: false,
    isPlaying: false,
    isExporting: false,

    filter: 'none',
    filterIntensity: 75,

    title: '',
    titleSize: 48,
    titleColor: '#ffffff',
    titleBg: true,
    titlePos: { x: 0.5, y: 0.88 }, // normalised 0-1

    timestamp: '',
    timestampSize: 28,
    timestampColor: '#ffaa00',
    timestampFormat: 'us',
    timestampBg: true,
    timestampPos: { x: 0.82, y: 0.92 },

    frameCount: 0,
    dragging: null, // 'title' | 'timestamp' | null
    dragOffset: { x: 0, y: 0 },
  };

  // ──── DOM refs ─────────────────────────────────────────────
  const $ = (s) => document.querySelector(s);
  const video = $('#sourceVideo');
  const canvas = $('#previewCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const dropZone = $('#dropZone');
  const canvasWrapper = $('#canvasWrapper');
  const fileInput = $('#fileInput');

  // playback
  const playBtn = $('#playBtn');
  const playIcon = $('#playIcon');
  const pauseIcon = $('#pauseIcon');
  const seekBar = $('#seekBar');
  const currentTimeEl = $('#currentTime');
  const totalTimeEl = $('#totalTime');
  const volumeBar = $('#volumeBar');

  // controls
  const titleInput = $('#titleInput');
  const titleSizeSlider = $('#titleSize');
  const titleSizeVal = $('#titleSizeVal');
  const titleColorInput = $('#titleColor');
  const titleBgCheck = $('#titleBg');

  const timestampInput = $('#timestampInput');
  const timestampSizeSlider = $('#timestampSize');
  const timestampSizeVal = $('#timestampSizeVal');
  const timestampColorInput = $('#timestampColor');
  const timestampFormatSelect = $('#timestampFormat');
  const timestampBgCheck = $('#timestampBg');

  const intensityRow = $('#filterIntensity');
  const intensitySlider = $('#intensitySlider');
  const intensityVal = $('#intensityVal');

  // export
  const exportBtn = $('#exportBtn');
  const exportInfo = $('#exportInfo');
  const progressBar = $('#progressBar');
  const progressText = $('#progressText');
  const cancelExportBtn = $('#cancelExport');

  // settings
  const settingsBtn = $('#settingsBtn');
  const settingsModal = $('#settingsModal');
  const closeSettingsBtn = $('#closeSettings');
  const cancelSettingsBtn = $('#cancelSettings');
  const saveSettingsBtn = $('#saveSettings');
  const googleApiKeyInput = $('#googleApiKey');
  const googleClientIdInput = $('#googleClientId');

  const notification = $('#notification');

  // pre-created helper canvases
  let scanlinePattern = null;
  let noiseCanvas = null;
  let noiseCtx = null;
  let grainCanvas = null;
  let grainCtx = null;
  let vignetteCanvas = null;
  let animationId = null;
  let exportCancelled = false;

  // keep track of text bounding boxes for hit-testing
  let titleBounds = null;
  let timestampBounds = null;

  // ──── Password Gate ─────────────────────────────────────────
  const PASSWORD_HASH = 'b4755ad194ef6ea14678443d8f68387cfc252a7e09532f9b71d2eb063189a8b2';

  async function sha256(str) {
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function setupLoginGate() {
    const loginScreen = document.getElementById('loginScreen');
    const app = document.getElementById('app');
    const form = document.getElementById('loginForm');
    const pwInput = document.getElementById('passwordInput');
    const errorMsg = document.getElementById('loginError');

    // Check if already authenticated this session
    if (sessionStorage.getItem('rc_auth') === '1') {
      loginScreen.hidden = true;
      app.hidden = false;
      init();
      return;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const hash = await sha256(pwInput.value);
      if (hash === PASSWORD_HASH) {
        sessionStorage.setItem('rc_auth', '1');
        loginScreen.hidden = true;
        app.hidden = false;
        init();
      } else {
        errorMsg.hidden = false;
        pwInput.value = '';
        pwInput.focus();
      }
    });
  }

  // ──── Init ─────────────────────────────────────────────────
  function init() {
    loadSettings();
    initEventListeners();
    initHelperCanvases();
  }

  function loadSettings() {
    const apiKey = localStorage.getItem('rc_googleApiKey');
    const clientId = localStorage.getItem('rc_googleClientId');
    if (apiKey) googleApiKeyInput.value = apiKey;
    if (clientId) googleClientIdInput.value = clientId;
  }

  // ──── Event Listeners ──────────────────────────────────────
  function initEventListeners() {
    // File upload
    $('#uploadBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) loadVideoFile(e.target.files[0]);
    });

    // Drag and drop
    canvasWrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    canvasWrapper.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    canvasWrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('video/')) {
        loadVideoFile(file);
      } else {
        notify('Please drop a video file.', 'error');
      }
    });

    // Google buttons
    $('#googleDriveBtn').addEventListener('click', () => openGooglePicker('drive'));
    $('#googlePhotosBtn').addEventListener('click', () => openGooglePicker('photos'));

    // Playback
    playBtn.addEventListener('click', togglePlay);
    seekBar.addEventListener('input', () => {
      if (!state.videoLoaded) return;
      video.currentTime = (seekBar.value / 1000) * video.duration;
    });
    volumeBar.addEventListener('input', () => {
      video.volume = volumeBar.value / 100;
    });
    video.addEventListener('timeupdate', updateTimeDisplay);
    video.addEventListener('ended', () => {
      state.isPlaying = false;
      updatePlayButton();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
    });

    // Title controls
    titleInput.addEventListener('input', () => { state.title = titleInput.value; });
    titleSizeSlider.addEventListener('input', () => {
      state.titleSize = parseInt(titleSizeSlider.value);
      titleSizeVal.textContent = state.titleSize + 'px';
    });
    titleColorInput.addEventListener('input', () => { state.titleColor = titleColorInput.value; });
    titleBgCheck.addEventListener('change', () => { state.titleBg = titleBgCheck.checked; });

    // Timestamp controls
    timestampInput.addEventListener('input', () => { state.timestamp = timestampInput.value; });
    timestampSizeSlider.addEventListener('input', () => {
      state.timestampSize = parseInt(timestampSizeSlider.value);
      timestampSizeVal.textContent = state.timestampSize + 'px';
    });
    timestampColorInput.addEventListener('input', () => { state.timestampColor = timestampColorInput.value; });
    timestampFormatSelect.addEventListener('change', () => { state.timestampFormat = timestampFormatSelect.value; });
    timestampBgCheck.addEventListener('change', () => { state.timestampBg = timestampBgCheck.checked; });

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.filter = btn.dataset.filter;
        intensityRow.style.display = state.filter === 'none' ? 'none' : 'flex';
      });
    });
    intensitySlider.addEventListener('input', () => {
      state.filterIntensity = parseInt(intensitySlider.value);
      intensityVal.textContent = state.filterIntensity + '%';
    });

    // Position presets
    setupPositionPresets('titlePositionPresets', 'title');
    setupPositionPresets('timestampPositionPresets', 'timestamp');

    // Canvas drag
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    canvas.addEventListener('mousemove', onCanvasMouseMove);
    canvas.addEventListener('mouseup', onCanvasMouseUp);
    canvas.addEventListener('mouseleave', onCanvasMouseUp);
    // Touch support
    canvas.addEventListener('touchstart', onCanvasTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onCanvasTouchMove, { passive: false });
    canvas.addEventListener('touchend', onCanvasMouseUp);

    // Export
    exportBtn.addEventListener('click', startExport);
    cancelExportBtn.addEventListener('click', () => { exportCancelled = true; });

    // Settings modal
    settingsBtn.addEventListener('click', () => { settingsModal.hidden = false; });
    closeSettingsBtn.addEventListener('click', () => { settingsModal.hidden = true; });
    cancelSettingsBtn.addEventListener('click', () => { settingsModal.hidden = true; });
    saveSettingsBtn.addEventListener('click', () => {
      localStorage.setItem('rc_googleApiKey', googleApiKeyInput.value.trim());
      localStorage.setItem('rc_googleClientId', googleClientIdInput.value.trim());
      settingsModal.hidden = true;
      notify('Settings saved.', 'success');
    });
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) settingsModal.hidden = true;
    });
  }

  function setupPositionPresets(containerId, target) {
    const container = document.getElementById(containerId);
    container.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const pos = getPresetPosition(btn.dataset.pos);
        if (target === 'title') {
          state.titlePos = pos;
        } else {
          state.timestampPos = pos;
        }
      });
    });
  }

  function getPresetPosition(preset) {
    const map = {
      'top-left': { x: 0.12, y: 0.08 },
      'top-center': { x: 0.5, y: 0.08 },
      'top-right': { x: 0.88, y: 0.08 },
      'center': { x: 0.5, y: 0.5 },
      'bottom-left': { x: 0.12, y: 0.92 },
      'bottom-center': { x: 0.5, y: 0.88 },
      'bottom-right': { x: 0.82, y: 0.92 },
    };
    return map[preset] || { x: 0.5, y: 0.5 };
  }

  // ──── Video Loading ────────────────────────────────────────
  function loadVideoFile(file) {
    const url = URL.createObjectURL(file);
    video.src = url;
    video.load();
    video.addEventListener('loadedmetadata', onVideoReady, { once: true });

    // Extract embedded creation date from the video file metadata
    extractVideoCreationDate(file).then((date) => {
      if (date) {
        timestampInput.value = toLocalDatetimeString(date);
        state.timestamp = timestampInput.value;
      }
    });
  }

  /**
   * Parse the MP4/MOV container to extract the creation date from the
   * moov > mvhd atom. The mvhd creation_time is seconds since 1904-01-01.
   * Falls back to file.lastModified if parsing fails.
   */
  async function extractVideoCreationDate(file) {
    try {
      const buffer = await file.arrayBuffer();
      const view = new DataView(buffer);
      const creationDate = findMvhdCreationDate(view, 0, buffer.byteLength);
      if (creationDate) return creationDate;
    } catch (e) {
      console.warn('Could not parse video metadata:', e);
    }
    // Fallback to file lastModified
    return new Date(file.lastModified);
  }

  function findMvhdCreationDate(view, start, end) {
    let offset = start;
    while (offset < end - 8) {
      let boxSize = view.getUint32(offset);
      const boxType = String.fromCharCode(
        view.getUint8(offset + 4),
        view.getUint8(offset + 5),
        view.getUint8(offset + 6),
        view.getUint8(offset + 7)
      );

      if (boxSize === 0) break; // box extends to end of file - skip

      // Handle 64-bit extended size
      let headerSize = 8;
      if (boxSize === 1) {
        if (offset + 16 > end) break;
        // Read 64-bit size (only use lower 32 bits for practical purposes)
        boxSize = view.getUint32(offset + 12); // low 32 bits
        headerSize = 16;
      }

      if (boxSize < headerSize || offset + boxSize > end) break;

      if (boxType === 'moov') {
        // Recurse into moov to find mvhd
        const result = findMvhdCreationDate(view, offset + headerSize, offset + boxSize);
        if (result) return result;
      }

      if (boxType === 'mvhd') {
        return parseMvhd(view, offset + headerSize, offset + boxSize);
      }

      offset += boxSize;
    }
    return null;
  }

  function parseMvhd(view, start, end) {
    if (start >= end) return null;
    const version = view.getUint8(start);
    // version 0: 4-byte times, version 1: 8-byte times
    let creationTime;
    if (version === 0) {
      if (start + 8 > end) return null;
      creationTime = view.getUint32(start + 4);
    } else {
      if (start + 12 > end) return null;
      // 64-bit creation time - use lower 32 bits (high bits via getUint32 at +4)
      const high = view.getUint32(start + 4);
      const low = view.getUint32(start + 8);
      creationTime = high * 0x100000000 + low;
    }

    if (creationTime === 0) return null;

    // MP4 epoch: 1904-01-01 00:00:00 UTC
    // Difference to Unix epoch: 2082844800 seconds
    const MAC_EPOCH_OFFSET = 2082844800;
    const unixSeconds = creationTime - MAC_EPOCH_OFFSET;

    // Sanity check: should be between 1970 and 2100
    if (unixSeconds < 0 || unixSeconds > 4102444800) return null;

    return new Date(unixSeconds * 1000);
  }

  function onVideoReady() {
    state.videoLoaded = true;

    // Size canvas to match video aspect ratio
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    canvas.width = vw;
    canvas.height = vh;
    canvas.style.display = 'block';
    dropZone.classList.add('hidden');

    // Enable controls
    playBtn.disabled = false;
    seekBar.disabled = false;
    exportBtn.disabled = false;
    totalTimeEl.textContent = formatTime(video.duration);

    // Draw first frame
    video.currentTime = 0;
    video.addEventListener('seeked', function drawFirst() {
      video.removeEventListener('seeked', drawFirst);
      startRenderLoop();
    }, { once: true });
  }

  // ──── Playback ─────────────────────────────────────────────
  function togglePlay() {
    if (!state.videoLoaded) return;
    if (state.isPlaying) {
      video.pause();
      state.isPlaying = false;
    } else {
      video.play();
      state.isPlaying = true;
    }
    updatePlayButton();
  }

  function updatePlayButton() {
    playIcon.style.display = state.isPlaying ? 'none' : 'block';
    pauseIcon.style.display = state.isPlaying ? 'block' : 'none';
  }

  function updateTimeDisplay() {
    if (!state.videoLoaded) return;
    currentTimeEl.textContent = formatTime(video.currentTime);
    if (!seekBar.matches(':active')) {
      seekBar.value = (video.currentTime / video.duration) * 1000;
    }
  }

  // ──── Render Loop ──────────────────────────────────────────
  function startRenderLoop() {
    if (animationId) cancelAnimationFrame(animationId);
    renderLoop();
  }

  function renderLoop() {
    renderFrame(ctx, canvas.width, canvas.height, false);
    state.frameCount++;
    animationId = requestAnimationFrame(renderLoop);
  }

  function renderFrame(targetCtx, w, h, isExport) {
    // Draw video frame
    targetCtx.drawImage(video, 0, 0, w, h);

    // Apply filter
    if (state.filter !== 'none') {
      applyFilter(targetCtx, w, h, isExport);
    }

    // Draw overlays
    drawTitle(targetCtx, w, h);
    drawTimestamp(targetCtx, w, h);
  }

  // ──── Filter Engine ────────────────────────────────────────
  function applyFilter(ctx, w, h, isExport) {
    const intensity = state.filterIntensity / 100;
    ctx.save();

    switch (state.filter) {
      case 'vhs': applyVHS(ctx, w, h, intensity); break;
      case 'super8': applySuper8(ctx, w, h, intensity); break;
      case 'camcorder': applyCamcorder(ctx, w, h, intensity); break;
      case '8mm': apply8mm(ctx, w, h, intensity); break;
      case '16mm': apply16mm(ctx, w, h, intensity); break;
    }

    ctx.restore();
  }

  // ---- VHS ----
  function applyVHS(ctx, w, h, intensity) {
    // Chromatic aberration
    const aberrationAmount = Math.max(1, Math.round(w * 0.003 * intensity));
    applyChromaAberration(ctx, w, h, aberrationAmount);

    // Slight desaturation
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = 0.2 * intensity;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    // Blue/purple tint
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.08 * intensity;
    ctx.fillStyle = '#1a0a3e';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    // Scanlines
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.15 * intensity;
    drawScanlines(ctx, w, h, 2);
    ctx.globalAlpha = 1;

    // Noise
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.12 * intensity;
    drawNoise(ctx, w, h);
    ctx.globalAlpha = 1;

    // Tracking line
    ctx.globalCompositeOperation = 'source-over';
    if (Math.random() < 0.04 * intensity) {
      drawTrackingGlitch(ctx, w, h, intensity);
    }
    drawTrackingLine(ctx, w, h, intensity);

    // Slight bottom bar noise
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.3 * intensity;
    const barH = h * 0.02;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, h - barH, w, barH);
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- Super 8 ----
  function applySuper8(ctx, w, h, intensity) {
    // Warm amber tint
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.18 * intensity;
    ctx.fillStyle = '#cc6600';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    // Slight overexposure
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.06 * intensity;
    ctx.fillStyle = '#ffddaa';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    // Film grain
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.2 * intensity;
    drawGrain(ctx, w, h, 3);
    ctx.globalAlpha = 1;

    // Vignette
    ctx.globalCompositeOperation = 'multiply';
    drawVignette(ctx, w, h, 0.4 * intensity);

    // Light leak
    if (state.frameCount % 120 < 30) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.12 * intensity * (1 - (state.frameCount % 120) / 30);
      const grd = ctx.createRadialGradient(w * 0.8, h * 0.2, 0, w * 0.8, h * 0.2, w * 0.5);
      grd.addColorStop(0, '#ff8800');
      grd.addColorStop(0.5, '#ff440044');
      grd.addColorStop(1, 'transparent');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // Scratches
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.25 * intensity;
    drawScratches(ctx, w, h);
    ctx.globalAlpha = 1;

    // Flicker
    ctx.globalCompositeOperation = 'source-over';
    const flicker = (Math.random() - 0.5) * 0.04 * intensity;
    if (flicker > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flicker})`;
    } else {
      ctx.fillStyle = `rgba(0,0,0,${-flicker})`;
    }
    ctx.fillRect(0, 0, w, h);

    // Rounded corners (film frame)
    ctx.globalCompositeOperation = 'destination-in';
    ctx.globalAlpha = 1;
    roundedRect(ctx, 0, 0, w, h, w * 0.015);

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // ---- Camcorder ----
  function applyCamcorder(ctx, w, h, intensity) {
    // Slightly washed out / lower contrast
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.06 * intensity;
    ctx.fillStyle = '#888888';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    // Slight green/cyan tint
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.05 * intensity;
    ctx.fillStyle = '#004422';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    // Subtle scanlines (interlacing)
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.06 * intensity;
    drawScanlines(ctx, w, h, 2);
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = 'source-over';

    // REC indicator
    drawRECIndicator(ctx, w, h, intensity);

    // Focus brackets
    drawFocusBrackets(ctx, w, h, intensity);

    // Battery icon
    drawBatteryIndicator(ctx, w, h, intensity);
  }

  // ---- 8mm Film ----
  function apply8mm(ctx, w, h, intensity) {
    // Sepia tone
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = 0.7 * intensity;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.3 * intensity;
    ctx.fillStyle = '#704214';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    // Heavy grain
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.3 * intensity;
    drawGrain(ctx, w, h, 4);
    ctx.globalAlpha = 1;

    // Strong vignette
    ctx.globalCompositeOperation = 'multiply';
    drawVignette(ctx, w, h, 0.55 * intensity);

    // Dust particles
    ctx.globalCompositeOperation = 'source-over';
    drawDust(ctx, w, h, intensity);

    // Scratches
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.3 * intensity;
    drawScratches(ctx, w, h);
    ctx.globalAlpha = 1;

    // Flicker (stronger)
    ctx.globalCompositeOperation = 'source-over';
    const flicker = (Math.random() - 0.5) * 0.08 * intensity;
    if (flicker > 0) {
      ctx.fillStyle = `rgba(255,255,200,${flicker})`;
    } else {
      ctx.fillStyle = `rgba(0,0,0,${-flicker})`;
    }
    ctx.fillRect(0, 0, w, h);

    // Rounded corners
    ctx.globalCompositeOperation = 'destination-in';
    ctx.globalAlpha = 1;
    roundedRect(ctx, 0, 0, w, h, w * 0.025);

    // Dark border
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.6 * intensity;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = w * 0.01;
    ctx.strokeRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  // ---- 16mm Film ----
  function apply16mm(ctx, w, h, intensity) {
    // Slight desaturation
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = 0.15 * intensity;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    // Cool blue tone
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.06 * intensity;
    ctx.fillStyle = '#1a2a44';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    // Moderate grain
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.14 * intensity;
    drawGrain(ctx, w, h, 2);
    ctx.globalAlpha = 1;

    // Mild vignette
    ctx.globalCompositeOperation = 'multiply';
    drawVignette(ctx, w, h, 0.25 * intensity);

    // Contrast boost
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.04 * intensity;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    // Occasional subtle scratch
    if (Math.random() < 0.3) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.15 * intensity;
      drawScratches(ctx, w, h);
      ctx.globalAlpha = 1;
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // ──── Filter Helper Effects ────────────────────────────────
  function applyChromaAberration(ctx, w, h, offset) {
    if (offset < 1) return;
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const copy = new Uint8ClampedArray(data);
    const rowBytes = w * 4;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * rowBytes + x * 4;
        // Shift red channel right
        const rx = Math.min(x + offset, w - 1);
        data[i] = copy[y * rowBytes + rx * 4];
        // Shift blue channel left
        const bx = Math.max(x - offset, 0);
        data[i + 2] = copy[y * rowBytes + bx * 4 + 2];
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function drawScanlines(ctx, w, h, gap) {
    ensureScanlinePattern(w, h, gap);
    ctx.drawImage(scanlinePattern, 0, 0, w, h);
  }

  function ensureScanlinePattern(w, h, gap) {
    if (scanlinePattern && scanlinePattern._w === w && scanlinePattern._h === h) return;
    scanlinePattern = document.createElement('canvas');
    scanlinePattern.width = w;
    scanlinePattern.height = h;
    scanlinePattern._w = w;
    scanlinePattern._h = h;
    const sctx = scanlinePattern.getContext('2d');
    sctx.fillStyle = '#fff';
    sctx.fillRect(0, 0, w, h);
    sctx.fillStyle = '#000';
    for (let y = 0; y < h; y += gap * 2) {
      sctx.fillRect(0, y, w, gap);
    }
  }

  function drawNoise(ctx, w, h) {
    // Use a lower-res noise texture scaled up for performance
    const scale = 4;
    const nw = Math.ceil(w / scale);
    const nh = Math.ceil(h / scale);
    if (!noiseCanvas || noiseCanvas.width !== nw) {
      noiseCanvas = document.createElement('canvas');
      noiseCanvas.width = nw;
      noiseCanvas.height = nh;
      noiseCtx = noiseCanvas.getContext('2d');
    }
    const imgData = noiseCtx.createImageData(nw, nh);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    noiseCtx.putImageData(imgData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(noiseCanvas, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  function drawGrain(ctx, w, h, grainSize) {
    const scale = grainSize * 2;
    const nw = Math.ceil(w / scale);
    const nh = Math.ceil(h / scale);
    if (!grainCanvas || grainCanvas.width !== nw) {
      grainCanvas = document.createElement('canvas');
      grainCanvas.width = nw;
      grainCanvas.height = nh;
      grainCtx = grainCanvas.getContext('2d');
    }
    const imgData = grainCtx.createImageData(nw, nh);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    grainCtx.putImageData(imgData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(grainCanvas, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  function drawVignette(ctx, w, h, strength) {
    const cx = w / 2, cy = h / 2;
    const r = Math.sqrt(cx * cx + cy * cy);
    const grd = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.5, '#ffffff');
    grd.addColorStop(1, `rgba(0,0,0,1)`);
    ctx.globalAlpha = strength;
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  function drawTrackingLine(ctx, w, h, intensity) {
    const y = ((state.frameCount * 1.5) % (h + 40)) - 20;
    ctx.globalAlpha = 0.15 * intensity;
    const grad = ctx.createLinearGradient(0, y - 6, 0, y + 6);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(0.3, '#ffffff');
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(0.7, '#ffffff');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - 6, w, 12);
    ctx.globalAlpha = 1;
  }

  function drawTrackingGlitch(ctx, w, h, intensity) {
    const gy = Math.random() * h;
    const gh = 4 + Math.random() * 20;
    const shift = (Math.random() - 0.5) * w * 0.1;
    try {
      const strip = ctx.getImageData(0, Math.max(0, Math.floor(gy)), w, Math.min(Math.ceil(gh), h - Math.floor(gy)));
      ctx.putImageData(strip, shift, Math.floor(gy));
    } catch (e) { /* ignore cross-origin */ }
  }

  function drawScratches(ctx, w, h) {
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
      if (Math.random() > 0.5) {
        const x = Math.random() * w;
        ctx.beginPath();
        ctx.moveTo(x + (Math.random() - 0.5) * 3, 0);
        ctx.lineTo(x + (Math.random() - 0.5) * 10, h);
        ctx.stroke();
      }
    }
  }

  function drawDust(ctx, w, h, intensity) {
    ctx.fillStyle = 'rgba(255,255,240,0.6)';
    const count = Math.floor(3 * intensity);
    for (let i = 0; i < count; i++) {
      if (Math.random() < 0.4) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        const r = 0.5 + Math.random() * 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawRECIndicator(ctx, w, h, intensity) {
    const size = Math.round(h * 0.025);
    const x = w * 0.05;
    const y = h * 0.06;
    const show = Math.floor(state.frameCount / 30) % 2 === 0;

    ctx.globalAlpha = 0.9 * intensity;
    // Red dot
    if (show) {
      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.arc(x, y, size * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // REC text
    ctx.font = `bold ${size}px ${getCSSVar('--font-mono', '"Courier New", monospace')}`;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText('REC', x + size * 0.7, y);

    // Timecode
    const tc = formatTimecode(video.currentTime);
    ctx.font = `${size * 0.8}px ${getCSSVar('--font-mono', '"Courier New", monospace')}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(tc, x, y + size * 1.5);
    ctx.globalAlpha = 1;
  }

  function drawFocusBrackets(ctx, w, h, intensity) {
    const cx = w / 2, cy = h / 2;
    const bw = w * 0.15, bh = h * 0.15;
    const len = Math.min(bw, bh) * 0.3;
    ctx.globalAlpha = 0.3 * intensity;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, w * 0.002);

    // Top-left
    ctx.beginPath();
    ctx.moveTo(cx - bw, cy - bh + len); ctx.lineTo(cx - bw, cy - bh); ctx.lineTo(cx - bw + len, cy - bh);
    ctx.stroke();
    // Top-right
    ctx.beginPath();
    ctx.moveTo(cx + bw - len, cy - bh); ctx.lineTo(cx + bw, cy - bh); ctx.lineTo(cx + bw, cy - bh + len);
    ctx.stroke();
    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(cx - bw, cy + bh - len); ctx.lineTo(cx - bw, cy + bh); ctx.lineTo(cx - bw + len, cy + bh);
    ctx.stroke();
    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(cx + bw - len, cy + bh); ctx.lineTo(cx + bw, cy + bh); ctx.lineTo(cx + bw, cy + bh - len);
    ctx.stroke();

    ctx.globalAlpha = 1;
  }

  function drawBatteryIndicator(ctx, w, h, intensity) {
    const bw = w * 0.04;
    const bh = h * 0.02;
    const x = w * 0.92;
    const y = h * 0.05;

    ctx.globalAlpha = 0.6 * intensity;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, w * 0.0015);
    ctx.strokeRect(x, y, bw, bh);

    // Terminal
    const tw = bw * 0.08;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + bw, y + bh * 0.25, tw, bh * 0.5);

    // Fill level
    const fill = 0.7;
    ctx.fillStyle = fill > 0.3 ? '#00ff00' : '#ff0000';
    ctx.fillRect(x + 1, y + 1, (bw - 2) * fill, bh - 2);

    ctx.globalAlpha = 1;
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
  }

  // ──── Text Overlays ────────────────────────────────────────
  function drawTitle(ctx, w, h) {
    if (!state.title) { titleBounds = null; return; }
    const fontSize = Math.round(state.titleSize * (w / 1920));
    const scaledFontSize = Math.max(10, fontSize);
    const x = state.titlePos.x * w;
    const y = state.titlePos.y * h;

    ctx.save();
    const fontFamily = getOverlayFont();
    ctx.font = `bold ${scaledFontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const metrics = ctx.measureText(state.title);
    const tw = metrics.width;
    const th = scaledFontSize;
    const pad = scaledFontSize * 0.35;

    titleBounds = {
      x: x - tw / 2 - pad,
      y: y - th / 2 - pad,
      w: tw + pad * 2,
      h: th + pad * 2,
    };

    // Background
    if (state.titleBg) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      roundedRect(ctx, titleBounds.x, titleBounds.y, titleBounds.w, titleBounds.h, pad * 0.5);
    }

    // Text shadow
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    ctx.fillStyle = state.titleColor;
    ctx.fillText(state.title, x, y);
    ctx.restore();
  }

  function drawTimestamp(ctx, w, h) {
    if (!state.timestamp) { timestampBounds = null; return; }
    const fontSize = Math.round(state.timestampSize * (w / 1920));
    const scaledFontSize = Math.max(8, fontSize);
    const x = state.timestampPos.x * w;
    const y = state.timestampPos.y * h;

    ctx.save();
    const formatted = formatTimestampDisplay(state.timestamp, state.timestampFormat);
    const fontFamily = getTimestampFont();

    ctx.font = `${scaledFontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const metrics = ctx.measureText(formatted);
    const tw = metrics.width;
    const th = scaledFontSize;
    const pad = scaledFontSize * 0.3;

    timestampBounds = {
      x: x - tw / 2 - pad,
      y: y - th / 2 - pad,
      w: tw + pad * 2,
      h: th + pad * 2,
    };

    // Background
    if (state.timestampBg) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      roundedRect(ctx, timestampBounds.x, timestampBounds.y, timestampBounds.w, timestampBounds.h, pad * 0.4);
    }

    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    ctx.fillStyle = state.timestampColor;
    ctx.fillText(formatted, x, y);
    ctx.restore();
  }

  function getOverlayFont() {
    if (state.filter === 'vhs' || state.filter === 'camcorder') {
      return '"Courier New", "Lucida Console", monospace';
    }
    return 'system-ui, -apple-system, "Segoe UI", sans-serif';
  }

  function getTimestampFont() {
    return '"Courier New", "Lucida Console", monospace';
  }

  function formatTimestampDisplay(isoStr, format) {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;

    const pad = (n) => String(n).padStart(2, '0');
    const M = pad(d.getMonth() + 1);
    const D = pad(d.getDate());
    const Y = d.getFullYear();
    const h = d.getHours();
    const m = pad(d.getMinutes());
    const s = pad(d.getSeconds());

    switch (format) {
      case 'us': {
        const h12 = h % 12 || 12;
        const ampm = h >= 12 ? 'PM' : 'AM';
        return `${M}/${D}/${Y}  ${h12}:${m} ${ampm}`;
      }
      case 'eu':
        return `${D}.${M}.${Y}  ${pad(h)}:${m}`;
      case 'iso':
        return `${Y}-${M}-${D}  ${pad(h)}:${m}:${s}`;
      case 'date-only':
        return `${M}/${D}/${Y}`;
      case 'time-only': {
        const h12 = h % 12 || 12;
        const ampm = h >= 12 ? 'PM' : 'AM';
        return `${h12}:${m}:${s} ${ampm}`;
      }
      default:
        return isoStr;
    }
  }

  // ──── Canvas Drag ──────────────────────────────────────────
  function canvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function hitTest(px, py, bounds) {
    if (!bounds) return false;
    return px >= bounds.x && px <= bounds.x + bounds.w &&
           py >= bounds.y && py <= bounds.y + bounds.h;
  }

  function onCanvasMouseDown(e) {
    if (!state.videoLoaded) return;
    const { x, y } = canvasCoords(e);
    if (hitTest(x, y, titleBounds)) {
      state.dragging = 'title';
      state.dragOffset = { x: x - state.titlePos.x * canvas.width, y: y - state.titlePos.y * canvas.height };
      canvas.classList.add('dragging');
    } else if (hitTest(x, y, timestampBounds)) {
      state.dragging = 'timestamp';
      state.dragOffset = { x: x - state.timestampPos.x * canvas.width, y: y - state.timestampPos.y * canvas.height };
      canvas.classList.add('dragging');
    }
  }

  function onCanvasMouseMove(e) {
    if (!state.videoLoaded) return;
    const { x, y } = canvasCoords(e);

    if (state.dragging) {
      const nx = (x - state.dragOffset.x) / canvas.width;
      const ny = (y - state.dragOffset.y) / canvas.height;
      const clamped = { x: Math.max(0.05, Math.min(0.95, nx)), y: Math.max(0.05, Math.min(0.95, ny)) };
      if (state.dragging === 'title') state.titlePos = clamped;
      else state.timestampPos = clamped;
    } else {
      // Hover cursor
      if (hitTest(x, y, titleBounds) || hitTest(x, y, timestampBounds)) {
        canvas.classList.add('hovering-text');
      } else {
        canvas.classList.remove('hovering-text');
      }
    }
  }

  function onCanvasMouseUp() {
    state.dragging = null;
    canvas.classList.remove('dragging');
  }

  function onCanvasTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    onCanvasMouseDown({ clientX: touch.clientX, clientY: touch.clientY });
  }

  function onCanvasTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    onCanvasMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
  }

  // ──── Export ───────────────────────────────────────────────
  async function startExport() {
    if (state.isExporting || !state.videoLoaded) return;
    state.isExporting = true;
    exportCancelled = false;
    exportBtn.disabled = true;
    exportInfo.hidden = false;
    progressBar.style.width = '0%';
    progressText.textContent = 'Preparing...';

    try {
      // Create an offscreen canvas at full resolution
      const ow = video.videoWidth;
      const oh = video.videoHeight;
      const offCanvas = document.createElement('canvas');
      offCanvas.width = ow;
      offCanvas.height = oh;
      const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

      // Set up MediaRecorder on the canvas stream
      const fps = 30;
      const stream = offCanvas.captureStream(fps);

      // Add audio track from the video
      let audioCtxNode = null;
      let audioSource = null;
      let audioDest = null;
      try {
        const audioCtx = new AudioContext();
        audioSource = audioCtx.createMediaElementSource(video);
        audioDest = audioCtx.createMediaStreamDestination();
        audioSource.connect(audioDest);
        audioSource.connect(audioCtx.destination);
        audioDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
        audioCtxNode = audioCtx;
      } catch (e) {
        console.warn('Could not capture audio:', e);
      }

      // Determine best codec
      const mimeType = getRecordingMimeType();
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 8000000,
      });

      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const recordingDone = new Promise((resolve) => {
        recorder.onstop = () => resolve();
      });

      recorder.start(100);

      // Play video from the beginning and render each frame
      video.currentTime = 0;
      await new Promise((r) => { video.addEventListener('seeked', r, { once: true }); });
      video.play();
      state.isPlaying = true;
      updatePlayButton();

      // Render loop for export
      const duration = video.duration;
      const exportRender = () => {
        if (exportCancelled) {
          recorder.stop();
          video.pause();
          return;
        }
        renderFrame(offCtx, ow, oh, true);
        const progress = Math.min(100, (video.currentTime / duration) * 100);
        progressBar.style.width = progress + '%';
        progressText.textContent = `Recording... ${Math.round(progress)}%`;

        if (video.currentTime < duration && !video.ended) {
          requestAnimationFrame(exportRender);
        } else {
          // Delay slightly to capture final frame
          setTimeout(() => {
            recorder.stop();
            video.pause();
            state.isPlaying = false;
            updatePlayButton();
          }, 200);
        }
      };
      requestAnimationFrame(exportRender);

      await recordingDone;

      if (exportCancelled) {
        notify('Export cancelled.', 'warning');
        resetExportUI();
        // Reconnect audio
        if (audioSource && audioCtxNode) {
          try { audioSource.disconnect(); } catch (e) {}
        }
        return;
      }

      progressText.textContent = 'Processing...';
      progressBar.style.width = '100%';

      const recordedBlob = new Blob(chunks, { type: mimeType });

      // Try to convert to MP4 using FFmpeg.wasm
      let finalBlob;
      try {
        finalBlob = await convertToMP4(recordedBlob);
      } catch (e) {
        console.warn('FFmpeg conversion failed, using original format:', e);
        finalBlob = recordedBlob;
      }

      // Download
      downloadBlob(finalBlob, 'retroclip-export.mp4');
      notify('Export complete! File downloaded.', 'success');

      // Cleanup audio
      if (audioSource && audioCtxNode) {
        try { audioSource.disconnect(); } catch (e) {}
      }
    } catch (err) {
      console.error('Export error:', err);
      notify('Export failed: ' + err.message, 'error');
    }

    resetExportUI();
  }

  function getRecordingMimeType() {
    const types = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return 'video/webm';
  }

  async function convertToMP4(webmBlob) {
    // Check if FFmpeg.wasm is available
    if (typeof FFmpegWASM === 'undefined' || typeof FFmpegUtil === 'undefined') {
      throw new Error('FFmpeg.wasm not loaded');
    }

    progressText.textContent = 'Loading FFmpeg...';

    const { FFmpeg } = FFmpegWASM;
    const { fetchFile, toBlobURL } = FFmpegUtil;

    const ffmpeg = new FFmpeg();

    ffmpeg.on('progress', ({ progress }) => {
      const pct = Math.round(progress * 100);
      progressBar.style.width = pct + '%';
      progressText.textContent = `Converting to MP4... ${pct}%`;
    });

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    await ffmpeg.writeFile('input.webm', await fetchFile(webmBlob));
    await ffmpeg.exec([
      '-i', 'input.webm',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      'output.mp4',
    ]);

    const data = await ffmpeg.readFile('output.mp4');
    return new Blob([data.buffer], { type: 'video/mp4' });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function resetExportUI() {
    state.isExporting = false;
    exportBtn.disabled = false;
    exportInfo.hidden = true;
  }

  // ──── Google Picker Integration ────────────────────────────
  let googleApiLoaded = false;
  let googleAuthToken = null;

  async function openGooglePicker(type) {
    const apiKey = localStorage.getItem('rc_googleApiKey');
    const clientId = localStorage.getItem('rc_googleClientId');

    if (!apiKey || !clientId) {
      settingsModal.hidden = false;
      notify('Please configure Google API credentials first.', 'warning');
      return;
    }

    try {
      if (!googleApiLoaded) {
        await loadGoogleScripts();
        googleApiLoaded = true;
      }

      if (!googleAuthToken) {
        googleAuthToken = await authenticateGoogle(clientId);
      }

      showPicker(apiKey, googleAuthToken, type);
    } catch (err) {
      console.error('Google Picker error:', err);
      notify('Google API error: ' + err.message, 'error');
    }
  }

  function loadGoogleScripts() {
    return new Promise((resolve, reject) => {
      // Load GAPI
      const s1 = document.createElement('script');
      s1.src = 'https://apis.google.com/js/api.js';
      s1.onload = () => {
        // Load GIS (Google Identity Services)
        const s2 = document.createElement('script');
        s2.src = 'https://accounts.google.com/gsi/client';
        s2.onload = resolve;
        s2.onerror = reject;
        document.body.appendChild(s2);
      };
      s1.onerror = reject;
      document.body.appendChild(s1);
    });
  }

  function authenticateGoogle(clientId) {
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (response) => {
          if (response.error) reject(new Error(response.error));
          else resolve(response.access_token);
        },
      });
      client.requestAccessToken();
    });
  }

  function showPicker(apiKey, token, type) {
    gapi.load('picker', () => {
      let view;
      if (type === 'photos') {
        view = new google.picker.DocsView(google.picker.ViewId.DOCS);
        view.setMimeTypes('video/mp4,video/quicktime,video/x-msvideo,video/webm,video/mpeg');
        view.setQuery('type:video');
      } else {
        view = new google.picker.DocsView(google.picker.ViewId.DOCS);
        view.setMimeTypes('video/mp4,video/quicktime,video/x-msvideo,video/webm,video/mpeg,video/3gpp,video/x-matroska');
      }
      view.setIncludeFolders(true);

      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(apiKey)
        .setCallback((data) => onPickerCallback(data, token))
        .setTitle('Select a video')
        .build();
      picker.setVisible(true);
    });
  }

  async function onPickerCallback(data, token) {
    if (data.action !== google.picker.Action.PICKED) return;
    const fileId = data.docs[0].id;
    const fileName = data.docs[0].name;

    notify(`Loading "${fileName}" from Google...`, 'success');

    try {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: blob.type });
      loadVideoFile(file);
    } catch (err) {
      notify('Failed to download file: ' + err.message, 'error');
    }
  }

  // ──── Utilities ────────────────────────────────────────────
  function initHelperCanvases() {
    noiseCanvas = document.createElement('canvas');
    noiseCtx = noiseCanvas.getContext('2d');
    grainCanvas = document.createElement('canvas');
    grainCtx = grainCanvas.getContext('2d');
  }

  function formatTime(sec) {
    if (!isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function formatTimecode(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const f = Math.floor((sec % 1) * 30);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }

  function toLocalDatetimeString(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function getCSSVar(name, fallback) {
    return fallback;
  }

  let notificationTimeout = null;
  function notify(message, type = '') {
    notification.textContent = message;
    notification.className = 'notification' + (type ? ' ' + type : '');
    notification.hidden = false;
    clearTimeout(notificationTimeout);
    notificationTimeout = setTimeout(() => { notification.hidden = true; }, 4000);
  }

  // ──── Bootstrap ────────────────────────────────────────────
  setupLoginGate();
})();
