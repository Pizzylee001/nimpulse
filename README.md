# Nimpulse

1v1 prediction duels inside Nimiq Pay. Call the market. Win the pot.

This repository currently contains the Phase 1 technical foundation: a styled
single screen that proves the wallet connection works end to end (connect,
sign, send 1 testnet NIM). Duel logic, backends, and leaderboards arrive in
later phases.

## Stack

- Vite + Vue 3 + TypeScript
- [@nimiq/mini-app-sdk](https://www.npmjs.com/package/@nimiq/mini-app-sdk) for the
  Nimiq provider (`init`, `listAccounts`, `sign`, `sendBasicTransactionWithData`)
- Design tokens live in `src/assets/tokens.css` and are the single source of
  truth for color, type, shape, layout, and motion

## Run locally

Requires Node.js 22 or later.

```bash
npm install
npm run dev -- --host
```

The dev server runs on port 5173 and is exposed to the local network. Note the
Network URL printed in the terminal (for example `http://192.168.x.x:5173`).
Do not use `localhost` on the phone: inside the WebView that would resolve to
the phone itself.

## Test inside Nimiq Pay

1. Make sure your phone and your dev machine are on the same Wi-Fi network.
2. Run `npm run dev -- --host` and copy the Network URL.
3. Open Nimiq Pay on the phone and go to Mini Apps.
4. Enter the Network URL in the Custom URL field.
5. For payment testing, switch Nimiq Pay to testnet: long-press the settings
   button for 10 seconds to reveal the dev menu, then pick Testnet. The
   "Get free NIM" button on the home empty state credits testnet NIM.
6. In the app, run the three cards in order: Connect wallet, Sign test
   message, Send 1 testnet NIM. Each action shows a native confirmation
   dialog in Nimiq Pay.

Opened outside Nimiq Pay (for example in a desktop browser), the page renders
a notice explaining that the app must be opened inside Nimiq Pay, with the
wallet cards visible but disabled.

## Live URL

Deployed with Vercel from this repository. The URL will be added here after
the first deploy.

## License

MIT. See [LICENSE](LICENSE).
