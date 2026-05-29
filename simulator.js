/**
 * simulator.js
 * Generates synthetic MPU-6050 raw IMU signals (ax,ay,az in g; gx,gy,gz in deg/s)
 * that mimic normal human walking at 100 Hz, PLUS separate reference GRF values
 * that represent the "force plate ground truth" for demonstration purposes.
 *
 * The raw IMU signals pass through ImuProcessor (dsp.js) to produce estimated
 * force components, demonstrating how the pipeline works end-to-end.
 */
class VGRFSimulator {
    constructor() {
        this.sampleRate    = 100;  // Hz
        this.stanceSamples = 60;   // 600 ms stance
        this.swingSamples  = 40;   // 400 ms swing
        this.cycleLen      = 100;  // total gait cycle
        this.t             = 0;
        this.massKg        = 70.0; // updated from patient form

        this.setBudget(20);
    }

    setMass(kg) {
        this.massKg = Math.max(1, parseFloat(kg) || 70.0);
    }

    setBudget(steps) {
        this.budget = parseInt(steps);
    }

    /* ── Reference force waveforms (simulated force-plate ground truth) ── */

    /** Vertical GRF — classic double-peaked M-shape during stance. */
    _refFz(progress) {
        const m = this.massKg;
        const peak1 = m * 11.43;   // ~1.17 BW peak
        const valley = m * 7.86;   // ~0.80 BW mid-stance dip
        const peak2  = m * 12.14;  // ~1.24 BW push-off peak
        const p1 = Math.sin(progress * Math.PI) * peak1
                   * Math.exp(-Math.pow(progress - 0.20, 2) * 20);
        const p2 = Math.sin(progress * Math.PI) * peak2
                   * Math.exp(-Math.pow(progress - 0.80, 2) * 20);
        const mid = Math.sin(progress * Math.PI) * valley
                    * Math.exp(-Math.pow(progress - 0.50, 2) * 10);
        return Math.max(0, p1 + p2 + mid);
    }

    /** Anterior-posterior GRF — braking then propulsion. */
    _refFy(progress) {
        const m = this.massKg;
        const amp = m * 2.14;   // ~0.22 BW amplitude
        // Negative in first half (braking), positive in second (propulsion)
        return -amp * Math.sin(progress * Math.PI) * Math.cos(progress * Math.PI);
    }

    /** Medio-lateral GRF — small lateral sway. */
    _refFx(progress) {
        const m = this.massKg;
        const amp = m * 0.71;   // ~0.07 BW amplitude
        return amp * Math.sin(2 * progress * Math.PI);
    }

    /* ── Reverse-engineer IMU signals from reference forces ─────────────── */

    /**
     * Convert target force components to what the MPU-6050 would sense,
     * adding realistic sensor noise, angular motion and gravity projection.
     */
    _forceToImu(fz_ref, fy_ref, fx_ref, progress, cycleProgress) {
        const G = 9.81;
        const m = this.massKg;

        // Linear accelerations from Newton: a = F/m  (m/s²) → convert to g
        const a_lin_z = (fz_ref / m - G) / G;   // subtract gravity, normalise
        const a_lin_y =  fy_ref / (m * G);
        const a_lin_x =  fx_ref / (m * G);

        // Simulate body pitch (~10–15° forward lean during walking)
        // and roll oscillation during gait
        const phase = (cycleProgress / this.cycleLen) * 2 * Math.PI;
        const pitch = (12 * Math.PI / 180) + (3 * Math.PI / 180) * Math.sin(phase);
        const roll  = (4  * Math.PI / 180) * Math.sin(phase + Math.PI / 4);

        // Gravity projection onto sensor axes (sensor tilted by pitch/roll)
        const g_x_sensor = -Math.sin(pitch);
        const g_y_sensor =  Math.sin(roll) * Math.cos(pitch);
        const g_z_sensor =  Math.cos(roll) * Math.cos(pitch);

        // Raw accelerometer reading = linear accel + gravity (in sensor frame)
        const ax_clean = a_lin_x + g_x_sensor;
        const ay_clean = a_lin_y + g_y_sensor;
        const az_clean = a_lin_z + g_z_sensor;

        // Angular rates: derivative of pitch/roll + small yaw
        const dPhase = (2 * Math.PI / this.cycleLen);   // rad per sample
        const gy_clean =  (3 * Math.PI / 180) * Math.cos(phase) * dPhase
                          / (1 / this.sampleRate) * (180 / Math.PI);  // deg/s
        const gx_clean = -(4 * Math.PI / 180) * Math.cos(phase + Math.PI / 4)
                          * dPhase / (1 / this.sampleRate) * (180 / Math.PI);
        const gz_clean = 8 * Math.sin(phase);   // small yaw oscillation (deg/s)

        // Sensor noise levels (MPU-6050 datasheet typical)
        const accNoise = 0.004;   // g  RMS
        const gyrNoise = 0.5;     // deg/s RMS
        const rng = () => (Math.random() - 0.5) * 2;  // uniform [-1,1]

        return {
            ax: ax_clean + rng() * accNoise * 3,
            ay: ay_clean + rng() * accNoise * 3,
            az: az_clean + rng() * accNoise * 3,
            gx: gx_clean + rng() * gyrNoise * 3,
            gy: gy_clean + rng() * gyrNoise * 3,
            gz: gz_clean + rng() * gyrNoise * 3,
        };
    }

    /* ── Main sample generator ───────────────────────────────────────────── */

    /**
     * Returns one gait sample at 100 Hz.
     * @returns {{
     *   imu: { ax,ay,az,gx,gy,gz },   ← pipe through ImuProcessor
     *   ref: { fz,fy,fx }             ← force-plate ground truth (sim only)
     * }}
     */
    nextSample() {
        const cycleProgress = this.t % this.cycleLen;
        let ref_fz = 0, ref_fy = 0, ref_fx = 0;
        let imu;

        if (cycleProgress < this.stanceSamples) {
            const progress = cycleProgress / this.stanceSamples;
            ref_fz = this._refFz(progress) + (Math.random() - 0.5) * 15;
            ref_fy = this._refFy(progress) + (Math.random() - 0.5) * 8;
            ref_fx = this._refFx(progress) + (Math.random() - 0.5) * 5;

            imu = this._forceToImu(ref_fz, ref_fy, ref_fx, progress, cycleProgress);
        } else {
            // Swing phase: sensor hanging free, small vibration
            ref_fz = Math.random() * 5;
            ref_fy = (Math.random() - 0.5) * 10;
            ref_fx = (Math.random() - 0.5) * 5;

            imu = {
                ax: (Math.random() - 0.5) * 0.05,
                ay: (Math.random() - 0.5) * 0.08,
                az: 1.0 + (Math.random() - 0.5) * 0.03,
                gx: (Math.random() - 0.5) * 10,
                gy: (Math.random() - 0.5) * 15,
                gz: (Math.random() - 0.5) * 8,
            };
        }

        this.t++;
        return {
            time: ((this.t / this.sampleRate)).toFixed(2),
            imu,
            ref: {
                fz: Math.max(0, ref_fz),
                fy: ref_fy,
                fx: ref_fx,
            }
        };
    }
}

window.VGRFSimulator = VGRFSimulator;
