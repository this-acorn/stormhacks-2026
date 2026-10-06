# AidAtlas

**From global signals to organization-confirmed needs.**

**Live demo: [aidatlas-globe.vercel.app](https://aidatlas-globe.vercel.app)**

AidAtlas is an interactive globe that connects global crises to the organizations working on the ground, and to people who want to help them.

Satellite and public data can show where something may be happening, like a wildfire. On their own, they can't tell us whether a nearby organization was affected or what it needs. AidAtlas uses these signals to start a conversation: it checks in with nearby organizations, and only the organization itself can confirm and publish a need.

## How it works

1. **Explore global issues.** Seven layers on a 3D globe: wildfire, flood, storm, nature, war, education, and intimate partner violence. The data comes from public sources such as NASA FIRMS, GDACS, EOxCloudless, UCDP, UNESCO, and WHO. Every layer shows its source, date, and limitations.
2. **Find organizations.** See humanitarian organizations (OCHA 3W via HDX HAPI), Canadian registered charities, and IUCN conservation members working in the area.
3. **Satellite check-ins.** When satellite heat detections from one fire cluster within 10 km of a participating organization, its staff get a check-in on their organization card. They answer **Not affected**, **Checking**, or **Support needed**.
4. **Organization-confirmed requests.** Staff describe what they need in their own words, and Gemini turns it into a structured request. Nothing becomes public until the organization publishes it.
5. **Help with a concrete need.** Supporters find requests, pledge supplies, money, or time through the organization's official links, and the organization confirms what it actually received.
6. **My Cosmos.** Each contribution becomes a star in a personal universe. Contributions to one organization form a constellation, and each impact area is a galaxy.

## About the live demo

- The organizations, requests, and accounts are fictional samples, stored in your browser. Use the profile menu to switch between a supporter and **Organization staff · Okanagan**. **Reset demo** starts over.
- The wildfire check-ins replay recorded NASA FIRMS satellite data from the August 2023 British Columbia wildfires.
- The map layers use live public data, and Gemini writes requests on the backend.

## Built with

React, TypeScript, MapLibre GL JS, and Three.js on the frontend. FastAPI, TiDB Cloud (storage and vector search), and Gemini (request writing and embeddings) on the backend.

AidAtlas is a StormHacks 2026 prototype. It is not an emergency warning system, and it records pledges without processing payments or shipping.
