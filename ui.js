/**
 * ui.js
 * Handles UI interactions and metrics updates based on manuscript values.
 */

class UIManager {
    constructor(simulator) {
        this.simulator = simulator;
        
        // DOM Elements
        this.budgetSelect = document.getElementById('calibration-budget');
        this.backboneSelect = document.getElementById('global-backbone');
        
        this.rawRmseEl = document.getElementById('val-raw-rmse');
        this.adaptRmseEl = document.getElementById('val-adapt-rmse');
        this.biasEl = document.getElementById('val-bias');

        this.initEventListeners();
        this.updateMetricsDisplay();
    }

    initEventListeners() {
        this.budgetSelect.addEventListener('change', (e) => {
            const budget = parseInt(e.target.value);
            this.simulator.setBudget(budget);
            this.updateMetricsDisplay();
        });

        this.backboneSelect.addEventListener('change', (e) => {
            this.updateMetricsDisplay();
        });
    }

    updateMetricsDisplay() {
        const budget = parseInt(this.budgetSelect.value);
        const backbone = this.backboneSelect.value;
        
        let raw = 0;
        let adapt = 0;
        let bias = 0;

        // Manuscript Table II values
        if (backbone === 'rf') {
            raw = (budget === 20) ? 177.8 : ((budget === 50) ? 172.6 : 181.4);
            switch(budget) {
                case 5: adapt = 61.6; bias = 1.2; break;
                case 10: adapt = 67.8; bias = -2.3; break;
                case 20: adapt = 58.1; bias = -2.4; break; // Approximated bias from text
                case 50: adapt = 45.8; bias = 2.7; break;
            }
        } else if (backbone === 'gru') {
            raw = (budget === 50) ? 161.3 : ((budget === 20) ? 166.0 : 165.6);
            switch(budget) {
                case 5: adapt = 68.7; bias = -15.4; break;
                case 10: adapt = 67.3; bias = -14.8; break;
                case 20: adapt = 67.2; bias = -15.1; break;
                case 50: adapt = 60.8; bias = -14.2; break;
            }
        } else if (backbone === 'itransformer') {
            raw = (budget === 50) ? 177.3 : ((budget === 20) ? 169.1 : 165.7);
            switch(budget) {
                case 5: adapt = 62.7; bias = -10.2; break;
                case 10: adapt = 60.9; bias = -9.8; break;
                case 20: adapt = 62.1; bias = -8.5; break;
                case 50: adapt = 57.2; bias = -10.9; break;
            }
        }

        // Add small random noise to simulate "live" metric fluctuation
        setInterval(() => {
            const noise = () => (Math.random() - 0.5) * 1.5;
            this.rawRmseEl.innerText = (raw + noise()).toFixed(1) + ' N';
            this.adaptRmseEl.innerText = (adapt + noise()).toFixed(1) + ' N';
            this.biasEl.innerText = (bias + noise()).toFixed(1) + ' N';
        }, 1000);
        
        // Initial set
        this.rawRmseEl.innerText = raw.toFixed(1) + ' N';
        this.adaptRmseEl.innerText = adapt.toFixed(1) + ' N';
        this.biasEl.innerText = bias.toFixed(1) + ' N';
    }
}

window.UIManager = UIManager;
