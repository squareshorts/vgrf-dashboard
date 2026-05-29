/**
 * chartManager.js
 * Handles the Chart.js visualization for real-time vGRF data.
 */

class ChartManager {
    constructor(canvasId) {
        this.ctx = document.getElementById(canvasId).getContext('2d');
        this.maxDataPoints = 300; // 3 seconds at 100Hz
        
        // Setup Chart
        this.chart = new Chart(this.ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Reference (Force Plate)',
                        borderColor: 'rgba(255, 255, 255, 0.8)',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.3,
                        data: []
                    },
                    {
                        label: 'Raw Global Model',
                        borderColor: '#f43f5e',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.3,
                        data: []
                    },
                    {
                        label: 'Adapted Model',
                        borderColor: '#10b981',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.3,
                        data: []
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false, // Turn off for performance on fast updates
                parsing: false, // Optimize for raw data
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: false // We use custom HTML legend
                    },
                    tooltip: {
                        enabled: false // Disable tooltip for pure real-time dashboard performance
                    }
                },
                scales: {
                    x: {
                        type: 'category',
                        display: false // Hide x-axis labels to look like oscilloscope
                    },
                    y: {
                        min: -50,
                        max: 1000,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#94a3b8',
                            font: {
                                family: 'Inter',
                                size: 11
                            },
                            callback: function(value) {
                                return value + ' N';
                            }
                        },
                        title: {
                            display: true,
                            text: 'Vertical Ground Reaction Force (N)',
                            color: '#94a3b8',
                            font: {
                                family: 'Inter',
                                size: 12
                            }
                        }
                    }
                }
            }
        });
    }

    updateData(newDataArray) {
        // newDataArray is an array of data points from simulator
        for (const data of newDataArray) {
            this.chart.data.labels.push(data.time);
            this.chart.data.datasets[0].data.push(data.reference);
            this.chart.data.datasets[1].data.push(data.raw);
            this.chart.data.datasets[2].data.push(data.adapted);

            if (this.chart.data.labels.length > this.maxDataPoints) {
                this.chart.data.labels.shift();
                this.chart.data.datasets[0].data.shift();
                this.chart.data.datasets[1].data.shift();
                this.chart.data.datasets[2].data.shift();
            }
        }
        
        this.chart.update();
    }
}

window.ChartManager = ChartManager;
