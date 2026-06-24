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

// Inicializa a própria posição no centro da escola para começar
activeDevices[myDeviceId] = { lat: -20.51953, lng: -54.59590, timestamp: Date.now() };

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
let isDraggingLocalDevice = false;

// Variáveis para a Bússola e Filtro do GPS
let deviceHeading = 0;
let compassActive = false; // Bússola desligada por padrão
let emaLat = null;
let emaLng = null;
const EMA_ALPHA = 0.3; // Fator de suavização do GPS (quanto menor, mais suave/lento)

// ============================================
// INICIALIZAÇÃO E ABAS
// ============================================

window.onload = () => {
    initSupabase();
    setupEventListeners();
    updateInfoPanel(-54.59590, -20.51953); // Coordenadas iniciais
    setupCompass();
};

// Auxiliar para atualizar texto e ícone dos botões sem destruir a estrutura HTML do mobile
function setButtonState(btnId, icon, text) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const iconSpan = btn.querySelector('.btn-icon');
    const textSpan = btn.querySelector('.btn-text');
    if (iconSpan && textSpan) {
        iconSpan.textContent = icon;
        textSpan.textContent = text;
    } else {
        btn.innerHTML = `<span class="btn-icon">${icon}</span> <span class="btn-text">${text}</span>`;
    }
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn, .bottom-tab-btn').forEach(btn => btn.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    
    // Ativa botão correto (desktop header)
    const targetBtn = Array.from(document.querySelectorAll('.tab-btn'))
        .find(btn => btn.getAttribute('onclick').includes(tabId));
    if (targetBtn) targetBtn.classList.add('active');

    // Ativa botão correto (mobile bottom nav)
    const targetBottomBtn = Array.from(document.querySelectorAll('.bottom-tab-btn'))
        .find(btn => btn.getAttribute('onclick').includes(tabId));
    if (targetBottomBtn) targetBottomBtn.classList.add('active');

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

// Controla a abertura/fechamento da barra lateral (Toggle flexível)
function toggleSidebar(show) {
    const sidebar = document.getElementById('info-sidebar');
    if (sidebar) {
        if (show === undefined) {
            sidebar.classList.toggle('open');
        } else if (show) {
            sidebar.classList.add('open');
        } else {
            sidebar.classList.remove('open');
        }
    }
}

// ============================================
// CONFIGURAÇÃO DA BÚSSOLA (DEVICE ORIENTATION)
// ============================================

function setupCompass() {
    // Android e outros navegadores registram no onload, mas só rotacionam se compassActive for true
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission !== 'function') {
        window.addEventListener('deviceorientation', handleOrientation, true);
    }
}

function toggleCompass() {
    compassActive = !compassActive;
    const btn = document.getElementById('compass-toggle-btn');
    
    if (compassActive) {
        if (btn) btn.classList.add('active');
        requestCompassPermission();
    } else {
        if (btn) btn.classList.remove('active');
        
        // Reseta a rotação do mapa e do canvas imediatamente
        const canvasContainer = document.getElementById('canvas-container');
        const mapContainer = document.getElementById('map-container');
        if (canvasContainer) canvasContainer.style.transform = '';
        if (mapContainer) mapContainer.style.transform = '';
    }
}

function requestCompassPermission() {
    // iOS requer permissão explícita
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(response => {
                if (response === 'granted') {
                    window.addEventListener('deviceorientation', handleOrientation, true);
                    // Esconde botão interno se permissão concedida pelo flutuante
                    const btn = document.getElementById('compass-permission-btn');
                    if (btn) btn.style.display = 'none';
                } else {
                    alert('Permissão para bússola recusada.');
                    compassActive = false;
                    const btn = document.getElementById('compass-toggle-btn');
                    if (btn) btn.classList.remove('active');
                }
            })
            .catch(err => {
                console.error(err);
                compassActive = false;
                const btn = document.getElementById('compass-toggle-btn');
                if (btn) btn.classList.remove('active');
            });
    } else {
        // Android ou navegadores que não precisam de requestPermission
        window.addEventListener('deviceorientation', handleOrientation, true);
    }
}

function handleOrientation(event) {
    if (!compassActive) return; // Só rotaciona se a bússola foi ativada pelo botão!
    
    let heading = event.webkitCompassHeading || (360 - event.alpha);
    if (heading !== undefined && heading !== null) {
        deviceHeading = heading;
        
        const canvasContainer = document.getElementById('canvas-container');
        const mapContainer = document.getElementById('map-container');
        
        // Adicionamos scale(1.4) para evitar bordas pretas durante a rotação da tela
        if (canvasContainer) {
            canvasContainer.style.transform = `rotate(${-deviceHeading}deg) scale(1.4)`;
            canvasContainer.style.transformOrigin = 'center center';
        }
        if (mapContainer) {
            mapContainer.style.transform = `rotate(${-deviceHeading}deg) scale(1.4)`;
            mapContainer.style.transformOrigin = 'center center';
        }
    }
}

