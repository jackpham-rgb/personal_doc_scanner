# Doc Scanner

Turns paper into a searchable archive. Point your phone's camera at a document;
it finds the edges, captures by itself, straightens and cleans up the page,
reads the text, names and files it, and saves a searchable PDF. Later you find
it by typing any word that was printed on it.

There are two versions:

- **Web app** (`web/`): open a link in the phone's browser, nothing to install.
  This is the main version.
- **Android app** (the rest of the repository): the same idea as an APK, using
  Google's on-device scanner.

## Web app

**Open it:** <https://jackpham-rgb.github.io/personal_doc_scanner/>

On the phone, open the link in Chrome (Android) or Safari (iPhone) and allow
camera access. To make it feel like an app, add it to the home screen: Chrome
menu → **Add to Home screen**, or Safari share button → **Add to Home Screen**.
It then opens full screen with its own icon and keeps working offline.

### What happens when you scan

| Step | How |
| --- | --- |
| Find the page and its corners, live in the camera view | OpenCV (WebAssembly), in the browser |
| Capture | Automatic once the page is held still for a moment, or tap the shutter |
| Straighten and clean up | Perspective correction, then shadow removal and whitening for paper documents |
| Fix anything by hand | Drag the corners, toggle enhancement, retake, add more pages |
| Read the text | Tesseract OCR (WebAssembly), in the browser |
| Name and file | `Costco Receipt Nov 2026.pdf`, `Electric Bill Oct 2026.pdf`, `Passport Copy.pdf`, into Receipts, Bills, IDs, … |
| PDF | The scan with an invisible text layer, so it is searchable and copyable in any PDF viewer |
| Search | Every word on every page, plus name, company and folder |

Photos already on the phone can be imported instead of using the camera.

**Privacy:** nothing is sent to a server. Scanning, text reading and the
library all live in the browser on your phone. The site is only the app's
code; nobody who opens the link can see your documents. The one exception is
Google Drive, if you connect it.

### Getting documents onto your laptop

