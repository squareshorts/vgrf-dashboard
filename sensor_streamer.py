#!/usr/bin/env python
"""
sensor_streamer.py
A simple WebSocket server that feeds simulated (or real) sensor measurements 
to the vGRF diagnostics dashboard in real-time.

Requires: pip install websockets
Usage: python sensor_streamer.py
"""

import asyncio
import json
import random
import time
import math
import sys

# Try importing websockets, offer instructions if missing
try:
    import websockets
except ImportError:
    print("Error: The 'websockets' library is required to run this script.")
    print("Please install it using: pip install websockets")
    sys.exit(1)

PORT = 8765
print(f"Starting vGRF Sensor Streamer on ws://localhost:{PORT}...")

# ----------------- Simulated Human Gait Dynamics Generator -----------------
class GaitSimulator:
    def __init__(self):
        self.t = 0
        self.sample_rate = 100  # 100Hz
        self.stance_len = 60
        self.swing_len = 40
        self.cycle_len = self.stance_len + self.swing_len

    def generate_stance_vgrf(self, progress):
        # Generates standard double-peak "M" shape curve of vGRF
        peak1 = 800
        valley = 550
        peak2 = 850
        p1 = math.sin(progress * math.pi) * peak1 * math.exp(-((progress - 0.2) ** 2) * 20)
        p2 = math.sin(progress * math.pi) * peak2 * math.exp(-((progress - 0.8) ** 2) * 20)
        mid = math.sin(progress * math.pi) * valley * math.exp(-((progress - 0.5) ** 2) * 10)
        return max(0.0, p1 + p2 + mid)

    def next_sample(self):
        cycle_progress = self.t % self.cycle_len
        if cycle_progress < self.stance_len:
            progress = cycle_progress / self.stance_len
            ref = self.generate_stance_vgrf(progress) + random.uniform(-10, 10)
            # Simulate a raw model which has peak underestimation (e.g., -175N peak error)
            raw = ref * 0.78 + random.uniform(-12, 12)
            # Simulate adapted model which corrects the peak load error
            adapted = ref * 0.93 + random.uniform(-6, 6)
        else:
            ref = random.uniform(0, 5)
            raw = random.uniform(0, 8)
            adapted = random.uniform(0, 6)
        
        self.t += 1
        return {
            "reference": max(0.0, round(ref, 2)),
            "raw": max(0.0, round(raw, 2)),
            "adapted": max(0.0, round(adapted, 2))
        }

# ----------------- WebSocket Server Logic -----------------
async def handler(websocket):
    print(f"Dashboard connected: {websocket.remote_address}")
    gait = GaitSimulator()
    
    try:
        while True:
            # 1. Generate new sample at 100Hz (10ms steps)
            sample_data = gait.next_sample()
            
            # 2. Transmit payload as JSON to browser
            await websocket.send(json.dumps(sample_data))
            
            # 3. Precise 100Hz timing (10ms wait)
            await asyncio.sleep(0.01)
            
    except websockets.exceptions.ConnectionClosedOK:
        print(f"Dashboard disconnected normally: {websocket.remote_address}")
    except websockets.exceptions.ConnectionClosedError:
        print(f"Dashboard connection closed unexpectedly: {websocket.remote_address}")
    except Exception as e:
        print(f"Error in stream: {e}")

async def main():
    async with websockets.serve(handler, "localhost", PORT):
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nSensor Streamer stopped.")
