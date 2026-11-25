# CrisisBridge System Architecture

The target project architecture includes:
- Android / Kotlin citizen app
- GPS
- Room DB for offline reports
- Google Nearby Connections for peer-to-peer alerts
- Synchronization layer
- Node.js + Express.js
- MongoDB
- React.js
- OpenStreetMap / MapLibre
- Authorities, NGOs, volunteers and rescue teams
- Community verification
- Intelligent rescue prioritization
- Volunteer skill matching
- Smart shelter allocation
- Resource coordination
- Multilingual and voice assistance

The current browser prototype implements the user-facing workflows with:
- responsive role-specific dashboards
- browser Geolocation
- Web Speech API
- LocalStorage offline persistence
- Leaflet/OpenStreetMap
- Express API scaffold

Production integrations are documented in the README.


## Offline behaviour and limits
The browser prototype uses a service-worker-cached application shell, LocalStorage for structured operational data, IndexedDB for audio, and same-origin browser messaging for same-device tabs. A local schematic map is available when external map tiles are unavailable. Optional LAN APIs are not included in this frontend-only ZIP; live synchronization between different devices requires a separately running local relay/server and a working local network. Browser speech recognition and GPS availability vary by browser/device. Voice recordings are the offline-safe alternative to speech-to-text.
