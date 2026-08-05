# Integrating Flashnet Orchestra into a WDK wallet

This document explains how the Orchestra swidge module is wired into this fork, why the
integration looks the way it does, and what you need to change to adapt it.

---

## 1. Where protocol code actually runs

The single most important fact: **the WDK engine does not run on the React Native JS
thread.** It runs inside a [Bare](https://github.com/holepunchto/bare) worklet — a
separate thread with a Node-like runtime — and React Native talks to it over a binary RPC
(HRPC) channel.

That means a protocol module cannot simply be `npm install`ed and handed a wallet account
from React code. There is no account object on the React side; there is only a bridge.

Orchestra is built for this. Its `package.json` declares a `bare` export condition:

```json
"exports": { ".": { "bare": "./bare.js", "default": "./index.js" } }
```

and `bare.js` pulls in `bare-node-runtime/global`. The module is meant to be compiled
*into the worklet bundle*, where real `IWalletAccount` objects live.

### The bridge already knows about swidge

`@tetherto/pear-wrk-wdk`'s RPC handler has first-class protocol dispatch built in
(`src/handlers/execution.js`):

```js
switch (options?.protocolType) {
  case 'swidge':
    account = account.getSwidgeProtocol(options?.protocolName)
    break
  // swap, bridge, lending, fiat …
}
```

So a call from the UI carries `{ methodName, network, accountIndex, args, options }`, and
the worklet resolves the account, narrows it to the named protocol, and invokes the
method. **No adapter or shim code is required.**

On the React side, `useProtocol` wraps this in a Proxy:

```tsx
const orchestra = useProtocol<OrchestraSwidge>({
  network: 'arbitrum',
  accountIndex: 0,
  protocolType: 'swidge',
  protocolName: 'orchestra',
})

const quote = await orchestra.quoteSwidge({ … }) // → account.getSwidgeProtocol('orchestra').quoteSwidge(…)
```

---

## 2. The three wiring points

### a. Bundle the module — [`wdk.config.js`](../wdk.config.js)

```js
protocols: {
  orchestra: { package: 'wdk-protocol-swidge-orchestra' },
},
```

`wdk-worklet-bundler` compiles this into `protocolManagers['orchestra']` inside the
bundle. There is no allowlist — third-party packages work the same as `@tetherto/*` ones.
Rebuild with:

```bash
npm run bundle
```

### b. Register it at init — [`src/config/get-wdk-configs.ts`](../src/config/get-wdk-configs.ts)

`registerProtocol` binds a protocol instance to **one** blockchain, so this fork
registers one Orchestra per source chain in a loop:

```ts
for (const sourceChain of ORCHESTRA_SOURCE_CHAINS) {   // ['arbitrum', 'polygon', 'solana']
  protocols[`orchestra-${sourceChain}`] = {
    blockchain: sourceChain,      // which account gains getSwidgeProtocol()
    protocolName: 'orchestra',    // must match the wdk.config.js key
    config: { sourceChain, apiKey, authMode: 'client', sourceTokenAddresses },
  };
}
```

The record key is arbitrary (WDK keys registrations by `blockchain` + `protocolName`);
only `protocolName` must match the bundle. Adding a source chain is one entry in
`ORCHESTRA_SOURCE_CHAINS` — plus a matching row in the swap screen's `SOURCES` list.

### c. Call it — [`src/app/swap.tsx`](../src/app/swap.tsx)

That's the whole integration surface.

---

## 3. API keys in a mobile app

Anything prefixed `EXPO_PUBLIC_` is **embedded in the shipped bundle** and readable by
anyone who unzips the `.ipa` or `.apk`. It is not a secret.

- Use a **scoped client key** with `authMode: 'client'` (this fork's default).
- Never ship a backend admin key.
- For production, proxy Orchestra through your own backend and use `getAuthHeaders` or
  `baseUrl` instead of embedding a key at all.

Note that **quoting works with no key at all** — `getSupportedChains()` and
`quoteSwidge()` both succeed unauthenticated, so you can demo live pricing before you have
credentials.

---

## 4. Before you use this with real money

`quoteSwidge()` is side-effect-free. Executing **moves funds** — the source payment is
sent from the wallet account and only then is its transaction id submitted to Orchestra.
If the process dies between those two steps, funds have left the wallet and Orchestra
doesn't know about the order.

The swap screen therefore avoids the one-call `swidge()` and uses the explicit boundary:

```ts
const intent = await orchestra.prepareSwap(options)   // nothing has moved yet
const state  = await orchestra.executeSwapIntent(intent)
```

Two reasons:

1. **Recovery.** The intent exists before any funds move, so a failed submit can be
   resumed rather than retried (a retry would pay twice).
2. **`swidge()` drops the `readToken`.** Its `SwidgeResult` only carries
   `{id, hash, fees, amounts}`, while scoped client keys get a per-order `readToken` that
   status reads need. `executeSwapIntent()` returns the full state, token included — which
   is why status polling passes the whole state object back to `getOrderStatus(state)`.

**What this demo still does not do:** the intent lives in React state only. It is not
written to durable storage, so killing the app mid-swap loses the handle needed to resume.
A production wallet should persist at both points above — or wire `config.onStateChange`
to storage — and recover with `submitSourceTx()` / `resumeSwap()`. See the upstream
[State and Recovery guide](https://docs.wallet.tether.io/sdk/swidge-modules/swidge-orchestra/guides/state-and-recovery).

---

## 5. Choosing routes

The live matrix (~2,800 routes) is public:

```bash
curl -s https://orchestration.flashnet.xyz/v1/orchestration/routes | jq '.routes | length'
```

Source chains this wallet registers today: `arbitrum`, `polygon`, and `solana` (see
`ORCHESTRA_SOURCE_CHAINS` in [`src/config/get-wdk-configs.ts`](../src/config/get-wdk-configs.ts)).
The EVM sources pay gas in USDT via their paymaster; the Solana source is a plain
wallet, so its SPL transfer needs a little SOL for fees.
The swap screen limits destinations to chains the wallet also holds an address for, so
swapped funds land back in the app — edit `SOURCES` and `DESTINATIONS` in
[`src/app/swap.tsx`](../src/app/swap.tsx) to change either side.
