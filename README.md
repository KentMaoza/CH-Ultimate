# CH Ultimate

Frontend-only Electron demo for Toko CH operational workflows.

## Run locally

```bash
npm install
npm start
```

## Verify

```bash
npm run verify
npm run test:e2e
npm run package
```

## Demo boundaries

- Data exists only for the current app session and resets on reload or exit.
- Runtime XLSX imports are parsed in memory and are never copied into this repository.
- Printing, final PDF export, NAS/database integration, mobile dashboards, and other CH apps are intentionally deferred.
- `CHU` is temporary branding.

The future NAS phase will replace the mock `OperationsGateway` implementation with an authoritative CH Core API.
