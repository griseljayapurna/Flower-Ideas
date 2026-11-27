# 💐 Bloom Board

A simple phone and tablet app for planning flower arrangements. Take a photo of the spot where the flowers will go, place flowers, greenery and vases on it, then move, resize and turn them with your fingers or big buttons.

- Works on iPhone, iPad and Android in the web browser. It can be added to the home screen like an app.
- Works offline after the first visit.
- Arrangements and photos are stored **only on the device** (IndexedDB). Nothing is uploaded.
- Paste your own flower cut-outs: iPhone "lift subject" / Android "copy object".

## Files

| Path | What it is |
|---|---|
| `index.html` | The single page with all screens |
| `styles.css` | Look and layout |
| `js/app.js` | Screens, saving, flower tray, help, "Save picture" |
| `js/editor.js` | The drawing area: drag, pinch, turn, undo/redo |
| `js/images.js` | Shrinking photos, trimming cut-outs, reading the clipboard |
| `js/storage.js` | Saving on the device |
| `js/library.js` | Loads the built-in flower list |
| `flowers/` | Built-in pictures + `library.json` (names, sources, licences) |
| `icons/`, `manifest.webmanifest` | Home-screen icon |
| `sw.js` | Offline support (**raise `VERSION` whenever you change files**) |
| `credits.html` | Photo credits |

No build step and no libraries: the files here are exactly what gets uploaded.

## Run it on a computer

```
python -m http.server 8000
```

Then open http://localhost:8000.

## Publish

See [GUIDE-github.md](GUIDE-github.md). The guide for the person using the app is [GUIDE-mom.md](GUIDE-mom.md).

## Credits

Built-in flower photos come from Wikimedia Commons under free licences. See `credits.html` and `flowers/library.json`.
