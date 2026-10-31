# Security

Lype runs a web server that accepts text from strangers and shows model-written drawings in the browser, so a few parts of it are security-sensitive:

- **Drawing sanitiser** (`web/lib/svgclean.js`): only whitelisted SVG shapes and attributes may reach a page.
- **Letters and moderation** (`server/moderation.js`, `server/index.js`): what strangers can submit, and what becomes public.
- **Keeper routes** (`/api/admin/*`): protected by a random token in `data/admin.json`.
- **Static export** (`server/export.js`): must never write visitor keys, held letters or withheld replies.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's **private vulnerability reporting** on this repository (Security → Report a vulnerability), or email **info@nirry.net** with a description and, if you can, a way to reproduce it. You will get a reply within a few days.

## Running it in public

By default it listens on `127.0.0.1` only. If you expose it, read *Things to know before putting it on the internet* in the README first: keep moderation on (or use `"mode": "keeper"`), put it behind a proxy with stricter rate limits, and keep the keeper link private.
