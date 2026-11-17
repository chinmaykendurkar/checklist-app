# Checklists

A simple checklist web app (installable PWA). Create, manage and use checklists in the browser or from your phone's home screen. Works offline. Data is stored on the device (localStorage).

## Files
- `index.html`, `style.css`, `app.js` - the app
- `manifest.webmanifest`, `sw.js`, `icon*` - make it installable and offline-capable

## Updating
After changing app files, bump `CACHE` in `sw.js` so phones pick up the new version.
