# DocShare

A small document editor with sharing, file import and persistence. It runs entirely in the browser: Dexie (IndexedDB) stands in for the server.

## Links

- **Github:** [Github Repository Link](https://github.com/AntonM-248/DocShare)
- **Deployment:** [Deployed Site](https://antonm-248.github.io/DocShare/)
- **Google Drive:** https://drive.google.com/drive/folders/1RlbLMMx-raqPhpDUiMtatIFJwmuhrEZk?usp=drive_link

## Run it

1. Open `index.html` in a browser (double-click works), or serve the folder: `python3 -m http.server 8000` then visit http://localhost:8000. You can also use a VS Code extension such as LiveServer.
2. An internet connection is needed once to load Dexie 3.2.4 from cdnjs. To work offline, save that file as `dexie.min.js` next to `index.html` and change the `<script src>` in `index.html` and `tests.html`.

## Demo accounts

`alice`, `bob`, `carol`, `dave`, `erin`. The password for all of them is `password`.
Try it: sign in as Alice, open "Welcome to DocShare" (shared with Bob as editor, Carol as viewer), log out, sign in as Bob, edit it, then sign back in as Alice. Use "Reset demo data" to restore the seed data.

## Features

- **Documents:** create, rename (title field), edit, autosave after 800 ms plus a Save button. Rich text: bold, italic, underline, Heading 1/2, bullets, numbers. Stored as sanitized HTML.
- **Import:** `.txt`, `.md`/`.markdown` (headings `#`-`###` and `-`/`*` bullets only) and `.html`/`.htm` files, up to 1 MB, become a new document titled after the file. Other types, including `.docx`, are rejected with a message.
- **Sharing:** the owner shares with any other user as "can edit" or "can view" and can revoke. Lists show "Owned by you" versus "Shared by ..." with the permission, and the editor shows a role badge. Viewers get a read-only editor.
- **Persistence:** everything lives in IndexedDB (database `docshare`), so it survives refresh and restart. Data is per browser profile; a different browser or private window starts with fresh seed data.

## Tests

Open `tests.html`. It runs 8 tests against the data layer on a throwaway database and shows PASS/FAIL per test. They cover login, persistence of formatting, title validation, access denial, view-only and edit sharing, owner-only sharing rules and sanitization.

## Architecture

- `db.js`: the "server". `window.DocsApi` exposes async functions (`login`, `listDocs`, `saveDoc`, `shareDoc`, ...) that return promises and enforce permissions and validation. It is the only code that touches Dexie.
- `app.js`: the UI. It calls `DocsApi` and never queries the database, so the data layer could be swapped for real `fetch` calls to a backend.
- `index.html`/`styles.css`: markup and styling. `tests.html`/`tests.js`: tests.

**Priorities:** a clean API boundary with permission checks outside the UI, then a coherent editing flow, then compatibility (plain scripts without a build step or modules, ES5-style code, `contenteditable` with `execCommand`).

**Known tradeoffs (simulation only):** passwords are plain text and login is client-side; a real version needs a server, hashed passwords and real sessions. Last write wins (no real-time collaboration; that would need CRDTs or OT). `document.execCommand` is deprecated but is the most widely supported way to get rich text without a library. Content is sanitized with a small custom function; a real app should use a vetted library such as DOMPurify. No document deletion yet.
