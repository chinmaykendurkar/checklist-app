# Checklists

A simple checklist web app (installable PWA). Create, manage and use checklists in the browser or from your phone's home screen. Works offline. Data is stored on the device (localStorage).

## Files
- `index.html`, `style.css`, `app.js` - the app
- `manifest.webmanifest`, `sw.js`, `icon*` - make it installable and offline-capable

## Updating
After changing app files, bump `CACHE` in `sw.js` so phones pick up the new version.

## Cloud sync (Firebase)
- Sign-in: Firebase Authentication (email + password, one user created in the Firebase console).
- Storage: Cloud Firestore, one document per list at `users/<uid>/lists/<listId>`.
- Security: Firestore rules allow reads/writes only for the owner's UID. The Firebase config in `cloud.js`
  is public by design; it identifies the project and grants no access without signing in.
- Offline: lists are also cached on the device; edits sync when back online. Newest edit of a list wins.
