/* ============================================
   Flood DSS — Application Logic
   ============================================ */

// --- State ---
let regionsData = [];
let rankingData = [];
let kpiData = {};
let classDistData = {};
let trainingHistory = {};
let perClassIou = {};
let geojsonData = {};
let map = null;

const STATUS_COLORS = {
  KRITIS: '#C0392B',
  TINGGI: '#E67E22',
  SEDANG: '#F1C40F',
  RENDAH: '#2ECC71'
};

const CLASS_NAMES = [
  'background', 'building-flooded', 'building-non-flooded',
  'grass', 'pool', 'road-flooded', 'road-non-flooded',
  'tree', 'vehicle', 'water'
];

const CLASS_COLORS_HEX = [
  '#000000', '#FF0000', '#B47878', '#04FA07', '#FFEB00',
  '#A09614', '#8C8C8C', '#0052FF', '#FF00F5', '#3DE6FA'
];

const TRAIN_PCT = {
  background: 1.72, 'building-flooded': 1.56, 'building-non-flooded': 3.25,
  grass: 2.75, pool: 5.52, 'road-flooded': 10.94, 'road-non-flooded': 17.46,
  tree: 0.18, vehicle: 0.20, water: 56.41
};

// --- Theme Toggle ---
document.getElementById('theme-toggle').addEventListener('click', () => {
  const html = document.documentElement;
  const newTheme = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', newTheme);
  updateChartColors();
});

// --- Data Loading ---
async function loadData() {
  const [regions, ranking, kpi, classDist, history, iou, geojson] = await Promise.all([
    fetch('data/regions.json').then(r => r.json()),
    fetch('data/ranking.json').then(r => r.json()),
    fetch('data/kpi.json').then(r => r.json()),
    fetch('data/class_distribution_test.json').then(r => r.json()),
    fetch('data/training_history.json').then(r => r.json()),
    fetch('data/per_class_iou.json').then(r => r.json()),
    fetch('data/regions.geojson').then(r => r.json())
  ]);
  
  regionsData = regions;
  rankingData = ranking;
  kpiData = kpi;
  classDistData = classDist;
  trainingHistory = history;
  perClassIou = iou;
  geojsonData = geojson;
}

// --- KPI Strip ---
function renderKPI() {
  const grid = document.getElementById('kpi-grid');
  const cards = [
    { label: 'Total Wilayah Terpantau', value: kpiData.total_regions, cls: 'info', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>' },
    { label: 'Wilayah KRITIS', value: kpiData.critical_regions, cls: 'critical', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' },
    { label: 'Wilayah TINGGI', value: kpiData.high_regions, cls: 'warning', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>' },
    { label: 'Rata-rata Genangan', value: kpiData.avg_inundation_pct + '%', cls: 'accent', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/></svg>' },
    { label: 'Wilayah Akses Terputus', value: kpiData.roads_cut_regions, cls: 'danger', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>' }
  ];
  
  grid.innerHTML = cards.map(c => `
    <div class="kpi-card kpi-${c.cls}">
      <div class="kpi-label">${c.icon}<span>${c.label}</span></div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-bg-icon">${c.icon}</div>
    </div>
  `).join('');
}

// --- Map ---
function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        'osm-tiles': {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap'
        }
      },
      layers: [{
        id: 'osm-layer',
        type: 'raster',
        source: 'osm-tiles',
        minzoom: 0,
        maxzoom: 19
      }],
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
    },
    center: [104.96, -2.34],
    zoom: 10.5
  });

  map.on('load', () => {
    map.addSource('regions', { type: 'geojson', data: geojsonData });
    
    map.addLayer({
      id: 'regions-fill',
      type: 'fill',
      source: 'regions',
      paint: {
        'fill-color': [
          'match', ['get', 'status'],
          'KRITIS', STATUS_COLORS.KRITIS,
          'TINGGI', STATUS_COLORS.TINGGI,
          'SEDANG', STATUS_COLORS.SEDANG,
          'RENDAH', STATUS_COLORS.RENDAH,
          '#888'
        ],
        'fill-opacity': 0.55
      }
    });
    
    map.addLayer({
      id: 'regions-line',
      type: 'line',
      source: 'regions',
      paint: { 'line-color': '#E8EEF7', 'line-width': 1.5, 'line-opacity': 0.7 }
    });

    map.addLayer({
      id: 'regions-label',
      type: 'symbol',
      source: 'regions',
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-font': ['Open Sans Regular']
      },
      paint: { 'text-color': '#E8EEF7', 'text-halo-color': '#000', 'text-halo-width': 1 }
    });

    // Click interaction
    map.on('click', 'regions-fill', (e) => {
      if (!e.features.length) return;
      const props = e.features[0].properties;
      const region = regionsData.find(r => r.region_id === props.region_id);
      if (region) showPanel(region);
    });
    
    map.on('mouseenter', 'regions-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'regions-fill', () => { map.getCanvas().style.cursor = ''; });
  });
  
  document.getElementById('panel-close').addEventListener('click', () => {
    document.getElementById('map-panel').classList.add('hidden');
  });
}

