/**
 * GPS TRACKER - LÓGICA DO SISTEMA
 */

// ============================================
// CONFIGURAÇÃO DO SUPABASE
// ============================================
const SUPABASE_URL = 'https://pwqlscxflkrujrwigjoj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3cWxzY3hmbGtydWpyd2lnam9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjA2MDUsImV4cCI6MjA5MTgzNjYwNX0.CbtOeNCi5Cc5v6yo_svT6Fiw_XOFX3pnh8ikDY4rG6o';

// ============================================
// VARIÁVEIS GLOBAIS
// ============================================
let activeDevices = {};
let myDeviceId = localStorage.getItem('my_device_id') || ('celular_' + Math.floor(Math.random() * 10000));
localStorage.setItem('my_device_id', myDeviceId);

let isTracking = false;
let watchId = null;
let realtimeChannel = null;
let supabaseClient = null;
let lastDbInsert = 0;

const SCALE = 10;
let pulsePhase = 0;
let mapVisible = false;
let leafletMap = null;

// ============================================
// INICIALIZAÇÃO E ABAS
// ============================================

window.onload = () => {
    initSupabase();
    setupEventListeners();
};

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    
    // Ativa botão correto
    const targetBtn = Array.from(document.querySelectorAll('.tab-btn'))
        .find(btn => btn.getAttribute('onclick').includes(tabId));
    if (targetBtn) targetBtn.classList.add('active');

    if (tabId === 'tab-tracker') {
        setTimeout(() => windowResized(), 100);
    }
}

function setupEventListeners() {
    document.getElementById('toggle-map-btn').addEventListener('click', toggleMap);
    document.getElementById('activate-gps-btn').addEventListener('click', toggleTracking);
    document.getElementById('stop-all-btn').addEventListener('click', adminReset);
}

// ============================================
// GPS E TRACKING
// ============================================

async function initSupabase() {
    try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        updateStatus(true, 'Rastreador Online');

        realtimeChannel = supabaseClient.channel('radar-livre');

        realtimeChannel
            .on('broadcast', { event: 'gps_update' }, (payload) => {
                const data = payload.payload;
                activeDevices[data.id] = { lat: data.lat, lng: data.lng, timestamp: Date.now() };
            })
            .on('broadcast', { event: 'stop_tracking' }, () => {
                if (isTracking) stopTrackingGPS();
                activeDevices = {};
            })
            .subscribe();

    } catch (error) {
        console.error('Supabase Error:', error);
        updateStatus(false, 'Erro de conexão');
    }
}

function toggleTracking() {
    if (isTracking) stopTrackingGPS();
    else startTrackingGPS();
}

function startTrackingGPS() {
    if (!navigator.geolocation) return alert('GPS não suportado.');

    isTracking = true;
    const btn = document.getElementById('activate-gps-btn');
    btn.innerHTML = '⛔ Parar Rastreio';
    btn.style.background = '#ffaa00';

    watchId = navigator.geolocation.watchPosition(
        async (position) => {
            const { latitude: lat, longitude: lng } = position.coords;

            if (realtimeChannel) {
                realtimeChannel.send({ 
                    type: 'broadcast', 
                    event: 'gps_update', 
                    payload: { id: myDeviceId, lat, lng } 
                });
            }

            activeDevices[myDeviceId] = { lat, lng, timestamp: Date.now() };
            updateInfoPanel(lng, lat);

            if (Date.now() - lastDbInsert > 10000 && supabaseClient) {
                await supabaseClient.from('coordenadas').insert([{ x: lng.toString(), y: lat.toString() }]);
                lastDbInsert = Date.now();
            }
        },
        (err) => { 
            alert('Ative a localização!'); 
            stopTrackingGPS(); 
        },
        { enableHighAccuracy: true, maximumAge: 0 }
    );
}

function stopTrackingGPS() {
    isTracking = false;
    const btn = document.getElementById('activate-gps-btn');
    btn.innerHTML = '📡 Iniciar GPS';
    btn.style.background = '#44ff44';
    if (watchId) navigator.geolocation.clearWatch(watchId);
}

