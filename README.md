# AidAtlas

**From global signals to organization-confirmed needs.**

**Live: [aidatlas-globe.vercel.app](https://aidatlas-globe.vercel.app)**

AidAtlas is an interactive 3D globe that connects global crises to the organizations working on the ground, and to people who want to help them.

The globe shows seven global issues from public data: wildfire, flood, storm, nature, war, education, and intimate partner violence. Satellite data can show where something may be happening, but not whether a nearby organization was affected or what it needs. So when satellite fire detections appear near a participating organization, AidAtlas checks in with its staff. If they need support, they describe it in their own words, Gemini turns it into a structured request, and only the organization can publish it. Supporters then pledge supplies, money, or time, and the organization confirms what it received. Each contribution becomes a star in the supporter's personal universe, **My Cosmos**.

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, MapLibre GL JS (globe and map layers), Three.js (My Cosmos)
- **Backend:** Python 3.12, FastAPI, SQLAlchemy
- **Database:** TiDB Cloud, for storage and vector search
- **AI:** Gemini for writing requests and check-ins, and `gemini-embedding-001` for semantic search
- **Data:** NASA FIRMS, ECCC GeoMet, GDACS, EOxCloudless (Sentinel-2), UCDP, UNESCO UIS, WHO, HDX HAPI (OCHA 3W), Canada Revenue Agency, IUCN
- **Hosting:** Vercel (frontend), Railway (backend)
