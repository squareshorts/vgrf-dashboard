/**
 * dsp.js
 * Digital Signal Processing module for MPU-6050 IMU data.
 *
 * Pipeline:
 *   Raw IMU (ax, ay, az in g;  gx, gy, gz in deg/s, @ 100 Hz)
 *   → 4th-order causal Butterworth LPF at 10 Hz (2 cascaded Direct-Form-II biquads)
 *   → Complementary Filter → roll, pitch
 *   → Gravity removal + body-to-world rotation
 *   → F = m × a_linear  →  {Fx, Fy, Fz} in Newtons
 */

/* ──────────────────────────────────────────────────────────────────────────
   BiquadFilter  —  single Direct-Form-II Transposed second-order section
   ────────────────────────────────────────────────────────────────────────── */
class BiquadFilter {
    /**
     * @param {number} b0,b1,b2  Numerator coefficients
     * @param {number} a1,a2     Denominator (a0 = 1 implied)
     */
    constructor(b0, b1, b2, a1, a2) {
        this.b0 = b0; this.b1 = b1; this.b2 = b2;
        this.a1 = a1; this.a2 = a2;
        this.w1 = 0.0;   // delay-line state
        this.w2 = 0.0;
    }

    process(x) {
        const y   = this.b0 * x + this.w1;
        this.w1   = this.b1 * x - this.a1 * y + this.w2;
        this.w2   = this.b2 * x - this.a2 * y;
        return y;
    }

    /** Warm-start the filter to avoid the initial transient. */
    init(x0) {
        // Steady-state fill: equivalent to processing an infinite stream of x0
        const gain_dc = (this.b0 + this.b1 + this.b2) / (1.0 + this.a1 + this.a2);
        const y0 = gain_dc * x0;
        // Back-solve Direct-Form-II states from y0
        this.w1 = (this.b1 - this.a1 * this.b0) * x0;
        this.w2 = (this.b2 - this.a2 * this.b0) * x0;
    }

    reset() { this.w1 = 0.0; this.w2 = 0.0; }
}

/* ──────────────────────────────────────────────────────────────────────────
   Butterworth4LP  —  4th-order Butterworth LPF, fc=10 Hz, fs=100 Hz
   Implemented as two cascaded biquad sections.

   Coefficients derived analytically via bilinear transform with pre-warping:
     ωd = 2·fs·tan(π·fc/fs) = 200·tan(π·0.1) = 64.984 rad/s
     k  = ωd/(2·fs) = 0.32492

   Analog 4th-order Butterworth prototype quadratics:
     Q1: s² + 0.76537·s + 1   (α = 0.76537, Q = 1.307)
     Q2: s² + 1.84776·s + 1   (α = 1.84776, Q = 0.541)

   Digital section coefficients (DC-gain normalised, each section gain = 1):
     Section 1 denominator: [1 + B1 + C, -(2-2C), 1 - B1 + C]
       B1 = α₁·k = 0.24869,  C = k² = 0.10557
     Section 2 denominator: [1 + B2 + C, -(2-2C), 1 - B2 + C]
       B2 = α₂·k = 0.60035

   Verified: |H(j·2π·10)| at z=exp(j·2π·10/100) ≈ 0.707 (−3 dB ✓)
   ────────────────────────────────────────────────────────────────────────── */
class Butterworth4LP {
    constructor() {
        // Section 1  (lower damping → higher Q)
        this.s1 = new BiquadFilter(
             0.07796,  0.15592,  0.07796,
            -1.32085,  0.63276
        );
        // Section 2  (higher damping → lower Q)
        this.s2 = new BiquadFilter(
             0.06187,  0.12374,  0.06187,
            -1.04861,  0.29614
        );
    }

    process(x) {
        return this.s2.process(this.s1.process(x));
    }

    /** Initialise both sections at DC value x0 (removes start-up transient). */
    init(x0) {
        this.s1.init(x0);
        // the output of s1 at DC is the DC gain of s1 × x0 ≈ x0 (gain ≈ 1)
        const dc_s1 = (0.07796 + 0.15592 + 0.07796) / (1 - 1.32085 + 0.63276);
        this.s2.init(dc_s1 * x0);
    }

    reset() { this.s1.reset(); this.s2.reset(); }
}

/* ──────────────────────────────────────────────────────────────────────────
   ComplementaryFilter  —  orientation from accel + gyro
   ────────────────────────────────────────────────────────────────────────── */
class ComplementaryFilter {
    /**
     * @param {number} alpha   Gyro blending weight (0.98 recommended @ 100 Hz)
     * @param {number} dt      Sample period in seconds (0.01 for 100 Hz)
     */
    constructor(alpha = 0.98, dt = 0.01) {
        this.alpha = alpha;
        this.dt    = dt;
        this.roll  = 0.0;   // rotation around X (rad)
        this.pitch = 0.0;   // rotation around Y (rad)
        this._init = false;
    }