// ============================================
// GPS E TRACKING (COM FILTRAGEM SUAVE)
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
    setButtonState('activate-gps-btn', '⛔', 'Parar GPS');
    btn.style.background = '#ffaa00';
    btn.style.color = '#0a0a12';

    // Reseta o filtro ao iniciar novo rastreio
    emaLat = null;
    emaLng = null;

    watchId = navigator.geolocation.watchPosition(
        async (position) => {
            const { latitude: rawLat, longitude: rawLng } = position.coords;

            // Filtro matemático de Média Móvel Exponencial (EMA) para suavizar a precisão
            if (emaLat === null || emaLng === null) {
                emaLat = rawLat;
                emaLng = rawLng;
            } else {
                emaLat = emaLat + EMA_ALPHA * (rawLat - emaLat);
                emaLng = emaLng + EMA_ALPHA * (rawLng - emaLng);
            }

            updateLocalPosition(emaLat, emaLng);
        },
        (err) => { 
            alert('Ative a localização e dê permissão de alta precisão!'); 
            stopTrackingGPS(); 
        },
        { 
            enableHighAccuracy: true, // Força GPS de hardware de alta precisão
            maximumAge: 0,            // Garante leitura limpa, sem cache
            timeout: 5000             // Força atualização veloz
        }
    );
}

function stopTrackingGPS() {
    isTracking = false;
    const btn = document.getElementById('activate-gps-btn');
    setButtonState('activate-gps-btn', '📡', 'Iniciar GPS');
    btn.style.background = '#44ff44';
    btn.style.color = '#0a0a12';
    if (watchId) navigator.geolocation.clearWatch(watchId);
}

// Atualiza a própria posição local, centraliza o mapa e notifica a rede
function updateLocalPosition(lat, lng) {
    activeDevices[myDeviceId] = { lat, lng, timestamp: Date.now() };
    updateInfoPanel(lng, lat);

    // Auto-centraliza o mapa no usuário conforme ele caminha
    if (leafletMap && mapVisible) {
        leafletMap.setView([lat, lng], leafletMap.getZoom());
    }

    // Envia aos outros celulares conectados via WebSocket
    if (realtimeChannel) {
        realtimeChannel.send({ 
            type: 'broadcast', 
            event: 'gps_update', 
            payload: { id: myDeviceId, lat, lng } 
        });
    }

    // Salva no banco histórico a cada 10 segundos
    if (Date.now() - lastDbInsert > 10000 && supabaseClient) {
        supabaseClient.from('coordenadas').insert([{ x: lng.toString(), y: lat.toString() }]);
        lastDbInsert = Date.now();
    }
}

function updateStatus(connected, message) {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    connected ? dot.classList.add('connected') : dot.classList.remove('connected');
    text.textContent = message;
}

function updateInfoPanel(x, y) {
    document.getElementById('coord-x').textContent = x.toFixed(6);
    document.getElementById('coord-y').textContent = y.toFixed(6);
}

function adminReset() {
    if (confirm("Resetar todos os dispositivos ativos?")) {
        if (realtimeChannel) realtimeChannel.send({ type: 'broadcast', event: 'stop_tracking' });
        activeDevices = {};
        toggleSidebar(false);
    }
}

// ============================================
// P5.JS - TRACKER RADAR (OTIMIZADO MOBILE)
// ============================================

function setup() {
    const canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent('canvas-container');
    
    // Otimização de performance crucial para mobile (evita travamento de CPU/GPU)
    frameRate(30);
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
        text(id === myDeviceId ? "Você" : id.substring(0, 8), px, py - 20);
    }
}

// -- LÓGICA DE CLIQUE E ARRASTO NO CANVAS GLOBAL --
function mousePressed() {
    if (mapVisible || document.querySelector('.tab-btn.active').textContent !== 'Monitoramento') return;

    let myDev = activeDevices[myDeviceId];
    if (myDev) {
        let px, py;
        const diffLng = myDev.lng - (-54.59590);
        const diffLat = myDev.lat - (-20.51953);
        px = (width / 2) + (diffLng * 111320 * Math.cos(-20.5 * Math.PI / 180) * SCALE);
        py = (height / 2) - (diffLat * 111320 * SCALE);

        let d = dist(mouseX, mouseY, px, py);
        if (d < 25) {
            isDraggingLocalDevice = true;
        } else {
            handleScreenInteraction(mouseX, mouseY);
        }
    }
}

