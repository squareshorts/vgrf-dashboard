/**
 * app.js
 * Main entry point. Initializes simulator, chart, and UI, and runs the animation loop.
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Simulator
    const simulator = new VGRFSimulator();
    
    // 2. Initialize UI Manager
    const uiManager = new UIManager(simulator);
    
    // 3. Initialize Chart Manager
    const chartManager = new ChartManager('vgrfChart');

    // 4. Main Animation Loop (Simulation at 100Hz = 10ms per frame conceptually)
    // To keep it smooth in browser, we can generate ~2 samples per frame (since requestAnimationFrame is ~60Hz)
    // 60fps * 1.66 samples = ~100Hz.
    
    let lastTime = performance.now();
    let accumulatedTime = 0;
    const TIME_STEP = 10; // ms (100Hz)

    function animate(currentTime) {
        const deltaTime = currentTime - lastTime;
        lastTime = currentTime;
        accumulatedTime += deltaTime;

        let samplesToGenerate = Math.floor(accumulatedTime / TIME_STEP);
        
        if (samplesToGenerate > 0) {
            const newSamples = [];
            for (let i = 0; i < samplesToGenerate; i++) {
                newSamples.push(simulator.nextSample());
            }
            
            // Batch update the chart
            chartManager.updateData(newSamples);
            
            accumulatedTime -= samplesToGenerate * TIME_STEP;
        }

        requestAnimationFrame(animate);
    }

    // Start Loop
    requestAnimationFrame(animate);
});
