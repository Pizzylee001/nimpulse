# NimPulse

1v1 prediction duels on a daily market question, inside Nimiq Pay.

Every day at 00:00 UTC, NimPulse opens one question: will BTC, ETH, NIM, SOL,
XRP or DOGE close higher against USD over the next 24 hours? Pick YES or NO
with your Nimiq wallet, create a duel, and send the link to a friend. They take
the opposite side. The market decides.

Free to play. No NIM is staked or paid out.

## What is built

- Daily question engine. One question per UTC day, rotating across six markets:
  BTC, ETH, NIM, SOL, XRP and DOGE. A Cloudflare Worker creates and resolves
  questions on a cron, so the app runs unattended.
- Signed picks. Every pick is signed by the Nimiq wallet and verified server
  side with Ed25519. The wallet address is derived from the public key, so a
  pick cannot be forged or reassigned.
- 1v1 duels. Create a duel on your pick, share the link, and an opponent joins
  on the opposite side with their own signed proof. Duel status is computed
  from stored data, so it stays correct between cron runs.
- Streaks and record. Correct picks extend the streak, wrong picks reset it.
  Wallet addresses are masked to the first six and last four characters.
- Real price resolution. Open and close prices come from CoinGecko, with
  Coinbase as the exchange fallback for BTC, ETH, SOL, XRP and DOGE, and KuCoin
  for NIM. Both prices for one question always come from the same source. Ties
  count as NO. If every source fails, the question is retried on the next pass.
  No outcome is ever guessed.
- Prediction history. Open any past question to see the outcome, the open and
  close prices, and the price source.

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
6. In the app, pick YES or NO on today's question and approve the two
   native dialogs (account access, then the pick signature). The wallet
   test cards (connect, sign, send 1 testnet NIM) live under Foundation
   tests at the bottom of the home screen.
7. Use Disconnect in Step 1 to clear the complete NimPulse test session.
   This does not disconnect or delete the wallet from Nimiq Pay.

Opened outside Nimiq Pay (for example in a desktop browser), the page renders
a notice explaining that the app must be opened inside Nimiq Pay, with the
wallet cards visible but disabled.

## Live URL

https://nimpulse.vercel.app

## License

MIT. See [LICENSE](LICENSE).