function updateStatus(connected, message) {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    connected ? dot.classList.add('connected') : dot.classList.remove('connected');
    text.textContent = message;
}

function updateInfoPanel(x, y) {
    document.getElementById('coord-x').textContent = x.toFixed(5);
    document.getElementById('coord-y').textContent = y.toFixed(5);
}

function adminReset() {
    if (confirm("Resetar todos os dispositivos ativos?")) {
        if (realtimeChannel) realtimeChannel.send({ type: 'broadcast', event: 'stop_tracking' });
        activeDevices = {};
    }
}

// ============================================
// P5.JS - VISUALIZAÇÃO
// ============================================

function setup() {
    const canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent('canvas-container');
}

function draw() {
    if (mapVisible) clear(); else background(10, 10, 18);

    push();
    translate(width / 2, height / 2);
    scale(1, -1);
    drawGrid();
    drawAxes();
    pop();

    drawActiveDevices();
    pulsePhase += 0.05;
}

function drawGrid() {
    stroke(255, 255, 255, 20);
    const maxX = width / 2 / SCALE;
    const maxY = height / 2 / SCALE;
    for (let x = -maxX; x <= maxX; x++) line(x * SCALE, -height/2, x * SCALE, height/2);
    for (let y = -maxY; y <= maxY; y++) line(-width/2, y * SCALE, width/2, y * SCALE);
}

function drawAxes() {
    strokeWeight(2);
    stroke(79, 195, 247, 100); line(-width/2, 0, width/2, 0); // X
    stroke(236, 64, 122, 100); line(0, -height/2, 0, height/2); // Y
}

function drawActiveDevices() {
    const pulseSize = 1 + 0.2 * sin(pulsePhase);
    for (let id in activeDevices) {
        const dev = activeDevices[id];
        if (Date.now() - dev.timestamp > 600000) { delete activeDevices[id]; continue; }

        let px, py;
        if (leafletMap && mapVisible) {
            const pt = leafletMap.latLngToContainerPoint([dev.lat, dev.lng]);
            px = pt.x; py = pt.y;
        } else {
            const diffLng = dev.lng - (-54.59590);
            const diffLat = dev.lat - (-20.51953);
            px = (width / 2) + (diffLng * 111320 * Math.cos(-20.5 * Math.PI / 180) * SCALE);
            py = (height / 2) - (diffLat * 111320 * SCALE);
        }

        const isMe = id === myDeviceId;
        stroke(isMe ? '#44ff44' : '#ff5252');
        strokeWeight(2); noFill();
        ellipse(px, py, 30 * pulseSize);
        fill(isMe ? '#44ff44' : '#ff5252'); noStroke();
        ellipse(px, py, 12);
        fill(255); textSize(10); textAlign(CENTER);
        text(id.substring(0, 8), px, py - 20);
    }
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    if (leafletMap) leafletMap.invalidateSize();
}

// ============================================
// LEAFLET MAP
// ============================================

function toggleMap() {
    mapVisible = !mapVisible;
    const mapDiv = document.getElementById('map-container');
    const btn = document.getElementById('toggle-map-btn');

    if (mapVisible) {
        mapDiv.style.display = 'block';
        btn.textContent = 'Ocultar Mapa';
        btn.style.background = '#ff4444'; btn.style.color = '#fff';

        if (!leafletMap) {
            leafletMap = L.map('map-container', {
                zoomControl: false, dragging: true, scrollWheelZoom: true
            }).setView([-20.51953, -54.59590], 19);

            L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
                maxZoom: 22, attribution: '© Google'
            }).addTo(leafletMap);
        }
        setTimeout(() => leafletMap.invalidateSize(), 100);
    } else {
        mapDiv.style.display = 'none';
        btn.textContent = 'Mostrar Mapa';
        btn.style.background = '#4fc3f7'; btn.style.color = '#0a0a12';
    }
}
