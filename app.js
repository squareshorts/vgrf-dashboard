/**
 * app.js
 * Main entry point.
 * Handles data sources (Simulator, WiFi WebSocket, Bluetooth BLE, Web Serial)
 * and routes all IMU data through ImuProcessor (dsp.js) before chart update.
 */

document.addEventListener('DOMContentLoaded', () => {

    /* ══════════════════════════════════════════════
       Core Instances
    ══════════════════════════════════════════════ */
    const simulator    = new VGRFSimulator();
    const imuProcessor = new ImuProcessor();
    const chartManager = new ChartManager();
    const uiManager    = new UIManager(simulator, imuProcessor);

    // Sync initial weight from form into processor and simulator
    const initWeight = parseFloat(document.getElementById('pat-weight')?.value) || 70;
    imuProcessor.setMass(initWeight);
    simulator.setMass(initWeight);

    /* ══════════════════════════════════════════════
       State
    ══════════════════════════════════════════════ */
    let activeSource     = 'simulator';
    let ws               = null;
    let wsConnected      = false;
    let serialPort       = null;
    let serialReader     = null;
    let isSerialReading  = false;
    let bleDevice        = null;
    let bleChar          = null;
    let streamBuffer     = '';
    let externalTime     = 0;

    /* ══════════════════════════════════════════════
       Simulator Animation Loop
    ══════════════════════════════════════════════ */
    let lastTime        = performance.now();
    let accumulatedTime = 0;
    const TIME_STEP     = 10;   // ms  (100 Hz)

    function animate(now) {
        if (activeSource !== 'simulator') return;

        const dt = now - lastTime;
        lastTime  = now;
        accumulatedTime += dt;

        const n = Math.floor(accumulatedTime / TIME_STEP);
        if (n > 0) {
            const samples = [];
            for (let i = 0; i < n; i++) {
                const raw = simulator.nextSample();
                // Pipe IMU through the full DSP pipeline
                const forces = imuProcessor.process(raw.imu);
                samples.push({
                    time: raw.time,
                    fz: { reference: raw.ref.fz, raw: forces.fz.raw, adapted: forces.fz.adapted },
                    fy: { reference: raw.ref.fy, raw: forces.fy.raw, adapted: forces.fy.adapted },
                    fx: { reference: raw.ref.fx, raw: forces.fx.raw, adapted: forces.fx.adapted },
                });
            }
            chartManager.updateData(samples);
            accumulatedTime -= n * TIME_STEP;
        }
        requestAnimationFrame(animate);
    }

    // Boot in Simulator mode
    chartManager.setReferenceVisible(true);
    imuProcessor.warmStart();
    requestAnimationFrame(animate);

    /* ══════════════════════════════════════════════
       Data Source Selector
    ══════════════════════════════════════════════ */
    const sourceSelect    = document.getElementById('data-source');
    const wsSettings      = document.getElementById('ws-settings');
    const bleSettings     = document.getElementById('ble-settings');
    const serialSettings  = document.getElementById('serial-settings');
    const statusText      = document.getElementById('status-text');
    const statusDot       = document.getElementById('status-dot');

    sourceSelect.addEventListener('change', async e => {
        const src = e.target.value;
        activeSource = src;

        // Tear down existing connections
        disconnectWs();
        await disconnectSerial();
        await disconnectBle();

        // Show/hide source-specific panels
        wsSettings.style.display     = src === 'websocket'  ? 'flex' : 'none';
        bleSettings.style.display    = src === 'bluetooth'  ? 'block' : 'none';
        serialSettings.style.display = src === 'serial'     ? 'block' : 'none';

        chartManager.setReferenceVisible(src === 'simulator');
        imuProcessor.reset();
        chartManager.clear();
        streamBuffer = '';

        if (src === 'simulator') {
            setStatus('Simulator Active', true);
            lastTime = performance.now();
            requestAnimationFrame(animate);
        } else if (src === 'websocket') {
            setStatus('Raspberry Pi — Disconnected', false);
        } else if (src === 'bluetooth') {
            setStatus('Bluetooth BLE — Ready', false);
        } else if (src === 'serial') {
            setStatus('USB Serial — Ready', false);
        }
    });

    // Boot with WiFi as default UI (but simulator as active source)
    wsSettings.style.display = 'flex';
    // Trigger change to set correct UI state without changing active source
    sourceSelect.value = 'simulator';

    /* ══════════════════════════════════════════════
       Helper: Status Indicator
    ══════════════════════════════════════════════ */
    function setStatus(msg, active) {
        if (statusText) statusText.textContent = msg;
        if (statusDot) {
            statusDot.style.background = active ? '#10b981' : '#64748b';
            statusDot.classList.toggle('pulse', active);
        }
    }

    /* ══════════════════════════════════════════════
       Shared Text-Stream Parser
       Accepts: JSON  {ax,ay,az,gx,gy,gz}
                CSV   ax,ay,az,gx,gy,gz\n
                Compact  fz_raw,fy_raw,fx_raw\n  (3 values)
    ══════════════════════════════════════════════ */
    function processText(text, source) {
        if (activeSource !== source) return;
        streamBuffer += text;
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop();

        const samples = [];
        for (const line of lines) {
            const s = line.trim();
            if (!s) continue;
            try {
                samples.push(parsePayload(s));
            } catch (e) {
                console.warn(`[${source}] Skipping malformed line:`, s);
            }
        }
        if (samples.length) chartManager.updateData(samples);
    }

    function parsePayload(raw) {
        externalTime += 0.01;
        const t = externalTime.toFixed(2);

        let data;
        if (raw.startsWith('{')) {
            data = JSON.parse(raw);
        } else {
            const parts = raw.split(',').map(Number);
            if (parts.length >= 6) {
                // Full IMU: ax,ay,az,gx,gy,gz
                data = { ax: parts[0], ay: parts[1], az: parts[2],
                         gx: parts[3], gy: parts[4], gz: parts[5] };
            } else if (parts.length === 3) {
                // Pre-computed forces: fz,fy,fx (raw estimates)
                return {
                    time: t,
                    fz: { raw: parts[0], adapted: parts[0] * 0.85 },
                    fy: { raw: parts[1], adapted: parts[1] * 0.85 },
                    fx: { raw: parts[2], adapted: parts[2] * 0.85 },
                };
            } else if (parts.length === 1) {
                // Single vertical force value (legacy / simple sensor)
                return {
                    time: t,
                    fz: { raw: parts[0], adapted: parts[0] * 0.85 },
                    fy: { raw: 0, adapted: 0 },
                    fx: { raw: 0, adapted: 0 },
                };
            }
        }

        // Route through ImuProcessor if we have IMU channels
        if (data && 'ax' in data) {
            const forces = imuProcessor.process({
                ax: data.ax ?? 0, ay: data.ay ?? 0, az: data.az ?? 1,
                gx: data.gx ?? 0, gy: data.gy ?? 0, gz: data.gz ?? 0,
            });
            return {
                time: t,
                fz: { raw: forces.fz.raw, adapted: forces.fz.adapted },
                fy: { raw: forces.fy.raw, adapted: forces.fy.adapted },
                fx: { raw: forces.fx.raw, adapted: forces.fx.adapted },
            };
        }

        // Fallback: data already has force fields
        return {
            time: t,
            fz: { raw: Number(data.fz ?? data.raw ?? 0), adapted: Number(data.fz_adapted ?? data.adapted ?? 0) },
            fy: { raw: Number(data.fy ?? 0),             adapted: Number(data.fy_adapted ?? 0) },
            fx: { raw: Number(data.fx ?? 0),             adapted: Number(data.fx_adapted ?? 0) },
        };
    }

    /* ══════════════════════════════════════════════
       Raspberry Pi WiFi — WebSocket
    ══════════════════════════════════════════════ */
    const btnConnectWs = document.getElementById('btn-connect-ws');
    const wsStatusBadge = document.getElementById('ws-status');

    btnConnectWs?.addEventListener('click', () => {
        if (wsConnected) {
            disconnectWs();
        } else {
            sourceSelect.value = 'websocket';
            sourceSelect.dispatchEvent(new Event('change'));
            connectWs();
        }
    });

    function connectWs() {
        if (wsStatusBadge) {
            wsStatusBadge.textContent = 'Connecting…';
            wsStatusBadge.className   = 'status-badge disconnected';
        }
        if (btnConnectWs) btnConnectWs.textContent = 'Disconnect';

        const host = window.location.hostname || 'localhost';
        ws = new WebSocket(`ws://${host}:8765`);

        ws.onopen = () => {
            wsConnected = true;
            imuProcessor.reset();
            streamBuffer = '';
            setStatus(`Raspberry Pi — ${host}:8765`, true);
            if (wsStatusBadge) {
                wsStatusBadge.textContent = `Live · ${host}:8765`;
                wsStatusBadge.className   = 'status-badge connected';
            }
        };

        ws.onmessage = e => {
            if (activeSource !== 'websocket') return;
            try {
                // Accept both text and pre-parsed JSON WebSocket frames
                const text = typeof e.data === 'string' ? e.data : '';
                // Each WebSocket frame is one complete JSON object
                const sample = parsePayload(text.trim());
                chartManager.updateData([sample]);
            } catch (err) {
                console.error('WS parse error:', err);
            }
        };

        ws.onclose = () => {
            wsConnected = false;
            setStatus('Raspberry Pi — Disconnected', false);
            if (wsStatusBadge) {
                wsStatusBadge.textContent = 'Disconnected';
                wsStatusBadge.className   = 'status-badge disconnected';
            }
            if (btnConnectWs) btnConnectWs.textContent = 'Connect to Raspberry Pi';
            // Auto-retry if still in websocket mode
            if (activeSource === 'websocket') {
                setTimeout(connectWs, 3000);
            }
        };

        ws.onerror = () => ws.close();
    }

    function disconnectWs() {
        if (ws) { try { ws.close(); } catch(e) {} ws = null; }
        wsConnected = false;
        if (btnConnectWs) btnConnectWs.textContent = 'Connect to Raspberry Pi';
        if (wsStatusBadge) {
            wsStatusBadge.textContent = 'Disconnected';
            wsStatusBadge.className   = 'status-badge disconnected';
        }
    }

    /* ══════════════════════════════════════════════
       Bluetooth BLE
    ══════════════════════════════════════════════ */
    const btnConnectBle = document.getElementById('btn-connect-ble');

    btnConnectBle?.addEventListener('click', async () => {
        if (bleDevice?.gatt?.connected) { await disconnectBle(); return; }
        try {
            btnConnectBle.textContent = 'Connecting…';
            btnConnectBle.disabled    = true;

            const serviceUUIDs = [
                '6e400001-b5a3-f393-e0a9-e50e24dcca9e',   // Nordic UART
                '0000ffe0-0000-1000-8000-00805f9b34fb',   // HM-10
                '19b10000-e8f2-537e-4f6c-d104768a1214',   // Arduino BLE
            ];

            bleDevice = await navigator.bluetooth.requestDevice({
                filters: [
                    { namePrefix: 'IMU'  }, { namePrefix: 'BLE' },
                    { namePrefix: 'vGRF' }, { namePrefix: 'RPi' },
                    { namePrefix: 'Arduino' }, { namePrefix: 'ESP32' },
                ],
                optionalServices: serviceUUIDs,
            });

            const server = await bleDevice.gatt.connect();
            let rxChar = null;
            for (const uuid of serviceUUIDs) {
                try {
                    const svc = await server.getPrimaryService(uuid);
                    const chars = await svc.getCharacteristics();
                    rxChar = chars.find(c => c.properties.notify);
                    if (rxChar) break;
                } catch (_) {}
            }
            if (!rxChar) throw new Error('No notifying UART characteristic found.');

            bleChar = rxChar;
            await bleChar.startNotifications();
            bleChar.addEventListener('characteristicvaluechanged', ev => {
                const text = new TextDecoder().decode(ev.target.value);
                processText(text, 'bluetooth');
            });

            imuProcessor.reset();
            setStatus(`BLE: ${bleDevice.name}`, true);
            btnConnectBle.textContent = 'Disconnect BLE';
            btnConnectBle.disabled    = false;
            btnConnectBle.style.background = 'linear-gradient(135deg,#f43f5e,#e11d48)';

            bleDevice.addEventListener('gattserverdisconnected', async () => {
                await disconnectBle();
                setStatus('BLE Sensor — Link Lost', false);
            });

        } catch (err) {
            alert('Bluetooth failed: ' + err.message);
            await disconnectBle();
        }
    });

    async function disconnectBle() {
        if (bleChar) {
            try { await bleChar.stopNotifications(); } catch(_) {}
            bleChar = null;
        }
        if (bleDevice?.gatt?.connected) bleDevice.gatt.disconnect();
        bleDevice = null;
        if (btnConnectBle) {
            btnConnectBle.textContent  = 'Connect Bluetooth BLE';
            btnConnectBle.disabled     = false;
            btnConnectBle.style.background = '';
        }
    }

    /* ══════════════════════════════════════════════
       Web Serial (USB / COM)
    ══════════════════════════════════════════════ */
    const btnConnectSerial = document.getElementById('btn-connect-serial');

    btnConnectSerial?.addEventListener('click', async () => {
        if (isSerialReading) { await disconnectSerial(); return; }
        try {
            serialPort = await navigator.serial.requestPort();
            await serialPort.open({ baudRate: 115200 });
            isSerialReading = true;
            imuProcessor.reset();
            setStatus('USB Serial — Streaming', true);
            btnConnectSerial.textContent = 'Disconnect USB';
            btnConnectSerial.style.background = 'linear-gradient(135deg,#f43f5e,#e11d48)';
            readSerial();
        } catch (err) {
            alert('Serial failed: ' + err.message);
        }
    });

    async function readSerial() {
        const decoder = new TextDecoderStream();
        serialPort.readable.pipeTo(decoder.writable);
        serialReader = decoder.readable.getReader();
        try {
            while (isSerialReading) {
                const { value, done } = await serialReader.read();
                if (done) break;
                processText(value, 'serial');
            }
        } catch (err) {
            console.error('Serial error:', err);
        } finally {
            serialReader.releaseLock();
        }
    }

    async function disconnectSerial() {
        isSerialReading = false;
        if (serialReader) { try { await serialReader.cancel(); } catch(_){} serialReader = null; }
        if (serialPort)   { try { await serialPort.close();    } catch(_){} serialPort   = null; }
        if (btnConnectSerial) {
            btnConnectSerial.textContent = 'Connect USB Sensor';
            btnConnectSerial.style.background = '';
        }
    }

});
