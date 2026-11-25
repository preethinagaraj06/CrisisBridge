# CrisisBridge Offline + Local LAN Kit

This is an academic prototype. It is **not a certified emergency response system** and must not be relied on as the sole channel for real emergencies.

## What this kit enables
- Offline app shell after the first visit/caching on each device.
- Local voice recording and playback in browsers that support MediaRecorder.
- A zero-dependency Node.js relay hosted on one laptop for devices connected to the same working Wi-Fi/LAN, even when that LAN has no internet access.
- Citizen voice/text incidents are sent to the relay; authority clients poll and import incidents. Voice broadcasts are stored on the relay and can be delivered to citizen clients.
- Local data remains available on each device if the relay is unavailable; data created on a disconnected device will not reach other devices until a relay/network path is restored.

## Start the local relay (no npm install required)
1. Install Node.js on the laptop before the event.
2. Open a terminal in the `cbglobal` folder.
3. Run `node server.js`.
4. Open `http://localhost:5000` on the host laptop.
5. Connect other devices to the same Wi-Fi router/access point and open the LAN URL printed in the terminal, for example `http://192.168.x.x:5000`. Allow Node.js through the laptop firewall on the private network if prompted.
6. On every device, open the app once while connected to the local relay, then test with internet disconnected. Keep the host laptop and local Wi-Fi access point powered on.

## Demo logins
- Citizen: `citizen@crisisbridge.demo` / `123456`
- Volunteer: `volunteer@crisisbridge.demo` / `123456`
- Authority: `authority@crisisbridge.demo` / `123456`

## Critical limits
- If the router/access point also fails, this LAN relay cannot communicate between devices. Bluetooth/Wi-Fi Direct/mesh needs a separate native or supported peer-to-peer implementation and device testing; this browser prototype does not magically provide it.
- Each device's offline storage is local. Data on a device with no path to the relay stays queued only on that device until a path returns.
- Voice recordings are original audio. General offline speech recognition/translation is not included; phrasebook/translation helpers are not full translation.
- GPS requires device/browser permissions. Cached schematic maps are not live maps.
- The demo server has no authentication, encryption, access control, durable database guarantees, or high-availability design. Do not expose it to public networks or use it for real emergency dispatch without security, reliability, privacy, and field testing.

## Testing checklist
1. Start the server and open Authority on the host laptop.
2. Open Citizen on another device using the printed LAN URL.
3. Record and submit a short voice report with a clear location.
4. Confirm it appears on the authority incident list and the recording plays.
5. Start a voice broadcast from Authority; confirm Citizen receives the alert and can press Play Voice.
6. Disconnect the internet while leaving the Wi-Fi LAN working; repeat.
7. Turn off Wi-Fi as well: cross-device delivery should fail by design, while local reports remain on each device. Do not interpret this as a passed mesh test.


## Relay token and security warning
The server prints a random relay token in its terminal at startup. Keep it private and enter it when the browser prompts. The token is a demo-level shared secret, not production authentication. Use fictional data only, keep the LAN trusted, and do not expose port 5000 to the public internet. See `SECURITY_AND_GOVERNMENT_READINESS.md`.