function formatCount(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M px';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(0) + 'k px';
  }
  return num + ' px';
}

function formatRecommendation(text) {
  if (!text) return '';
  let formatted = text.replace(/#([a-zA-Z0-9-]+)/g, (match, p1) => {
    const idx = CLASS_NAMES.indexOf(p1);
    const color = idx !== -1 ? CLASS_COLORS_HEX[idx] : '#888';
    return `<strong style="color: ${color}; border-bottom: 1.5px solid ${color}40; padding-bottom: 1px;">${p1}</strong>`;
  });
  
  // Replace backticks with code style
  formatted = formatted.replace(/`([^`]+)`/g, (match, p1) => {
    const idx = CLASS_NAMES.indexOf(p1);
    const color = idx !== -1 ? CLASS_COLORS_HEX[idx] : '#888';
    return `<code style="font-family: var(--font-mono); background: var(--bg-elevated); color: ${color}; padding: 2px 4px; border-radius: 4px; font-size: 0.9em; border: 1px solid var(--border);">${p1}</code>`;
  });
  
  return formatted;
}

function focusOnRegion(regionId) {
  const feature = geojsonData.features.find(f => f.properties.region_id === regionId);
  if (feature && map) {
    const coords = feature.geometry.coordinates[0];
    const lons = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    
    const centerLon = (minLon + maxLon) / 2;
    const centerLat = (minLat + maxLat) / 2;
    
    map.flyTo({
      center: [centerLon, centerLat],
      zoom: 11.5,
      essential: true
    });
    
    const region = regionsData.find(r => r.region_id === regionId);
    if (region) showPanel(region);
  }
}
window.focusOnRegion = focusOnRegion;

function showPanel(region) {
  const panel = document.getElementById('map-panel');
  panel.classList.remove('hidden');
  document.getElementById('panel-name').textContent = region.name;
  
  const badge = document.getElementById('panel-badge');
  badge.textContent = region.status;
  badge.className = `panel-badge badge-${region.status}`;
  
  document.getElementById('panel-fspi').textContent = region.fspi;
  
  const ind = region.indicators;
  setBar('bar-inundation', 'val-inundation', ind.inundation);
  setBar('bar-infra', 'val-infra', ind.infra_damage);
  setBar('bar-access', 'val-access', ind.access_loss);
  
  // Render top labels tags
  const tagsContainer = document.getElementById('panel-tags');
  if (tagsContainer) {
    tagsContainer.innerHTML = (region.top_labels || []).map(item => {
      const name = item.label;
      const count = item.count;
      const idx = CLASS_NAMES.indexOf(name);
      const color = idx !== -1 ? CLASS_COLORS_HEX[idx] : '#888';
      return `
        <span class="label-chip">
          <span class="chip-dot" style="background-color: ${color}"></span>
          <span class="chip-name">${name}</span>
          <span class="chip-count">(${formatCount(count)})</span>
        </span>
      `;
    }).join('');
  }
  
  document.getElementById('panel-rec').innerHTML = formatRecommendation(region.recommendation);
  document.getElementById('panel-meta').textContent = `Berdasarkan analisis ${region.n_images} citra udara`;
}

function setBar(barId, valId, value) {
  const pct = Math.min(value * 100, 100);
  const el = document.getElementById(barId);
  el.style.width = pct + '%';
  el.style.background = pct >= 60 ? STATUS_COLORS.KRITIS : pct >= 40 ? STATUS_COLORS.TINGGI : pct >= 20 ? STATUS_COLORS.SEDANG : STATUS_COLORS.RENDAH;
  document.getElementById(valId).textContent = (pct).toFixed(1) + '%';
}

// --- What-If Sliders ---
function initSliders() {
  ['w1', 'w2', 'w3'].forEach(id => {
    const slider = document.getElementById(id);
    slider.addEventListener('input', () => {
      document.getElementById(id + '-val').textContent = slider.value + '%';
      recalcFSPI();
    });
  });
}

function recalcFSPI() {
  const w1 = document.getElementById('w1').value / 100;
  const w2 = document.getElementById('w2').value / 100;
  const w3 = document.getElementById('w3').value / 100;
  const total = w1 + w2 + w3 || 1;
  
  regionsData.forEach(r => {
    const raw = (w1 * r.indicators.inundation + w2 * r.indicators.infra_damage + w3 * r.indicators.access_loss) / total;
    r.fspi = Math.round(raw * 1000) / 10;
    r.status = r.fspi >= 60 ? 'KRITIS' : r.fspi >= 40 ? 'TINGGI' : r.fspi >= 20 ? 'SEDANG' : 'RENDAH';
  });
  
  // Update GeoJSON properties
  geojsonData.features.forEach(f => {
    const r = regionsData.find(rr => rr.region_id === f.properties.region_id);
    if (r) { f.properties.fspi = r.fspi; f.properties.status = r.status; }
  });
  
  if (map && map.getSource('regions')) {
    map.getSource('regions').setData(geojsonData);
  }
  
  rankingData = [...regionsData].sort((a, b) => b.fspi - a.fspi);
  renderFeed();
}

// --- Layer Select ---
document.getElementById('map-layer-select').addEventListener('change', (e) => {
  const val = e.target.value;
  if (!map) return;
  
  if (val === 'fspi') {
    map.setPaintProperty('regions-fill', 'fill-color', [
      'match', ['get', 'status'],
      'KRITIS', STATUS_COLORS.KRITIS, 'TINGGI', STATUS_COLORS.TINGGI,
      'SEDANG', STATUS_COLORS.SEDANG, 'RENDAH', STATUS_COLORS.RENDAH, '#888'
    ]);
  } else {
    // For indicator layers, update GeoJSON with the indicator value
    geojsonData.features.forEach(f => {
      const r = regionsData.find(rr => rr.region_id === f.properties.region_id);
      if (r) f.properties._indicator = r.indicators[val] || 0;
    });
    map.getSource('regions').setData(geojsonData);
    
    map.setPaintProperty('regions-fill', 'fill-color', [
      'interpolate', ['linear'], ['get', '_indicator'],
      0, STATUS_COLORS.RENDAH, 0.3, STATUS_COLORS.SEDANG,
      0.6, STATUS_COLORS.TINGGI, 0.8, STATUS_COLORS.KRITIS
    ]);
  }
});

// --- Decision Feed ---
function renderFeed() {
  const list = document.getElementById('feed-list');
  list.innerHTML = rankingData.map((r, i) => {
    const labelsHTML = (r.top_labels || []).map(item => {
      const name = item.label;
      const count = item.count;
      const idx = CLASS_NAMES.indexOf(name);
      const color = idx !== -1 ? CLASS_COLORS_HEX[idx] : '#888';
      return `
        <span class="label-chip">
          <span class="chip-dot" style="background-color: ${color}"></span>
          <span class="chip-name">${name}</span>
          <span class="chip-count">${formatCount(count)}</span>
        </span>
      `;
    }).join('');

    return `
      <div class="feed-card" onclick="focusOnRegion('${r.region_id}')" style="cursor: pointer;">
        <div class="feed-rank">#${i + 1}</div>
        <div class="feed-info">
          <h4>${r.name}</h4>
          <div class="feed-tags">${labelsHTML}</div>
          <p class="feed-rec">${formatRecommendation(r.recommendation)}</p>
        </div>
        <div class="feed-right">
          <div class="feed-badge badge-${r.status}">${r.status}</div>
          <div class="feed-fspi">${r.fspi.toFixed(1)}</div>
        </div>
      </div>
    `;
  }).join('');
}

// --- Export PDF ---
document.getElementById('btn-export').addEventListener('click', () => {
  window.print();
});

// --- Charts ---
let chartLoss, chartMiou, chartIouClass, chartClassTest, chartClassTrain;

function getChartTextColor() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? '#0B1220' : '#94A3B8';
}

function getChartGridColor() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? '#CBD6E2' : '#2A3850';
}

function chartDefaults() {
  return {
    color: getChartTextColor(),
    borderColor: getChartGridColor(),
    plugins: { legend: { labels: { color: getChartTextColor(), font: { family: 'Inter', size: 12 } } } },
    scales: {
      x: { ticks: { color: getChartTextColor() }, grid: { color: getChartGridColor() } },
      y: { ticks: { color: getChartTextColor() }, grid: { color: getChartGridColor() } }
    }
  };
}

function renderCharts() {
  const epochs = trainingHistory.train_loss.map((_, i) => `Epoch ${i + 1}`);
  const defaults = chartDefaults();
  
  // Loss Chart
  chartLoss = new Chart(document.getElementById('chart-loss'), {
    type: 'line',
    data: {
      labels: epochs,
      datasets: [
        { label: 'Train Loss', data: trainingHistory.train_loss, borderColor: '#1F6FEB', backgroundColor: 'rgba(31,111,235,0.1)', tension: 0.3, fill: true },
        { label: 'Val Loss', data: trainingHistory.val_loss, borderColor: '#C0392B', backgroundColor: 'rgba(192,57,43,0.1)', tension: 0.3, fill: true }
      ]
    },
    options: { responsive: true, ...defaults }
  });
  
  // mIoU Chart
  chartMiou = new Chart(document.getElementById('chart-miou'), {
    type: 'line',
    data: {
      labels: epochs,
      datasets: [
        { label: 'Train mIoU', data: trainingHistory.train_miou, borderColor: '#1F6FEB', tension: 0.3 },
        { label: 'Val mIoU', data: trainingHistory.val_miou, borderColor: '#2DBFD6', tension: 0.3 }
      ]
    },
    options: { responsive: true, ...defaults }
  });
  
  // Per-class IoU
  const iouClasses = Object.keys(perClassIou).filter(k => k !== 'background');
  const iouVals = iouClasses.map(k => perClassIou[k]);
  const iouColors = iouClasses.map((_, i) => CLASS_COLORS_HEX[i + 1]);
  
  chartIouClass = new Chart(document.getElementById('chart-iou-class'), {
    type: 'bar',
    data: {
      labels: iouClasses.map(c => c.replace('_', ' ')),
      datasets: [{ label: 'IoU', data: iouVals, backgroundColor: iouColors, borderRadius: 6 }]
    },
    options: {
      responsive: true,
      indexAxis: 'y',
      ...defaults,
      plugins: {
        ...defaults.plugins,
        tooltip: {
          callbacks: {
            afterLabel: (ctx) => {
              const val = ctx.raw;
              if (val < 0.6) return 'Objek kecil & langka -> lebih sulit';
              return '';
            }
          }
        }
      }
    }
  });
  
  // Test class distribution (donut)
  const testClasses = CLASS_NAMES.filter(c => c !== 'background');
  const testPx = testClasses.map(c => classDistData.classes[c] || 0);
  
  chartClassTest = new Chart(document.getElementById('chart-class-test'), {
    type: 'doughnut',
    data: {
      labels: testClasses.map(c => c.replace('_', ' ')),
      datasets: [{ data: testPx, backgroundColor: CLASS_COLORS_HEX.slice(1), borderWidth: 0 }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'right', labels: { color: getChartTextColor(), font: { size: 11 } } } }
    }
  });
  
  // Train class distribution (bar)
  const trainClasses = CLASS_NAMES.filter(c => c !== 'background');
  const trainPcts = trainClasses.map(c => TRAIN_PCT[c]);
  
  chartClassTrain = new Chart(document.getElementById('chart-class-train'), {
    type: 'bar',
    data: {
      labels: trainClasses.map(c => c.replace('_', ' ')),
      datasets: [{ label: '% Piksel', data: trainPcts, backgroundColor: CLASS_COLORS_HEX.slice(1), borderRadius: 6 }]
    },
    options: {
      responsive: true,
      ...defaults,
      scales: {
        ...defaults.scales,
        y: { ...defaults.scales.y, type: 'logarithmic' },
        x: { ...defaults.scales.x, ticks: { ...defaults.scales.x.ticks, maxRotation: 45, minRotation: 30 } }
      }
    }
  });
}

function updateChartColors() {
  const textColor = getChartTextColor();
  const gridColor = getChartGridColor();
  
  [chartLoss, chartMiou, chartIouClass, chartClassTrain].forEach(chart => {
    if (!chart) return;
    if (chart.options.scales) {
      Object.values(chart.options.scales).forEach(s => {
        if (s.ticks) s.ticks.color = textColor;
        if (s.grid) s.grid.color = gridColor;
      });
    }
    if (chart.options.plugins && chart.options.plugins.legend) {
      chart.options.plugins.legend.labels.color = textColor;
    }
    chart.update('none');
  });
  
  if (chartClassTest) {
    chartClassTest.options.plugins.legend.labels.color = textColor;
    chartClassTest.update('none');
  }
}

// --- Download Sample Image ---
let sampleList = [];

async function initSampleDownload() {
  const btn = document.getElementById('btn-download-sample');
  if (!btn) return;
  
  try {
    const r = await fetch('data/samples.json');
    sampleList = await r.json();
  } catch (e) {
    console.error("Gagal memuat daftar sampel:", e);
    sampleList = ['7083.jpg', '7188.jpg', '8334.jpg', '8131.jpg', '8796.jpg', '8009.jpg', '8817.jpg', '6338.jpg', '7109.jpg', '7171.jpg'];
  }
  
  btn.addEventListener('click', () => {
    if (sampleList.length === 0) return;
    const randomImg = sampleList[Math.floor(Math.random() * sampleList.length)];
    const url = `samples/${randomImg}`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `sample-train-${randomImg}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    const msg = document.getElementById('download-msg');
    if (msg) {
      msg.textContent = `Berhasil mengunduh sample-train-${randomImg}!`;
      setTimeout(() => { msg.textContent = ''; }, 3000);
    }
  });
}

// --- Tab Routing ---
function handleRouting() {
  const hash = window.location.hash || '#insight';
  const tabIds = ['#insight', '#prototype', '#live', '#performa'];
  
  // Update nav link active state
  document.querySelectorAll('.header-nav a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === hash) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
  
  // Show active section and hide others
  tabIds.forEach(id => {
    const el = document.querySelector(id);
    if (el) {
      if (id === hash) {
        el.classList.remove('tab-hidden');
        if (id === '#prototype' && map) {
          setTimeout(() => { map.resize(); }, 150);
        }
      } else {
        el.classList.add('tab-hidden');
      }
    }
  });
  
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'instant' });
}

window.addEventListener('hashchange', handleRouting);

// --- Init ---
async function init() {
  await loadData();
  renderKPI();
  initMap();
  initSliders();
  renderFeed();
  renderCharts();
  await initSampleDownload();
  handleRouting();
}

init();
