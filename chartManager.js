/**
 * chartManager.js
 * Manages three real-time Chart.js panels: Fz (vertical), Fy (A-P), Fx (M-L).
 * Each panel shows Reference (force plate), Raw IMU estimate, Adapted model.
 */

/** Configuration per force component */
const COMPONENT_CONFIG = {
    fz: {
        label:   'Vertical GRF (Fz)',
        unit:    'N',
        yMin:    -50,
        yMax:    1200,
        colors:  {
            ref:     'rgba(255,255,255,0.85)',
            raw:     '#f43f5e',
            adapted: '#10b981',
        },
    },
    fy: {
        label:   'Anterior-Posterior (Fy)',
        unit:    'N',
        yMin:    -350,
        yMax:    350,
        colors:  {
            ref:     'rgba(255,255,255,0.85)',
            raw:     '#f97316',
            adapted: '#38bdf8',
        },
    },
    fx: {
        label:   'Medio-Lateral (Fx)',
        unit:    'N',
        yMin:    -200,
        yMax:    200,
        colors:  {
            ref:     'rgba(255,255,255,0.85)',
            raw:     '#a78bfa',
            adapted: '#fbbf24',
        },
    },
};

/* ──────────────────────────────────────────────────────────────────────────
   ComponentChart  —  one Chart.js instance for one force component
   ────────────────────────────────────────────────────────────────────────── */
class ComponentChart {
    constructor(canvasId, key) {
        const cfg = COMPONENT_CONFIG[key];
        this.key          = key;
        this.maxPoints    = 300;   // 3 s @ 100 Hz
        this._refVisible  = true;

        this.chart = new Chart(
            document.getElementById(canvasId).getContext('2d'),
            {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Reference (Force Plate)',
                            borderColor: cfg.colors.ref,
                            backgroundColor: 'transparent',
                            borderWidth: 1.5,
                            pointRadius: 0,
                            tension: 0.3,
                            data: [],
                        },
                        {
                            label: 'Raw IMU Estimate',
                            borderColor: cfg.colors.raw,
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            pointRadius: 0,
                            tension: 0.3,
                            data: [],
                        },
                        {
                            label: 'Adapted Model',
                            borderColor: cfg.colors.adapted,
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            pointRadius: 0,
                            tension: 0.3,
                            data: [],
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    normalized: true,
                    interaction: { mode: 'nearest', axis: 'x', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false },
                    },
                    scales: {
                        x: { type: 'category', display: false },
                        y: {
                            min: cfg.yMin,
                            max: cfg.yMax,
                            grid: {
                                color: 'rgba(255,255,255,0.06)',
                                drawBorder: false,
                            },
                            ticks: {
                                color: '#64748b',
                                font: { family: 'Inter', size: 10 },
                                callback: v => `${v} N`,
                                maxTicksLimit: 6,
                            },
                            title: {
                                display: true,
                                text: cfg.label + ' (N)',
                                color: '#64748b',
                                font: { family: 'Inter', size: 11 },
                            },
                        },
                    },
                },
            }
        );
    }

    /**
     * Push one time-step of data.
     * @param {object} d  { time, reference?, raw, adapted }
     */
    push(d) {
        const { labels, datasets } = this.chart.data;

        labels.push(d.time);
        datasets[0].data.push(d.reference ?? null);   // null = gap in line
        datasets[1].data.push(d.raw);
        datasets[2].data.push(d.adapted);

        if (labels.length > this.maxPoints) {
            labels.shift();
            datasets[0].data.shift();
            datasets[1].data.shift();
            datasets[2].data.shift();
        }
    }

    render() { this.chart.update('none'); }

    setReferenceVisible(visible) {
        this.chart.data.datasets[0].hidden = !visible;
        this._refVisible = visible;
    }

    clear() {
        this.chart.data.labels = [];
        this.chart.data.datasets.forEach(ds => ds.data = []);
        this.chart.update('none');
    }
}

/* ──────────────────────────────────────────────────────────────────────────
   ChartManager  —  owns all three ComponentChart instances
   ────────────────────────────────────────────────────────────────────────── */
class ChartManager {
    constructor() {
        this.fz = new ComponentChart('fzChart', 'fz');
        this.fy = new ComponentChart('fyChart', 'fy');
        this.fx = new ComponentChart('fxChart', 'fx');
        this._panels = [this.fz, this.fy, this.fx];
    }

    /**
     * Push a multi-component sample and redraw all charts.
     * @param {Array} samples  Array of { time, fz, fy, fx } where each
     *   component = { reference?, raw, adapted }
     */
    updateData(samples) {
        for (const s of samples) {
            const t = s.time;

            this.fz.push({ time: t, reference: s.fz?.reference, raw: s.fz?.raw ?? 0, adapted: s.fz?.adapted ?? 0 });
            this.fy.push({ time: t, reference: s.fy?.reference, raw: s.fy?.raw ?? 0, adapted: s.fy?.adapted ?? 0 });
            this.fx.push({ time: t, reference: s.fx?.reference, raw: s.fx?.raw ?? 0, adapted: s.fx?.adapted ?? 0 });
        }

        // Batch render all three charts
        this.fz.render();
        this.fy.render();
        this.fx.render();
    }

    setReferenceVisible(visible) {
        this._panels.forEach(p => p.setReferenceVisible(visible));
    }

    clear() {
        this._panels.forEach(p => p.clear());
    }
}

window.ComponentChart = ComponentChart;
window.ChartManager   = ChartManager;
window.COMPONENT_CONFIG = COMPONENT_CONFIG;