function mouseDragged() {
    if (isDraggingLocalDevice) {
        handleScreenInteraction(mouseX, mouseY);
    }
}

function mouseReleased() {
    isDraggingLocalDevice = false;
}

function handleScreenInteraction(mx, my) {
    const diffLng = (mx - width / 2) / (111320 * Math.cos(-20.5 * Math.PI / 180) * SCALE);
    const diffLat = (height / 2 - my) / (111320 * SCALE);

    const lng = diffLng + (-54.59590);
    const lat = diffLat + (-20.51953);

    updateLocalPosition(lat, lng);
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    if (leafletMap) leafletMap.invalidateSize();
}

// ============================================
// LEAFLET MAP (E INTERATIVIDADE DO MAPA)
// ============================================

function toggleMap() {
    mapVisible = !mapVisible;
    const mapDiv = document.getElementById('map-container');
    const btn = document.getElementById('toggle-map-btn');

    if (mapVisible) {
        mapDiv.style.display = 'block';
        setButtonState('toggle-map-btn', '🗺️', 'Ocultar Mapa');
        btn.style.background = '#ff4444'; btn.style.color = '#fff';

        if (!leafletMap) {
            leafletMap = L.map('map-container', {
                zoomControl: true, dragging: true, scrollWheelZoom: true
            }).setView([-20.51953, -54.59590], 19);

            L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
                maxZoom: 22, attribution: '© Google'
            }).addTo(leafletMap);

            leafletMap.on('click', (e) => {
                updateLocalPosition(e.latlng.lat, e.latlng.lng);
            });
        }
        setTimeout(() => leafletMap.invalidateSize(), 100);
    } else {
        mapDiv.style.display = 'none';
        setButtonState('toggle-map-btn', '🗺️', 'Mostrar Mapa');
        btn.style.background = 'rgba(255, 255, 255, 0.05)'; btn.style.color = '#fff';
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
        let h = 350;
        let canvas = p.createCanvas(w, h);
        canvas.parent('simulation-container');

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

        satellites.forEach(sat => {
            let d = p.dist(userPos.x, userPos.y, sat.x, sat.y);

            p.noFill();
            p.stroke(sat.color + '22');
            p.strokeWeight(1.5);
            p.ellipse(sat.x, sat.y, d * 2);

            p.stroke(sat.color + 'aa');
            p.strokeWeight(1);
            p.line(sat.x, sat.y, userPos.x, userPos.y);

            p.fill(sat.color);
            p.noStroke();
            p.ellipse(sat.x, sat.y, 22);
            
            p.fill(0);
            p.textAlign(p.CENTER, p.CENTER);
            p.textSize(12);
            p.textStyle(p.BOLD);
            p.text(sat.id, sat.x, sat.y);

            let htmlId = `sim-sat-${sat.id.toLowerCase()}`;
            let el = document.getElementById(htmlId);
            if (el) {
                let simX = ((sat.x - p.width/2) / 2).toFixed(1);
                let simY = ((p.height/2 - sat.y) / 2).toFixed(1);
                let simDist = (d / 2).toFixed(1);
                el.innerHTML = `<strong>Satélite ${sat.id}:</strong> Posição (${simX}, ${simY}) | Raio: <strong>${simDist}m</strong>`;
            }
        });

        p.stroke(255);
        p.strokeWeight(2);
        p.fill(79, 195, 247);
        p.ellipse(userPos.x, userPos.y, 16);

        p.noFill();
        p.stroke(79, 195, 247, 100);
        let pulse = 16 + 10 * p.sin(p.frameCount * 0.1);
        p.ellipse(userPos.x, userPos.y, pulse);

        p.noStroke();
        p.fill(255);
        p.textSize(11);
        p.textStyle(p.NORMAL);
        p.textAlign(p.CENTER, p.BOTTOM);
        p.text("Você (Arraste)", userPos.x, userPos.y - 12);

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
        
        p.stroke(255, 255, 255, 30);
        p.line(p.width/2, 0, p.width/2, p.height);
        p.line(0, p.height/2, p.width, p.height/2);
    };

    p.mousePressed = () => {
        let dUser = p.dist(p.mouseX, p.mouseY, userPos.x, userPos.y);
        if (dUser < 15) {
            isDraggingUser = true;
            return;
        }

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
