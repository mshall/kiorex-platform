#!/usr/bin/env bash
# Deliver a real-format APNs payload to the booted iOS simulator (no APNs credentials needed): ./e2e-push/send.sh appointment
# Types: appointment | results | pharmacy-order | lab-booking | telemedicine. Requires the dev build (com.kiorex.app) installed.
# Tap behaviour to verify: foreground banner tap, background tap, and cold start (terminate the app first: xcrun simctl terminate booted com.kiorex.app).
set -euo pipefail
cd "$(dirname "$0")"
xcrun simctl push booted com.kiorex.app "${1:?usage: send.sh <appointment|results|pharmacy-order|lab-booking|telemedicine>}.json"
