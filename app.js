/**
 * app.js
 * Main entry point. Handles data sources (Simulator, Web Serial, WebSocket)
 * and updates chart & metrics in real-time.
 */

document.addEventListener('DOMContentLoaded', () => {
    const simulator = new VGRFSimulator();
    const chartManager = new ChartManager('vgrfChart');
    const uiManager = new UIManager(simulator);

    let activeSource = 'simulator'; // 'simulator', 'serial', or 'websocket'
    let ws = null;
    let serialPort = null;
    let serialReader = null;
    let isSerialReading = false;

    // Timekeeping for simulator loop
    let lastTime = performance.now();
    let accumulatedTime = 0;
    const TIME_STEP = 10; // ms (100Hz)

    // Animation loop for Simulator
    function animate(currentTime) {
        if (activeSource !== 'simulator') return;

        const deltaTime = currentTime - lastTime;
        lastTime = currentTime;
        accumulatedTime += deltaTime;

        let samplesToGenerate = Math.floor(accumulatedTime / TIME_STEP);
        
        if (samplesToGenerate > 0) {
            const newSamples = [];
            for (let i = 0; i < samplesToGenerate; i++) {
                newSamples.push(simulator.nextSample());
            }
            chartManager.updateData(newSamples);
            accumulatedTime -= samplesToGenerate * TIME_STEP;
        }

        requestAnimationFrame(animate);
    }

    // Start default Simulator loop
    requestAnimationFrame(animate);

    // Handle Data Source Changes
    const sourceSelect = document.getElementById('data-source');
    const serialSettings = document.getElementById('serial-settings');
    const wsSettings = document.getElementById('ws-settings');
    const wsStatus = document.getElementById('ws-status');
    const btnConnectSerial = document.getElementById('btn-connect-serial');
    const statusText = document.querySelector('.status-text');

    sourceSelect.addEventListener('change', async (e) => {
        const source = e.target.value;
        activeSource = source;

        // Reset previous connections
        stopWebSocket();
        await stopSerial();

        // Show/hide relevant settings
        serialSettings.style.display = (source === 'serial') ? 'block' : 'none';
        wsSettings.style.display = (source === 'websocket') ? 'block' : 'none';

        if (source === 'simulator') {
            statusText.innerText = "Receiving Sensor Data (100 Hz)";
            lastTime = performance.now();
            requestAnimationFrame(animate);
        } else if (source === 'websocket') {
            statusText.innerText = "Waiting for WebSocket Stream...";
            startWebSocket();
        } else if (source === 'serial') {
            statusText.innerText = "Ready to connect USB/Serial Sensor";
        }
    });

    // --- WebSocket Stream ---
    function startWebSocket() {
        wsStatus.className = "status-badge disconnected";
        wsStatus.innerText = "Connecting...";
        
        ws = new WebSocket("ws://localhost:8765");

        ws.onopen = () => {
            wsStatus.className = "status-badge connected";
            wsStatus.innerText = "Connected to Port 8765";
            statusText.innerText = "Streaming via WebSocket (Active)";
        };

        ws.onmessage = (event) => {
            if (activeSource !== 'websocket') return;
            try {
                const rawData = JSON.parse(event.data);
                const sample = parseSensorPayload(rawData);
                chartManager.updateData([sample]);
            } catch (err) {
                console.error("Error parsing WebSocket JSON:", err);
            }
        };

        ws.onclose = () => {
            if (activeSource === 'websocket') {
                wsStatus.className = "status-badge disconnected";
                wsStatus.innerText = "Disconnected. Retrying...";
                setTimeout(startWebSocket, 2000); // Auto-retry
            }
        };

        ws.onerror = () => {
            ws.close();
        };
    }

    function stopWebSocket() {
        if (ws) {
            ws.close();
            ws = null;
        }
    }

    // --- Web Serial Stream ---
    btnConnectSerial.addEventListener('click', async () => {
        if (isSerialReading) {
            await stopSerial();
            btnConnectSerial.innerText = "Connect USB Sensor";
            btnConnectSerial.style.background = "";
            statusText.innerText = "USB Sensor Disconnected";
            return;
        }

        try {
            serialPort = await navigator.serial.requestPort();
            await serialPort.open({ baudRate: 115200 });
            isSerialReading = true;
            btnConnectSerial.innerText = "Disconnect USB Sensor";
            btnConnectSerial.style.background = "linear-gradient(135deg, #f43f5e, #e11d48)";
            statusText.innerText = "Streaming via USB Serial (Active)";

            readSerial();
        } catch (err) {
            console.error("Failed to open serial port:", err);
            alert("Could not open serial port. Make sure it's not in use and that you granted permission.");
        }
    });

    async function readSerial() {
        const textDecoder = new TextDecoderStream();
        const readableStreamClosed = serialPort.readable.pipeTo(textDecoder.writable);
        serialReader = textDecoder.readable.getReader();

        let buffer = "";

        try {
            while (isSerialReading) {
                const { value, done } = await serialReader.read();
                if (done) break;
                
                buffer += value;
                const lines = buffer.split("\n");
                buffer = lines.pop(); // Keep incomplete line in buffer

                const samples = [];
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    
                    try {
                        let parsedData;
                        if (trimmed.startsWith("{")) {
                            parsedData = JSON.parse(trimmed);
                        } else {
                            // Assume CSV: ref,raw,adapted OR raw_value
                            const parts = trimmed.split(",").map(Number);
                            if (parts.length >= 3) {
                                parsedData = { reference: parts[0], raw: parts[1], adapted: parts[2] };
                            } else {
                                parsedData = { raw: parts[0] };
                            }
                        }
                        samples.push(parseSensorPayload(parsedData));
                    } catch (e) {
                        console.warn("Skipping malformed line:", trimmed);
                    }
                }

                if (samples.length > 0 && activeSource === 'serial') {
                    chartManager.updateData(samples);
                }
            }
        } catch (err) {
            console.error("Serial read error:", err);
        } finally {
            serialReader.releaseLock();
        }
    }

    async function stopSerial() {
        isSerialReading = false;
        if (serialReader) {
            try {
                await serialReader.cancel();
            } catch(e) {}
            serialReader = null;
        }
        if (serialPort) {
            try {
                await serialPort.close();
            } catch(e) {}
            serialPort = null;
        }
    }

    // Helper: Parse any standard structure into the chart-ready format
    let externalTime = 0;
    function parseSensorPayload(data) {
        externalTime += 0.01;
        const ref = Number(data.reference ?? data.ref ?? 0);
        const raw = Number(data.raw ?? data.value ?? 0);
        
        // If adapted is not provided, dynamically generate it using our current settings
        let adapted = data.adapted;
        if (adapted === undefined) {
            // Simulate model adaptation based on the selected UI budget
            const budget = parseInt(document.getElementById('calibration-budget').value);
            let errorScale = 0.3; // 20 steps
            if (budget === 5) errorScale = 0.5;
            else if (budget === 10) errorScale = 0.4;
            else if (budget === 50) errorScale = 0.25;

            // Generate an adapted estimation mathematically mapping from raw closer to reference
            adapted = raw + (ref - raw) * (1 - errorScale) + (Math.random() - 0.5) * 5;
        }

        return {
            time: externalTime.toFixed(2),
            reference: Math.max(0, ref),
            raw: Math.max(0, raw),
            adapted: Math.max(0, Number(adapted))
        };
    }
});

