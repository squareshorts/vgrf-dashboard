/**
 * simulator.js
 * Generates synthetic vGRF data mimicking human walking at 100 Hz.
 * Creates an M-shaped curve for stance phase and zero for swing phase.
 */

class VGRFSimulator {
    constructor() {
        this.sampleRate = 100; // 100 Hz as per manuscript
        this.t = 0;
        this.stanceDuration = 60; // 600ms stance
        this.swingDuration = 40;  // 400ms swing
        this.cycleLength = this.stanceDuration + this.swingDuration;
        this.currentStep = 0;
        
        // Base errors for 20-step budget (default)
        this.setBudget(20);
    }

    setBudget(budgetSteps) {
        // According to the manuscript, Random Forest RMSE is roughly:
        // Raw: ~178N
        // Adapted 5 steps: ~62N
        // Adapted 10 steps: ~68N
        // Adapted 20 steps: ~58N
        // Adapted 50 steps: ~46N
        this.budget = parseInt(budgetSteps);
        
        // Raw model systematically misses the peak (underestimates loading)
        this.rawPeakError = 175; 
        
        // Adapted model error varies by budget
        switch(this.budget) {
            case 5: this.adaptPeakError = 62; break;
            case 10: this.adaptPeakError = 68; break;
            case 20: this.adaptPeakError = 58; break;
            case 50: this.adaptPeakError = 46; break;
            default: this.adaptPeakError = 58;
        }
    }

    // Mathematical approximation of the "M" shape vGRF
    generateStanceCurve(progress) {
        // progress is 0 to 1
        // Peak 1 (Heel Strike) ~ 1.1 - 1.2 BW (say 800N)
        // Valley (Mid Stance) ~ 0.7 - 0.8 BW (say 550N)
        // Peak 2 (Toe Off) ~ 1.1 - 1.2 BW (say 850N)
        
        const peak1 = 800;
        const valley = 550;
        const peak2 = 850;
        
        // Using a combination of sines to create the shape
        // It's a crude but visually effective mock
        const p1 = Math.sin(progress * Math.PI) * peak1 * Math.exp(-Math.pow(progress - 0.2, 2) * 20);
        const p2 = Math.sin(progress * Math.PI) * peak2 * Math.exp(-Math.pow(progress - 0.8, 2) * 20);
        const mid = Math.sin(progress * Math.PI) * valley * Math.exp(-Math.pow(progress - 0.5, 2) * 10);
        
        return Math.max(0, p1 + p2 + mid);
    }

    nextSample() {
        const cycleProgress = this.t % this.cycleLength;
        
        let refValue = 0;
        let rawValue = 0;
        let adaptValue = 0;

        if (cycleProgress < this.stanceDuration) {
            // Stance phase
            const stanceProgress = cycleProgress / this.stanceDuration;
            refValue = this.generateStanceCurve(stanceProgress);
            
            // Add some high frequency noise to reference
            refValue += (Math.random() - 0.5) * 15;

            // Raw model tends to smooth out and underestimate peaks (the "peak-load problem")
            // We'll apply a scaling factor and lower the peak, simulating the RMSE
            const rawScale = 1 - (this.rawPeakError / 850); 
            rawValue = refValue * rawScale;
            // Add some modeling error (smoother, lags a bit, or just random noise)
            rawValue += Math.sin(stanceProgress * Math.PI) * 20 + (Math.random() - 0.5) * 10;

            // Adapted model is an affine transform: a*raw + b
            // We simulate this by making it much closer to reference
            const adaptScale = 1 - (this.adaptPeakError / 850);
            adaptValue = refValue * adaptScale;
            // Adapted has less error
            adaptValue += (Math.random() - 0.5) * 8;
            
        } else {
            // Swing phase (noise floor)
            refValue = Math.random() * 5;
            rawValue = Math.random() * 8;
            adaptValue = Math.random() * 6;
            
            if (cycleProgress === this.cycleLength - 1) {
                this.currentStep++;
            }
        }

        this.t++;
        
        return {
            time: (this.t / this.sampleRate).toFixed(2),
            reference: Math.max(0, refValue),
            raw: Math.max(0, rawValue),
            adapted: Math.max(0, adaptValue)
        };
    }
}

window.VGRFSimulator = VGRFSimulator;
