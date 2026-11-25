# CrisisBridge — Final Presentation Edition

This is the one-laptop, offline-first presentation build.

## Run
Open `frontend` in VS Code and use Live Server on `index.html`.

Open the same URL in two tabs. Because authentication is stored in `sessionStorage`, each tab can use a different demo role simultaneously.

## Voice broadcast
Authority records an actual microphone voice message. The audio is stored locally in IndexedDB. The broadcast event is shared between same-origin tabs through BroadcastChannel and LocalStorage recovery. Citizen Emergency Alerts displays the recorded voice and a Play Voice button.

## Core prototype features
- Role-based Citizen / Volunteer / Authority workflow
- Emergency reporting with severity, affected people, medical need, vulnerability and response skill
- GPS capture
- Evidence photo compression and local storage
- Incident IDs and status lifecycle
- Explainable priority scoring
- Rescue-team recommendation and dispatch
- Volunteer skill matching
- Shelter recommendation and capacity
- Resource inventory and allocation
- Duplicate incident detection
- Incident timeline and audit log
- Offline visual map fallback
- Cached weather snapshot
- Analytics and operational dashboard
- 12-language emergency phrasebook
- Authority voice broadcast with 10-minute repetition and optional 24/48-hour cycle
- Offline PWA caching

## Technical scope
The browser prototype is offline-first. It does not claim that arbitrary browser microphone speech recognition is guaranteed offline; browser speech recognition depends on the browser/device. The authority voice broadcast itself is locally recordable and playable through IndexedDB.

Production roadmap: Android/Kotlin + Room, Nearby Connections/mesh, centralized MongoDB, Socket.IO, secure server authentication, on-device multilingual ASR, live GIS/weather and government integrations.

### Citizen voice emergency reporting
Citizens can record a short emergency report in Tamil, Telugu, English, or another language they speak comfortably. The original audio is attached to the incident, and the Authority can play it from the incident details. In the local demo, open the same Live Server URL in two tabs; cross-device synchronization requires a reachable server/relay.
