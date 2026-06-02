// ---- state ------------------------------------------------------------------
let satellites = [];
let animFrac   = 0;       // [0, 1] progress through reference period
let isPlaying  = false;
let animTimer  = null;
let lastAnimMs = null;
let viewMode   = 1;       // 1 or 2 panels

// Defaults pre-loaded on start
const EXAMPLE_TLE_NAME = 'ISS (ZARYA)';
const EXAMPLE_TLE_L1   = '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9993';
const EXAMPLE_TLE_L2   = '2 25544  51.6400 337.6182 0004534  44.7272  48.3982 15.50000000408539';

// ---- init -------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  _initTabs();
  _initTimeControls();

  // Pre-fill TLE fields with ISS example
  document.getElementById('tle-name').value  = EXAMPLE_TLE_NAME;
  document.getElementById('tle-line1').value = EXAMPLE_TLE_L1;
  document.getElementById('tle-line2').value = EXAMPLE_TLE_L2;

  // Load ISS by default
  _addSatFromTLE();

  setViewMode(1);
  _renderAll();
});

// ---- tab switching ----------------------------------------------------------
function _initTabs() {
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.tabs');
      group.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const panel = btn.dataset.tab;
      document.getElementById(`tab-tle`).classList.add('hidden');
      document.getElementById(`tab-elements`).classList.add('hidden');
      document.getElementById(`tab-${panel}`).classList.remove('hidden');
    });
  });

  document.getElementById('add-sat-btn').addEventListener('click', () => {
    const activeTab = document.querySelector('.tab-btn[data-tab].active')?.dataset.tab || 'tle';
    if (activeTab === 'tle') _addSatFromTLE();
    else _addSatFromElements();
  });
}

// ---- satellite management ---------------------------------------------------
function _addSatFromTLE() {
  const name  = document.getElementById('tle-name').value.trim();
  const line1 = document.getElementById('tle-line1').value.trim();
  const line2 = document.getElementById('tle-line2').value.trim();
  if (!line1 || !line2) { alert('TLEの Line 1 と Line 2 を入力してください。'); return; }
  try {
    const sat = parseTLE(name, line1, line2);
    _registerSat(sat);
  } catch (e) {
    alert('TLE解析エラー: ' + e.message);
  }
}

function _addSatFromElements() {
  const get = id => document.getElementById(id).value;
  const params = {
    name: get('el-name'), body: get('el-body'),
    a: get('el-a'), e: get('el-e'), i: get('el-i'),
    raan: get('el-raan'), argp: get('el-argp'), M0: get('el-M'),
  };
  if (!params.a || !params.e) { alert('少なくとも a (半長径) と e (離心率) を入力してください。'); return; }
  try {
    const sat = parseElements(params);
    _registerSat(sat);
  } catch (e) {
    alert('軌道要素エラー: ' + e.message);
  }
}

function _registerSat(sat) {
  // Assign unique name if duplicate
  const base = sat.name;
  let name = base, k = 2;
  while (satellites.some(s => s.name === name)) name = `${base} (${k++})`;
  sat.name = name;
  satellites.push(sat);
  _updateSatList();
  _resetAnim();
  _renderAll();
}

function _removeSat(idx) {
  satellites.splice(idx, 1);
  _updateSatList();
  _resetAnim();
  _renderAll();
}

function _updateSatList() {
  const ul = document.getElementById('sat-list');
  ul.innerHTML = '';
  satellites.forEach((sat, idx) => {
    const color = SAT_COLORS[idx % SAT_COLORS.length];
    const div = document.createElement('div');
    div.className = 'sat-item' + (idx === 0 ? ' sat-ref' : '');
    div.innerHTML = `
      <span class="sat-color" style="background:${color}"></span>
      <span class="sat-name">${sat.name}</span>
      <span class="sat-badge">${sat.body === 'moon' ? '月' : '地球'}</span>
      ${idx === 0 ? '<span class="sat-ref-label">REF</span>' : ''}
      <button class="sat-remove" onclick="_removeSat(${idx})">×</button>
    `;
    ul.appendChild(div);
  });
}

// ---- time controls ----------------------------------------------------------
function _initTimeControls() {
  const slider = document.getElementById('time-slider');
  slider.addEventListener('input', () => {
    animFrac = parseInt(slider.value) / 1000;
    _updateTimeDisplay();
    _renderAll();
  });

  document.getElementById('btn-play').addEventListener('click', () => {
    if (isPlaying) _stopAnim();
    else _startAnim();
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    _stopAnim();
    animFrac = 0;
    document.getElementById('time-slider').value = 0;
    _updateTimeDisplay();
    _renderAll();
  });
}

function _startAnim() {
  if (isPlaying || satellites.length === 0) return;
  isPlaying = true;
  lastAnimMs = null;
  document.getElementById('btn-play').textContent = '⏸ 一時停止';
  animTimer = setInterval(_animStep, 80); // ~12 fps
}

function _stopAnim() {
  isPlaying = false;
  if (animTimer) { clearInterval(animTimer); animTimer = null; }
  document.getElementById('btn-play').textContent = '▶ 再生';
}

function _animStep() {
  const now   = Date.now();
  const dtMs  = lastAnimMs ? now - lastAnimMs : 80;
  lastAnimMs  = now;
  const speed = parseFloat(document.getElementById('speed-select').value) || 1000;
  const T_ref = satellites[0]?.period || 5400;
  animFrac = (animFrac + (dtMs / 1000) * speed / T_ref) % 1;
  document.getElementById('time-slider').value = Math.round(animFrac * 1000);
  _updateTimeDisplay();
  _renderAll();
}

function _resetAnim() {
  _stopAnim();
  animFrac = 0;
  document.getElementById('time-slider').value = 0;
  _updateTimeDisplay();
}

function _updateTimeDisplay() {
  if (satellites.length === 0) {
    document.getElementById('time-display').textContent = '—';
    return;
  }
  const T = satellites[0].period;
  const t = animFrac * T;
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  const pct = (animFrac * 100).toFixed(1);
  document.getElementById('time-display').textContent =
    `${m}分 ${String(s).padStart(2,'0')}秒  (${pct}%)`;
}

// ---- view mode --------------------------------------------------------------
function setViewMode(n) {
  viewMode = n;
  document.getElementById('view-1').classList.toggle('active', n === 1);
  document.getElementById('view-2').classList.toggle('active', n === 2);
  document.getElementById('panel-1').classList.toggle('hidden', n === 1);
  document.getElementById('panels-wrap').classList.toggle('two-up', n === 2);

  // Allow Leaflet to recalculate size
  setTimeout(() => { invalidateLeaflet(0); invalidateLeaflet(1); }, 100);
  _renderAll();
}

// ---- frame change -----------------------------------------------------------
function onFrameChange(idx) {
  _renderPanel(idx);
  setTimeout(() => invalidateLeaflet(idx), 100);
}

// ---- rendering --------------------------------------------------------------
function _renderAll() {
  _renderPanel(0);
  if (viewMode === 2) _renderPanel(1);
}

function _renderPanel(idx) {
  const frame = document.getElementById(`frame-${idx}`)?.value;
  if (!frame) return;
  renderPanel(idx, frame, satellites, animFrac);
}

// Expose for inline onclick (panel-header selects)
window.setViewMode = setViewMode;
window.onFrameChange = onFrameChange;
window._removeSat = _removeSat;