    /**
     * Update orientation estimate.
     * @param {number} ax,ay,az   Filtered accel (g)
     * @param {number} gx,gy      Filtered gyro (deg/s)
     * @returns {{ roll, pitch }} in radians
     */
    update(ax, ay, az, gx, gy) {
        const D2R = Math.PI / 180.0;

        // Accelerometer-based tilt (stable but noisy)
        const accel_roll  = Math.atan2(ay, az);
        const accel_pitch = Math.atan2(-ax, Math.sqrt(ay * ay + az * az));

        if (!this._init) {
            // Cold start: seed from accelerometer immediately
            this.roll  = accel_roll;
            this.pitch = accel_pitch;
            this._init = true;
        }

        // Gyro integration step
        const gx_rad = gx * D2R;
        const gy_rad = gy * D2R;

        // Complementary blend
        this.roll  = this.alpha * (this.roll  + gx_rad * this.dt)
                   + (1 - this.alpha) * accel_roll;
        this.pitch = this.alpha * (this.pitch + gy_rad * this.dt)
                   + (1 - this.alpha) * accel_pitch;

        return { roll: this.roll, pitch: this.pitch };
    }

    reset() { this.roll = 0.0; this.pitch = 0.0; this._init = false; }
}

/* ──────────────────────────────────────────────────────────────────────────
   ImuProcessor  —  full pipeline: raw MPU-6050 → {Fx, Fy, Fz} (N)
   ────────────────────────────────────────────────────────────────────────── */
class ImuProcessor {
    constructor() {
        this.G     = 9.81;    // m/s²
        this.massKg = 70.0;   // updated from patient form

        // One Butterworth LPF per channel
        this._filt = {
            ax: new Butterworth4LP(),
            ay: new Butterworth4LP(),
            az: new Butterworth4LP(),
            gx: new Butterworth4LP(),
            gy: new Butterworth4LP(),
            gz: new Butterworth4LP(),
        };

        this._fusion = new ComplementaryFilter(0.98, 0.01);
        this._ready  = false;
    }

    /** Update patient mass (kg). */
    setMass(kg) {
        this.massKg = Math.max(1, parseFloat(kg) || 70.0);
    }

    /**
     * Warm-start all filters with an initial quiescent sample so the
     * first real samples don't trigger a large transient.
     * Call once when source is first connected.
     */
    warmStart(initial = { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 }) {
        for (const ch of ['ax', 'ay', 'az', 'gx', 'gy', 'gz']) {
            this._filt[ch].init(initial[ch]);
        }
        this._fusion.reset();
        this._ready = true;
    }

    /**
     * Process one IMU sample.
     * Input: { ax, ay, az (g units), gx, gy, gz (deg/s) }
     * Output: { fz, fy, fx }  each = { raw (N), adapted (N) }
     */
    process(raw) {
        if (!this._ready) this.warmStart(raw);

        // ── 1. Low-pass filter ────────────────────────────────────────────
        const ax_f = this._filt.ax.process(raw.ax);
        const ay_f = this._filt.ay.process(raw.ay);
        const az_f = this._filt.az.process(raw.az);
        const gx_f = this._filt.gx.process(raw.gx);
        const gy_f = this._filt.gy.process(raw.gy);
        this._filt.gz.process(raw.gz);   // filtered but not used further

        // ── 2. Orientation (roll, pitch) ──────────────────────────────────
        const { roll, pitch } = this._fusion.update(ax_f, ay_f, az_f, gx_f, gy_f);

        // ── 3. Gravity vector in body frame ───────────────────────────────
        const sinP = Math.sin(pitch);
        const cosP = Math.cos(pitch);
        const sinR = Math.sin(roll);
        const cosR = Math.cos(roll);

        const g_x = -sinP;
        const g_y =  sinR * cosP;
        const g_z =  cosR * cosP;

        // ── 4. Linear acceleration (gravity removed), body frame → m/s² ──
        const G = this.G;
        const a_lin_x = (ax_f - g_x) * G;
        const a_lin_y = (ay_f - g_y) * G;
        const a_lin_z = (az_f - g_z) * G;

        // ── 5. GRF components (Newton's 3rd law) ─────────────────────────
        const m = this.massKg;
        const fz_raw = m * a_lin_z + m * G;  // vertical: dynamic + quasi-static weight
        const fy_raw = m * a_lin_y;           // anterior-posterior
        const fx_raw = m * a_lin_x;           // medio-lateral

        // ── 6. Adapted model (affine calibration correction) ──────────────
        const { scale, bz } = this._adaptParams();
        const fz_adapted = fz_raw * scale + bz;
        const fy_adapted = fy_raw * scale;
        const fx_adapted = fx_raw * scale;

        return {
            fz: { raw: fz_raw,  adapted: fz_adapted },
            fy: { raw: fy_raw,  adapted: fy_adapted },
            fx: { raw: fx_raw,  adapted: fx_adapted },
        };
    }

    /** Adaptation scale and bias per calibration budget selection. */
    _adaptParams() {
        const budgetEl = document.getElementById('calibration-budget');
        const budget   = budgetEl ? parseInt(budgetEl.value) : 20;
        // Scale: how much the adapted model corrects the raw underestimation
        const scaleMap  = { 5: 0.68, 10: 0.75, 20: 0.85, 50: 0.93 };
        const scale     = scaleMap[budget] ?? 0.85;
        const m         = this.massKg;
        const bz        = m * this.G * (1 - scale);   // vertical offset to restore mean
        return { scale, bz };
    }

    reset() {
        for (const f of Object.values(this._filt)) f.reset();
        this._fusion.reset();
        this._ready = false;
    }
}

/* ── Exports ──────────────────────────────────────────────────────────────── */
window.BiquadFilter        = BiquadFilter;
window.Butterworth4LP      = Butterworth4LP;
window.ComplementaryFilter = ComplementaryFilter;
window.ImuProcessor        = ImuProcessor;
