/**
 * GPS TRACKER - LÓGICA DO SISTEMA E SIMULADOR
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

let simulatorInstance = null;

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
    } else if (tabId === 'tab-learn' && !simulatorInstance) {
        // Inicializa o simulador interativo apenas quando abrir a aba de teoria pela primeira vez
        simulatorInstance = new p5(simulatorSketch);
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
// P5.JS - TRACKER RADAR (ESBOÇO GLOBAL)
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

// ============================================
// P5.JS - SIMULADOR INTERATIVO (INSTANCE MODE)
// ============================================

const simulatorSketch = (p) => {
    let userPos;
    let satellites = [];
    let isDraggingUser = false;
    let isDraggingSat = null;

    p.setup = () => {
        let container = document.getElementById('simulation-container');
        let w = container.offsetWidth || 500;
        let h = 350; // Altura fixa ideal
        let canvas = p.createCanvas(w, h);
        canvas.parent('simulation-container');

        // Inicializa satélites em locais espalhados
        satellites = [
            { id: 'A', x: 100, y: 80, color: '#44ff44', label: 'A (Verde)' },
            { id: 'B', x: w - 100, y: 100, color: '#4fc3f7', label: 'B (Cyan)' },
            { id: 'C', x: w / 2, y: h - 80, color: '#ec4072', label: 'C (Rosa)' }
        ];

        userPos = p.createVector(w / 2, h / 2 - 20);
    };

    p.draw = () => {
        p.background(8, 8, 15);
        p.drawGrid();

        // Linhas de distância e círculos orbitais
        satellites.forEach(sat => {
            let d = p.dist(userPos.x, userPos.y, sat.x, sat.y);

            // Círculo eletromagnético (Raio da distância)
            p.noFill();
            p.stroke(sat.color + '22'); // Alfa reduzido
            p.strokeWeight(1.5);
            p.ellipse(sat.x, sat.y, d * 2);

            // Linha direta Satélite -> Usuário
            p.stroke(sat.color + 'aa');
            p.strokeWeight(1);
            p.line(sat.x, sat.y, userPos.x, userPos.y);

            // Desenha o Satélite
            p.fill(sat.color);
            p.noStroke();
            p.ellipse(sat.x, sat.y, 22);
            
            p.fill(0);
            p.textAlign(p.CENTER, p.CENTER);
            p.textSize(12);
            p.textStyle(p.BOLD);
            p.text(sat.id, sat.x, sat.y);

            // Atualiza os dados no painel lateral HTML
            let htmlId = `sim-sat-${sat.id.toLowerCase()}`;
            let el = document.getElementById(htmlId);
            if (el) {
                // Escala simulada: pixels -> metros (x5 para parecer realista)
                let simX = ((sat.x - p.width/2) / 2).toFixed(1);
                let simY = ((p.height/2 - sat.y) / 2).toFixed(1);
                let simDist = (d / 2).toFixed(1);
                el.innerHTML = `<strong>Satélite ${sat.id}:</strong> Posição (${simX}, ${simY}) | Raio: <strong>${simDist}m</strong>`;
            }
        });

        // Desenha o Usuário (Você)
        p.stroke(255);
        p.strokeWeight(2);
        p.fill(79, 195, 247);
        p.ellipse(userPos.x, userPos.y, 16);

        // Halo de pulso no usuário
        p.noFill();
        p.stroke(79, 195, 247, 100);
        let pulse = 16 + 10 * p.sin(p.frameCount * 0.1);
        p.ellipse(userPos.x, userPos.y, pulse);

        // Texto informativo
        p.noStroke();
        p.fill(255);
        p.textSize(11);
        p.textStyle(p.NORMAL);
        p.textAlign(p.CENTER, p.BOTTOM);
        p.text("Você (Arraste)", userPos.x, userPos.y - 12);

        // Atualiza a posição calculada do Usuário no HTML
        let userEl = document.getElementById('sim-user-pos');
        if (userEl) {
            let simUserX = ((userPos.x - p.width/2) / 2).toFixed(1);
            let simUserY = ((p.height/2 - userPos.y) / 2).toFixed(1);
            userEl.textContent = `(${simUserX}, ${simUserY})`;
        }
    };

    p.drawGrid = () => {
        p.stroke(255, 255, 255, 15);
        p.strokeWeight(0.5);
        for(let x=0; x<p.width; x+=30) p.line(x, 0, x, p.height);
        for(let y=0; y<p.height; y+=30) p.line(0, y, p.width, y);
        
        // Eixo de Origem (0,0) fictício
        p.stroke(255, 255, 255, 30);
        p.line(p.width/2, 0, p.width/2, p.height);
        p.line(0, p.height/2, p.width, p.height/2);
    };

    // Detecção de clique para arrastar
    p.mousePressed = () => {
        // Verifica se clicou no usuário
        let dUser = p.dist(p.mouseX, p.mouseY, userPos.x, userPos.y);
        if (dUser < 15) {
            isDraggingUser = true;
            return;
        }

        // Verifica se clicou em algum satélite (permite mover os satélites também!)
        for (let i = 0; i < satellites.length; i++) {
            let dSat = p.dist(p.mouseX, p.mouseY, satellites[i].x, satellites[i].y);
            if (dSat < 15) {
                isDraggingSat = i;
                return;
            }
        }
    };

    p.mouseDragged = () => {
        if (isDraggingUser) {
            userPos.x = p.constrain(p.mouseX, 10, p.width - 10);
            userPos.y = p.constrain(p.mouseY, 10, p.height - 10);
        } else if (isDraggingSat !== null) {
            satellites[isDraggingSat].x = p.constrain(p.mouseX, 10, p.width - 10);
            satellites[isDraggingSat].y = p.constrain(p.mouseY, 10, p.height - 10);
        }
    };

    p.mouseReleased = () => {
        isDraggingUser = false;
        isDraggingSat = null;
    };
};
