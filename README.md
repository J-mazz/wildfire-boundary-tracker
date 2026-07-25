# Wildfire Boundary Tracker

Live map of any current US wildfire. Pick a fire and it works: no setup, no configuration, no account.

## Using it

1. Open [fires.html](public/fires.html) (the landing page) to see current incidents from NIFC, searchable by name or state.
2. Pick a fire. The map opens at `/?fire=irwin:<id>` and builds itself from live data.
3. Scrub the three-hour timeline, press Play, or hit Live to follow the newest detections.

## What you're seeing

- The fire list and initial footprint come from NIFC incident records
- VIIRS thermal detections (NASA FIRMS) draw the heat field and grow the footprint as the fire spreads
- The timeline runs from discovery (up to the 10-day FIRMS history limit) to now, in 3-hour frames

Every layer comes from real observations; nothing is fabricated and nothing is stored. Each view is synthesized on demand from NIFC and FIRMS, with your fire shareable as a plain URL.

This project is a fork of [fire-progression-NRTDV](https://github.com/J-mazz/fire-progression-NRTDV), the curated East Evans Creek instance with Sentinel imagery, SAM-2 segmentation, and 3D terrain.

## Technical documentation

- [Engine](docs/engine.md): API endpoints, data flow, footprint seeding and growth, caching
- [Development](docs/development.md): local setup, WASM/C++26 build, tooling
- [Data contract & pipeline](docs/data-contract.md): snapshot catalog format, layer semantics
- [Deployment](docs/deployment.md): Cloudflare Pages build, Functions, and secrets

