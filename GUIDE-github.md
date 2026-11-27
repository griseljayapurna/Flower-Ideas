# Putting Bloom Board online with GitHub

GitHub stores the app's files. **GitHub Pages** (free) turns them into a web link that your mom opens on her phone. You don't need to install anything — it all happens in your web browser.

When you're done, the app will be at:

```
https://YOUR-GITHUB-USERNAME.github.io/flower-ideas/
```

---

## Part 1 — Create the project ("repository") — one time only

1. Go to **https://github.com** and sign in.
2. Top right, click **+** → **New repository**.
3. Fill in:
   - **Repository name:** `flower-ideas`
   - **Public** (free GitHub Pages needs this. Only the app's code is public: your mom's photos and arrangements stay on her phone and are never uploaded.)
   - Tick **Add a README file**.
4. Click **Create repository**.

## Part 2 — Upload the app files

1. In your new repository, click **Add file** → **Upload files**.
2. Open the project folder in Windows File Explorer:
   `Documents\Flower arranging app`
3. Select **everything in the folder except the `.claude` folder** (that one is only for Claude). That means:
   - folders: `flowers`, `icons`, `js`
   - files: `index.html`, `styles.css`, `sw.js`, `manifest.webmanifest`, `credits.html`, `README.md`, `GUIDE-github.md`, `GUIDE-mom.md`
4. Drag them into the GitHub page (onto the "Drag files here" box). Folders keep their structure.
   *GitHub will ask whether to replace README.md. Yes, replace it.*
5. Wait until all files are listed. At the bottom, write a short message like `First version`, then click **Commit changes**.

## Part 3 — Turn on GitHub Pages

1. In the repository, click **Settings** (top menu, gear icon).
2. In the left menu click **Pages**.
3. Under **Build and deployment**:
   - **Source:** `Deploy from a branch`
   - **Branch:** `main`, folder `/ (root)` → **Save**
4. Wait 1–2 minutes and refresh the page. A box appears: **"Your site is live at https://…github.io/flower-ideas/"**. That is the link.

## Part 4 — Test it on your own phone first

Open the link on your phone and check:

- [ ] **New arrangement → Choose from my photos** opens your photos, and the picture appears.
- [ ] Tapping a flower in the bottom tray adds it. One finger moves it. Two fingers resize and turn it.
- [ ] The **Bigger / Smaller / Turn / Remove** buttons work. So does **Undo**.
- [ ] **Zoom:** the **+ / −** buttons on the right zoom in and out. With no flower chosen, a two-finger pinch zooms the picture, and dragging an empty spot moves around.
- [ ] **⭐ My flowers → 📋 Paste**: copy a flower from a photo first (see GUIDE-mom.md). It should appear.
- [ ] **← Done**, close the browser, open the link again: the arrangement is still there.
- [ ] **💾 Save picture** saves an image to your photos/gallery.
- [ ] **Add to Home Screen** (see GUIDE-mom.md), then open it from the home screen icon.
- [ ] Turn on airplane mode and open it from the home screen: it should still work.

Then send your mom the link with **GUIDE-mom.md** (you can copy the text into WhatsApp or email, or print it).

---

## Updating the app later

When Claude changes some files for you:

1. Open `sw.js` and check that the line `const VERSION = 'v1';` went up by one (e.g. `'v2'`). Claude normally does this for you. This tells phones a new version exists.
2. On GitHub: **Add file → Upload files** → drag in **only the changed files**. If a file is inside a folder (e.g. `js/editor.js`), first click into that folder on GitHub, then upload there. Or drag the whole folder again; same names are replaced.
3. **Commit changes**. The site updates in about a minute.
4. Your mom gets the new version the next time she opens the app with internet. Sometimes it takes opening it twice.

## Adding more built-in flowers

1. Put a **transparent** picture (PNG or WebP, about 600 px) in the `flowers` folder.
2. Add an entry to `flowers/library.json` (copy an existing one and change `id`, `name`, `cat` = `flowers` / `greenery` / `vases`, `file`, and the credit fields).
3. Raise `VERSION` in `sw.js` and upload the changed files.

Only use pictures you are allowed to use: your own photos, or free-licence ones (credit them in `library.json`).
