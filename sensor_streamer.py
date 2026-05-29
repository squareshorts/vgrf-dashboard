#!/usr/bin/env python3
"""
sensor_streamer.py
──────────────────
WebSocket server that simulates what the student's Raspberry Pi would send:
  - MPU-6050 raw values already converted to physical units
  - ax, ay, az  in  g
  - gx, gy, gz  in  deg/s
  - 100 Hz streaming rate

Usage (on the PC, for testing):
    pip install websockets
    python sensor_streamer.py

Then in the dashboard select  "Raspberry Pi (WiFi)"  and click
"Connect to Raspberry Pi".  The server listens on  ws://localhost:8765.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STUDENT — RASPBERRY PI CODE TEMPLATE (copy to your RPi)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Install on the RPi:
    pip install mpu6050-raspberrypi websockets

# rpi_streamer.py  ── run this on the Raspberry Pi
import asyncio, json, time
import websockets
from mpu6050 import mpu6050

SAMPLE_RATE = 100          # Hz
HOST        = '0.0.0.0'   # listen on all interfaces
PORT        = 8765

sensor = mpu6050(0x68)     # default I2C address
# Set accel range  ±2g  (MPU6050_ACCEL_RANGE_2G = 0)
sensor.set_accel_range(mpu6050.ACCEL_RANGE_2G)
# Set gyro range   ±250 deg/s  (MPU6050_GYRO_RANGE_250DEG = 0)
sensor.set_gyro_range(mpu6050.GYRO_RANGE_250DEG)

async def stream(ws):
    print(f"Client connected: {ws.remote_address}")
    dt = 1.0 / SAMPLE_RATE
    while True:
        t0 = time.monotonic()
        acc  = sensor.get_accel_data()   # returns {'x':…, 'y':…, 'z':…} in m/s²
        gyro = sensor.get_gyro_data()    # returns {'x':…, 'y':…, 'z':…} in deg/s
        G    = 9.80665
        payload = {
            "ax":  round(acc ['x'] / G, 5),   # convert m/s² → g
            "ay":  round(acc ['y'] / G, 5),
            "az":  round(acc ['z'] / G, 5),
            "gx":  round(gyro['x'],    3),     # already in deg/s
            "gy":  round(gyro['y'],    3),
            "gz":  round(gyro['z'],    3),
            "t":   round(time.time(),  4),
        }
        await ws.send(json.dumps(payload))
        elapsed = time.monotonic() - t0
        await asyncio.sleep(max(0, dt - elapsed))

async def main():
    async with websockets.serve(stream, HOST, PORT):
        print(f"Streaming MPU-6050 on ws://<RPi-IP>:{PORT}  @ {SAMPLE_RATE} Hz")
        await asyncio.Future()

if __name__ == '__main__':
    asyncio.run(main())
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
END STUDENT TEMPLATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import asyncio
import json
import math
import random
import sys
import time

try:
    import websockets
except ImportError:
    print("Install websockets first:  pip install websockets")
    sys.exit(1)

PORT        = 8765
SAMPLE_RATE = 100          # Hz
DT          = 1.0 / SAMPLE_RATE
G           = 9.80665      # m/s²

print(f"vGRF Sensor Streamer  —  ws://localhost:{PORT}  @ {SAMPLE_RATE} Hz")
print("Switch the dashboard to  'Raspberry Pi (WiFi)'  and click Connect.")


# ─── Gait simulator (body-frame IMU signals) ──────────────────────────
class GaitIMU:
    def __init__(self, mass_kg: float = 70.0):
        self.m           = mass_kg
        self.t           = 0          # sample counter
        self.stance_len  = 60
        self.swing_len   = 40
        self.cycle_len   = 100
        self.pitch       = 12 * math.pi / 180   # ~12° forward lean
        self.roll        = 0.0

    def _stance_fz(self, p: float) -> float:
        """M-shaped vertical GRF, progress p in [0,1]."""
        pk1 = self.m * 11.43
        val = self.m * 7.86
        pk2 = self.m * 12.14
        p1  = math.sin(p * math.pi) * pk1 * math.exp(-((p - 0.20) ** 2) * 20)
        p2  = math.sin(p * math.pi) * pk2 * math.exp(-((p - 0.80) ** 2) * 20)
        mid = math.sin(p * math.pi) * val  * math.exp(-((p - 0.50) ** 2) * 10)
        return max(0.0, p1 + p2 + mid)

    def _stance_fy(self, p: float) -> float:
        amp = self.m * 2.14
        return -amp * math.sin(p * math.pi) * math.cos(p * math.pi)

    def _stance_fx(self, p: float) -> float:
        amp = self.m * 0.71
        return amp * math.sin(2 * p * math.pi)

    def next(self) -> dict:
        cp    = self.t % self.cycle_len
        phase = (cp / self.cycle_len) * 2 * math.pi

        # Body pitch/roll oscillation during gait
        pitch = 12 * math.pi / 180 + 3 * math.pi / 180 * math.sin(phase)
        roll  =  4 * math.pi / 180 * math.sin(phase + math.pi / 4)

        if cp < self.stance_len:
            p      = cp / self.stance_len
            fz_ref = self._stance_fz(p)
            fy_ref = self._stance_fy(p)
            fx_ref = self._stance_fx(p)
        else:
            fz_ref = random.uniform(0, 5)
            fy_ref = random.uniform(-10, 10)
            fx_ref = random.uniform(-5, 5)

        # Convert forces to accelerations in body frame
        a_lin_z = (fz_ref / self.m - G) / G       # in g (subtract gravity, normalise)
        a_lin_y = fy_ref / (self.m * G)
        a_lin_x = fx_ref / (self.m * G)

        # Gravity projection onto sensor body frame
        g_x = -math.sin(pitch)
        g_y =  math.sin(roll) * math.cos(pitch)
        g_z =  math.cos(roll) * math.cos(pitch)

        # Angular rates (numeric derivative of pitch/roll)
        dph = (2 * math.pi / self.cycle_len)
        gy_deg =  3 * math.cos(phase) * dph / DT * (180 / math.pi)
        gx_deg = -4 * math.cos(phase + math.pi / 4) * dph / DT * (180 / math.pi)
        gz_deg =  8 * math.sin(phase)

        # MPU-6050 noise levels (datasheet typical values)
        an = 0.004    # g  (accel noise density × sqrt(BW))
        gn = 0.5      # deg/s
        rng = random.gauss

        self.t += 1
        return {
            "ax": round(a_lin_x + g_x + rng(0, an), 5),
            "ay": round(a_lin_y + g_y + rng(0, an), 5),
            "az": round(a_lin_z + g_z + rng(0, an), 5),
            "gx": round(gx_deg + rng(0, gn), 3),
            "gy": round(gy_deg + rng(0, gn), 3),
            "gz": round(gz_deg + rng(0, gn), 3),
            "t":  round(time.time(), 4),
        }


# ─── WebSocket handler ────────────────────────────────────────────────
async def handler(ws):
    addr = ws.remote_address
    print(f"[+] Dashboard connected: {addr}")
    imu = GaitIMU(mass_kg=70.0)
    try:
        while True:
            t0      = time.monotonic()
            payload = imu.next()
            await ws.send(json.dumps(payload))
            elapsed = time.monotonic() - t0
            await asyncio.sleep(max(0, DT - elapsed))
    except websockets.exceptions.ConnectionClosed:
        print(f"[-] Disconnected: {addr}")
    except Exception as e:
        print(f"[!] Error ({addr}): {e}")


async def main():
    async with websockets.serve(handler, "localhost", PORT):
        await asyncio.Future()   # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nStopped.")