Connect Google Drive in **Settings** and each scan is uploaded to
`DocScanner/<Folder>/<Name>.pdf` in your Drive; with
[Google Drive for desktop](https://www.google.com/drive/download/) the folder
appears on the laptop. Scans made offline upload when the connection returns.
Every document can also be downloaded or shared (to email, OneDrive, Dropbox,
…) from its page.

Google gives a web page without a server a one-hour sign-in. After that the
app shows "Tap to sign in" and uploads whatever is waiting once you do.

#### Google Drive setup (once, about ten minutes)

1. Go to <https://console.cloud.google.com/> and create a project.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen** → user type **External**, fill
   in an app name and your email. Set the publishing status to
   **In production** (no review is needed for the permission this app uses).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   application type **Web application**, and under **Authorized JavaScript
   origins** add `https://jackpham-rgb.github.io`.
5. Copy the client ID, open the app's **Settings → Google Drive**, paste it
   and tap **Connect Google Drive**.

The app asks only for the `drive.file` permission: it can see and change the
files it uploaded itself and nothing else in your Drive.

### Keep in mind

- The library lives in this browser on this phone. Clearing the site's data,
  or the browser clearing it when the phone is very low on space, deletes it.
  With Google Drive connected every scan also has a copy there. Settings has a
  button that asks the browser to keep the data.
- The first scan downloads the scanner and text-reading engines (about 8 MB).
  After that they are cached and scanning works offline.
- Text reading takes a few seconds per page on a phone. It runs in the
  background; you can keep scanning.

### Develop

Needs Node.js 22.

```bash
cd web
```

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build && npx playwright test
```

The browser tests drive the whole app in Chromium with a simulated camera that
shows a receipt on a desk: auto-capture, straightening, OCR, naming, search,
editing, PDF download and multi-page scans.

`web/src/` layout: `scanner/` (edge detection and flattening, run in a web
worker), `ocr.ts`, `analyzer.ts` (type, vendor, date, total, name), `pdf.ts`,
`store.ts` (IndexedDB), `search.ts`, `sync/` (sync manager and Google Drive),
`ui/` (screens).

Every push that touches `web/` runs the tests on GitHub and, on the default
branch, publishes the site to GitHub Pages.

## Android app

### What it does

| Step | How |
| --- | --- |
| Edge detection, auto-capture, perspective correction, shadow clean-up | Google ML Kit document scanner (runs on the phone) |
| Text recognition | Google ML Kit text recognition (on-device, offline) |
| Understanding | Rules over the recognised text: document type, vendor, date, total |
| Naming | `Costco Receipt Nov 2026.pdf`, `Electric Bill Oct 2026.pdf`, `Passport Copy.pdf` |
| Filing | One folder per type: Receipts, Bills, IDs, Insurance, Taxes, Medical, … |
| PDF | The scan with an invisible text layer, so it is searchable and copyable in any viewer and indexed by desktop and cloud search |
| Search | SQLite full-text index over title, vendor, type and every word on the page |
| Sync | Phone folder `Documents/DocScanner/` and/or Google Drive `DocScanner/` |

You can rename a document or move it to another folder from its page; the PDF
and every synced copy follow.

### Install on your phone

Every push builds an APK on GitHub:

1. Open the repository's **Actions** tab and pick the latest successful
   **Android app** run.
2. Download the **doc-scanner-apk** artifact and unzip it.
3. Open `app-release.apk` on the phone and allow installing from that source.

The APK is built for 64-bit ARM phones (anything from the last several years).
New builds install over old ones and keep your documents.

The phone needs Google Play services; the scanner component is downloaded by
Play services the first time you scan.

### Getting documents onto your laptop

**Google Drive (direct upload).** After the one-time setup below, each scan is
uploaded to `DocScanner/<Folder>/<Name>.pdf` in your Drive within seconds.
With [Google Drive for desktop](https://www.google.com/drive/download/) the
folder appears on the laptop automatically. Scans made offline upload when the
connection returns.

**Phone folder.** On by default. PDFs are also written to
`Documents/DocScanner/<Folder>/` on the phone, where the Files app sees them.
To send that folder to OneDrive, Dropbox or anything else, point a folder-sync
app (FolderSync, Autosync, Syncthing, …) at it.

Sync runs after every scan, when the app starts, and when the network comes
back while the app is open.

#### Google Drive setup (once, about ten minutes)

Google requires every app that talks to Drive to be registered. For a personal
app you register it yourself, for free:

1. Go to <https://console.cloud.google.com/> and create a project.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen** → user type **External**, fill
   in an app name and your email. Then set the publishing status to
   **In production** (no review is needed for the scope this app uses; left in
   "Testing", Google makes you reconnect every 7 days).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   application type **Android**, with
   - Package name: `com.jackpham.doc_scanner`
   - SHA-1: `7D:AD:06:D5:B9:65:41:ED:AD:B4:25:17:61:96:6F:79:2B:C3:67:84`
5. In the app: **Settings → Google Drive → Connect** and approve.

The app asks only for the `drive.file` permission: it can see and change the
files it uploaded itself and nothing else in your Drive.

### Develop

Needs Flutter 3.47 and, for building the APK, the Android SDK.

```bash
flutter pub get
```

```bash
flutter test
```

```bash
flutter build apk --release --target-platform android-arm64
```

The tests need the system SQLite library (`libsqlite3-dev` on Debian/Ubuntu).

#### Layout

```
lib/
  main.dart                      app start-up
  app_controller.dart            wires the services to the screens
  models/document.dart           document record and categories
  services/
    scanner_service.dart         ML Kit document scanner
    ocr_service.dart             ML Kit text recognition
    document_analyzer.dart       classify, extract vendor/date/total, name
    pdf_builder.dart             searchable PDF
    document_store.dart          SQLite index, full-text search, sync state
    scan_pipeline.dart           scan → document, rename, delete
    sync/                        SyncTarget interface, phone folder, Google
                                 Drive, sync manager
  ui/                            library, document and settings screens
android/app/src/main/kotlin/…/MainActivity.kt
                                 saves PDFs to the shared Documents folder
test/                            unit tests for everything without a camera
```

To add another cloud service, implement `SyncTarget`
(`lib/services/sync/sync_target.dart`) and register it in
`AppController.create`.

#### Signing key

`android/app/signing/app.keystore` is committed on purpose so that every build
has the same signature (updates install cleanly and the SHA-1 above stays
valid). Its password is the standard Android debug password. That is fine for
an app only you sideload; swap in a private key before distributing it.

### Limits of this version

- OCR is tuned for Latin-script languages. Other scripts can be added by
  switching the ML Kit recogniser.
- Slash dates are read US-style (`11/05/2026` is November 5).
- Classification and naming are keyword rules, not a trained model. Unusual
  documents land in **Other** with their first heading as the name; rename or
  re-file them from the document page.
- Sync runs while the app is open (which it is right after a scan). There is
  no background job that uploads with the app closed.
- OneDrive and Dropbox are reachable through the phone folder plus a sync app,
  not by direct upload.
- Android only. The code is Flutter, so Windows and iOS front ends can reuse
  the analyzer, index, PDF and sync code, but the scanner and OCR plugins used
  here are mobile-only.
