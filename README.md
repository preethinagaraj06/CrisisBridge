# CrisisBridge

**Offline-first disaster communication and rescue coordination — Academic Prototype**

CrisisBridge is a student-built prototype exploring how emergency reporting and response coordination could remain useful when internet connectivity is unreliable. It brings citizen reports, authority alerts, volunteer coordination, incident prioritization, and local resource information into a single browser-based interface.

The project is designed for demonstration and experimentation. It is **not a certified emergency-response platform** and should not be used as the only channel during a real emergency.

---

## What it can do

- **Role-based demo dashboards** for Citizens, Volunteers, and Authorities
- **Emergency reporting** with incident details, severity, location, and vulnerability information
- **Voice reports and alerts** using browser audio recording and playback
- **Incident prioritization** with local priority scoring and duplicate-report detection
- **Rescue coordination** workflows for volunteer matching, rescue-team assignment, and incident status tracking
- **Shelter and resource management** for demo operations
- **Location support** using browser geolocation when permission and device support are available
- **Offline-first storage** using LocalStorage and IndexedDB
- **Same-device communication** between tabs through browser messaging
- **Local-network relay** for a multi-device demonstration on a shared Wi-Fi/LAN
- **Offline application shell** using a service worker after the app has been opened and cached
- **Emergency phrasebook** for selected phrases and languages
- **Export/import backup** for locally stored demo operational data

---

## Project Status

CrisisBridge is a working academic prototype. Its offline and local-network features have practical limits:

- On one device, browser-local records and supported audio features can operate without internet after the app shell has been cached.
- Multiple devices can exchange demo data over a shared local network when the included Node.js relay is running and the devices can reach the host.
- The relay does not provide communication if the local network itself is unavailable.
- The project does not implement Bluetooth mesh, Wi-Fi Direct, or a general peer-to-peer network.
- Browser speech recognition, GPS, notifications, and storage behaviour depend on browser/device support and permissions.
- The offline map is a schematic fallback; live map tiles and weather data are not guaranteed offline.

See [OFFLINE_LAN_SETUP.md](OFFLINE_LAN_SETUP.md) for the local-network demo setup and limitations.

---

## Tech Stack

| Area | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Local Storage | LocalStorage, IndexedDB |
| Offline Support | Service Worker |
| Browser Communication | BroadcastChannel and same-origin messaging |
| Local Relay | Node.js built-in HTTP modules |
| Location | Browser Geolocation API |
| Audio | Browser media recording and playback APIs |
| Map | Leaflet / OpenStreetMap integration with schematic fallback |

---

## Run It Locally

### Option 1 — Single-Device Demo

1. Clone the repository:

   ```bash
   git clone https://github.com/preethinagaraj06/CrisisBridge.git
   cd CrisisBridge
   ```

2. Open the `frontend` folder in VS Code.

3. Start a local web server from inside `frontend`, for example:

   ```bash
   python -m http.server 8000
   ```

4. Open the application in your browser:

   ```text
   http://localhost:8000
   ```

> Do not open `index.html` directly using `file://`. Use a local web server so browser storage, service-worker, and related features can work as intended.

### Option 2 — Multi-Device Demo Over Local Wi-Fi/LAN

The repository includes a Node.js relay that serves the frontend and provides local relay endpoints. Internet access is not required as long as the host laptop and participating devices remain connected through a working local network.

1. Install [Node.js](https://nodejs.org/).
2. Open a terminal in the repository root.
3. Start the relay:

   ```bash
   node server.js
   ```

4. Open the local URL printed in the terminal on the host laptop.
5. Connect other devices to the same Wi-Fi/LAN and open the LAN URL printed by the relay.
6. When prompted, enter the relay token printed in the server terminal. Keep this token private.

The relay uses Node.js built-in modules; no `npm install` is required for this demo.

---

## Demo Accounts

These accounts are for demonstration only. They are not real user accounts.

| Role | Username | Password |
|---|---|---|
| Citizen | `citizen@crisisbridge.demo` | `123456` |
| Volunteer | `volunteer@crisisbridge.demo` | `123456` |
| Authority | `authority@crisisbridge.demo` | `123456` |

---

## Suggested Demo Flow

1. Sign in as a Citizen and submit a sample emergency report.
2. Add a location or use GPS if available.
3. Sign in as Authority in another tab/device and review the incident.
4. Demonstrate incident prioritization and status updates.
5. Assign a volunteer or rescue team and explore shelter/resource workflows.
6. Send a voice alert from the Authority dashboard and play it from the Citizen view.
7. Repeat selected steps with internet disconnected, keeping the local server/network running.

Use fictional names, locations, and incident details during demonstrations.

---

## Repository Layout

```text
CrisisBridge/
├── server.js
├── frontend/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── sw.js
│   ├── manifest.json
│   └── assets/
├── docs/
│   └── SYSTEM_ARCHITECTURE.md
├── README.md
├── OFFLINE_LAN_SETUP.md
├── README_PRESENTATION.md
├── SECURITY_AND_GOVERNMENT_READINESS.md
├── START_HERE.txt
└── package.json
```

---

## Security and Privacy

The relay includes demo-level safeguards such as a randomly generated shared relay token, basic origin checks, request limiting, payload-size limits, and security-related response headers. These measures are intended to make the academic demonstration safer—not to make the system production-ready.

**Do not use real personal information, emergency locations, medical details, or voice recordings in this prototype.**

The demo authentication is not secure, local data is not encrypted at rest, and LAN traffic is not encrypted. Run the relay only on a trusted private network and do not expose it to the public internet.

More details and recommendations are documented in [SECURITY_AND_GOVERNMENT_READINESS.md](SECURITY_AND_GOVERNMENT_READINESS.md).

---

## Limitations

- No production-grade authentication or authorization
- No encrypted local storage or HTTPS relay transport
- No Bluetooth mesh or Wi-Fi Direct implementation
- No guaranteed delivery, high availability, or disaster-recovery mechanism
- No validated integration with government emergency services
- No field validation for real disaster-response use
- Browser feature support varies across devices

CrisisBridge is a prototype for learning, testing, and discussion. It must not be relied upon as the sole means of contacting emergency services.

In India, call **112** or use the official emergency channels available to you during a real emergency.

---

## Future Work

- Dedicated mobile application and tested peer-to-peer communication
- Secure identity, role-based access, and device authorization
- Encrypted communication and storage
- Reliable incident delivery, acknowledgement, retry, and synchronization
- Integration testing with emergency-response professionals
- Accessibility, multilingual usability, and field testing
- Security review and privacy assessment before any real-world pilot

---

## Documentation

- [Offline and LAN Setup](OFFLINE_LAN_SETUP.md)
- [System Architecture](docs/SYSTEM_ARCHITECTURE.md)
- [Security and Production-Readiness Notes](SECURITY_AND_GOVERNMENT_READINESS.md)

---

## Disclaimer

CrisisBridge is an academic prototype created for project demonstration and educational purposes. It is not affiliated with, endorsed by, or approved by any government agency. It is not a substitute for official emergency services and is not intended for live emergency dispatch.

---

*Built as a student project to explore offline-first emergency communication and coordination.*
