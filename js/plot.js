const SAT_COLORS = [
  '#00d4ff', '#ff6b35', '#7bc67e', '#ffd700',
  '#c77dff', '#ff85c8', '#4ecdc4', '#ff9f1c',
];

const FRAME_LABELS = {
  eci:         'ECI  地心慣性座標系',
  ecef:        'ECEF  地球固定座標系',
  rtn:         'RTN / LVLH',
  groundtrack: '地上トラック',
  lci:         '月慣性座標系 (LCI)',
  lcf:         '月固定座標系 (LCF)',
};

// Track which divs are initialised
const _plotInited  = {};
const _leafletMaps = {};
const _leafletLayers = {};  // panelIdx → { tracks, markers }

// ---- sphere surface for Plotly -----------------------------------------------
function _sphereTrace(radius, color, nLat = 18, nLon = 24) {
  const x = [], y = [], z = [];
  for (let a = 0; a <= nLat; a++) {
    const lat = -Math.PI/2 + Math.PI * a / nLat;
    const row = { x:[], y:[], z:[] };
    for (let b = 0; b <= nLon; b++) {
      const lon = 2 * Math.PI * b / nLon;
      const r = radius / 1000; // m → km
      row.x.push(r * Math.cos(lat) * Math.cos(lon));
      row.y.push(r * Math.cos(lat) * Math.sin(lon));
      row.z.push(r * Math.sin(lat));
    }
    x.push(row.x); y.push(row.y); z.push(row.z);
  }
  return {
    type: 'surface', x, y, z,
    colorscale: [[0, color], [1, color]],
    showscale: false, opacity: 0.55,
    lighting: { ambient: 0.9, diffuse: 0.5 },
    hoverinfo: 'skip',
  };
}

// ---- 3-D Plotly panel --------------------------------------------------------
function render3D(panelIdx, frame, satellites, frac) {
  const plotId = `plotly-${panelIdx}`;
  const leafId = `leaflet-${panelIdx}`;
  document.getElementById(plotId).style.display = '';
  document.getElementById(leafId).style.display = 'none';

  const isLunar  = frame === 'lci' || frame === 'lcf';
  const isRTN    = frame === 'rtn';
  const R_body   = isLunar ? C.R_MOON : C.R_EARTH;
  const bodyColor = isLunar ? '#9a9a9a' : '#1a5f8a';

  const sats = isLunar
    ? satellites.filter(s => s.body === 'moon')
    : satellites.filter(s => s.body === 'earth');

  if (sats.length === 0) {
    const msg = isLunar
      ? '月衛星が登録されていません。\n「軌道要素」タブで中心天体＝月を選択してください。'
      : '地球衛星が登録されていません。';
    _showMessage(plotId, msg);
    return;
  }
  _clearMessage(plotId);

  const refSat = sats[0];
  const t0 = refSat.epochJ2000;
  const tCur = t0 + frac * refSat.period;

  const traces = [];
  traces.push(_sphereTrace(R_body, bodyColor));

  sats.forEach((sat, idx) => {
    const color = SAT_COLORS[idx % SAT_COLORS.length];
    const { positions, velocities, times } = orbitTrace(sat, t0);

    // Reference satellite state at each trace time (needed for RTN)
    const refStates = isRTN
      ? times.map(t => propagate(refSat, t))
      : null;

    const xs = [], ys = [], zs = [];
    positions.forEach((pos, i) => {
      const refSt = isRTN ? refStates[i] : null;
      const p = transformPoint(pos, velocities[i], frame, times[i],
                               refSt || { pos, vel: velocities[i] });
      xs.push(p[0] / 1000); ys.push(p[1] / 1000); zs.push(p[2] / 1000);
    });

    traces.push({
      type: 'scatter3d', mode: 'lines',
      x: xs, y: ys, z: zs,
      line: { color, width: 2 },
      name: sat.name,
    });

    // Current-position marker
    const { pos: cp, vel: cv } = propagate(sat, tCur);
    const refCur = isRTN ? propagate(refSat, tCur) : { pos: cp, vel: cv };
    const mp = transformPoint(cp, cv, frame, tCur, refCur);
    traces.push({
      type: 'scatter3d', mode: 'markers',
      x: [mp[0]/1000], y: [mp[1]/1000], z: [mp[2]/1000],
      marker: { color, size: 7, symbol: 'circle',
                line: { color: '#fff', width: 1 } },
      name: sat.name + '（現在）',
      showlegend: false,
    });
  });

  // RTN: draw reference satellite at origin explicitly
  if (isRTN) {
    traces.push({
      type: 'scatter3d', mode: 'markers',
      x:[0], y:[0], z:[0],
      marker: { color: SAT_COLORS[0], size: 10, symbol: 'diamond',
                line: { color: '#fff', width: 1 } },
      name: refSat.name + '（基準）',
      showlegend: false,
    });
  }

  const axisOpts = {
    color: '#aaa', gridcolor: '#333', zerolinecolor: '#666',
    tickfont: { color: '#aaa', size: 10 },
  };

  const layout = {
    paper_bgcolor: '#0a0a14',
    title: { text: FRAME_LABELS[frame],
             font: { color: '#e0e0e0', size: 12 } },
    scene: {
      xaxis: { ...axisOpts, title: { text: 'X (km)', font:{ color:'#aaa',size:10 } } },
      yaxis: { ...axisOpts, title: { text: 'Y (km)', font:{ color:'#aaa',size:10 } } },
      zaxis: { ...axisOpts, title: { text: 'Z (km)', font:{ color:'#aaa',size:10 } } },
      bgcolor: '#0d0d1a',
      aspectmode: 'cube',
    },
    legend: { font: { color: '#ccc', size: 10 },
              bgcolor: 'rgba(0,0,0,0.55)',
              x: 0, y: 1 },
    margin: { l: 0, r: 0, t: 30, b: 0 },
  };

  if (_plotInited[plotId]) {
    Plotly.react(plotId, traces, layout);
  } else {
    Plotly.newPlot(plotId, traces, layout, { responsive: true, displaylogo: false });
    _plotInited[plotId] = true;
  }
}

