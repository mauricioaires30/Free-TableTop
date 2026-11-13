# Free TableTop

**English** · [Português (Brasil)](README.pt-BR.md)

A free virtual tabletop for RPGs that runs in the browser. Campaigns are saved in a folder on the game master's PC. No account, no uploads, no tracking.

**Open it:** [mauricioaires30.github.io/free-tabletop](https://mauricioaires30.github.io/free-tabletop/)

## Features
- **Campaign in your own folder:** the GM picks a folder once and the board, images and chat history are saved there (`campanha.json`, `quadro.json`, `imagens/`, `log/`). Works in Chrome and Edge. Other browsers keep the campaign in the browser itself.
- **Private tables:** every table has a random ID and an invite link (or QR code). Nobody gets in without the link, and tables never see each other.
- **Free board:** pan and zoom, notes, clue cards with a secret back side, and images you can drag in, paste or upload.
- **Live cursors:** everyone sees where the players are pointing. The GM's cursor stays hidden.
- **Permissions per item:** choose who can **see**, **move** and **edit** each thing: everyone, only the GM, the owner, or specific players. Hidden items never reach the players' browsers.
- **Dice:** `2d6+3`, `4d6kh3`, `2d20kl1`, exploding `1d6!`, `d%`, advantage and disadvantage. Rolls can be public, private to the GM, or hidden.
- **Chat:** `/r` to roll, `/gr` for a private roll, `/w name` to whisper.
- **Word filter:** blocks or censors offensive words in Portuguese, including accents, `p0rr4`, `p.o.r.r.a` and repeated letters. The GM edits the list.
- **Moderation:** mute, kick and generate a new invite.
- **"Bring everyone here":** centers every player's view on what the GM is looking at.

## Host your own
The site runs on GitHub Pages. A small free [Cloudflare Worker](relay/) relays messages between browsers and stores nothing from the campaign.

1. `npx wrangler login` and `npm run deploy:relay`.
2. In the repository, set the Actions variable `RELAY_URL` to the worker address using `wss://` (for example `wss://free-tabletop-relay.YOUR-ACCOUNT.workers.dev`).
3. In **Settings → Pages**, choose **GitHub Actions** as the source. Every push to `main` publishes the site.

To run it locally, use `npm install`, then `npm run dev:relay` and `npm run dev`, and open `localhost:5173/free-tabletop/`.

## Disclaimer
The table only works while the GM has the campaign open. Each GM is responsible for the content shared at their table.

## Portfolio
[mauricioaires30.github.io](https://mauricioaires30.github.io/)