// ---- Leaflet ground-track panel ----------------------------------------------
function renderGroundTrack(panelIdx, satellites, frac) {
  const plotId = `plotly-${panelIdx}`;
  const leafId = `leaflet-${panelIdx}`;
  document.getElementById(plotId).style.display = 'none';
  document.getElementById(leafId).style.display = '';

  const earthSats = satellites.filter(s => s.body === 'earth');

  // Init Leaflet map once
  if (!_leafletMaps[panelIdx]) {
    const map = L.map(leafId, { center: [0, 0], zoom: 1,
                                 worldCopyJump: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd', maxZoom: 19,
    }).addTo(map);
    _leafletMaps[panelIdx] = map;
    _leafletLayers[panelIdx] = { tracks: [], markers: [] };
    setTimeout(() => map.invalidateSize(), 50);
  }

  const map = _leafletMaps[panelIdx];

  // Remove old layers
  const lyr = _leafletLayers[panelIdx];
  lyr.tracks.forEach(l => map.removeLayer(l));
  lyr.markers.forEach(l => map.removeLayer(l));
  lyr.tracks = []; lyr.markers = [];

  if (earthSats.length === 0) return;

  const refSat = earthSats[0];
  const t0 = refSat.epochJ2000;
  const tCur = t0 + frac * refSat.period;

  earthSats.forEach((sat, idx) => {
    const color = SAT_COLORS[idx % SAT_COLORS.length];
    const { positions, times } = orbitTrace(sat, t0, 360);

    // Build segments (split at dateline jumps)
    let seg = [];
    const segments = [seg];
    let prevLon = null;
    positions.forEach((pos, i) => {
      const ecef = eciToECEF(pos, times[i]);
      const { lat, lon } = ecefToLatLon(ecef);
      if (prevLon !== null && Math.abs(lon - prevLon) > 180) {
        seg = [];
        segments.push(seg);
      }
      seg.push([lat, lon]);
      prevLon = lon;
    });

    segments.forEach(s => {
      if (s.length < 2) return;
      const polyline = L.polyline(s, { color, weight: 2, opacity: 0.8 });
      polyline.addTo(map);
      lyr.tracks.push(polyline);
    });

    // Current position marker
    const { pos: cp } = propagate(sat, tCur);
    const ecefCur = eciToECEF(cp, tCur);
    const { lat, lon } = ecefToLatLon(ecefCur);
    const marker = L.circleMarker([lat, lon], {
      radius: 6, color: '#fff', weight: 1.5,
      fillColor: color, fillOpacity: 1,
    }).bindTooltip(sat.name, { permanent: false });
    marker.addTo(map);
    lyr.markers.push(marker);
  });
}

// ---- public entry point ------------------------------------------------------
function renderPanel(panelIdx, frame, satellites, frac) {
  if (frame === 'groundtrack') {
    renderGroundTrack(panelIdx, satellites, frac);
  } else {
    render3D(panelIdx, frame, satellites, frac);
  }
}

function invalidateLeaflet(panelIdx) {
  if (_leafletMaps[panelIdx]) _leafletMaps[panelIdx].invalidateSize();
}

// ---- helpers -----------------------------------------------------------------
function _showMessage(plotId, msg) {
  const el = document.getElementById(plotId);
  el.innerHTML = `<div class="plot-msg">${msg.replace(/\n/g,'<br>')}</div>`;
  _plotInited[plotId] = false;
}
function _clearMessage(plotId) {
  const el = document.getElementById(plotId);
  if (el.querySelector('.plot-msg')) {
    el.innerHTML = '';
    _plotInited[plotId] = false;
  }
}
