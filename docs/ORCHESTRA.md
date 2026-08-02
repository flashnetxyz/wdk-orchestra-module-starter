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
for (const sourceChain of ORCHESTRA_SOURCE_CHAINS) {   // ['arbitrum', 'polygon']
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

## 3. Things that will bite you

### A nested `@tetherto/wdk-wallet` silently breaks registration

The Orchestra package pins an exact older `@tetherto/wdk-wallet`, so npm nests a second
copy under it and the worklet bundle ends up with **two `SwidgeProtocol` base classes**.
`registerProtocol()` gates on `Protocol.prototype instanceof SwidgeProtocol` against
*its* copy — and has no else branch — so with mismatched identities it registers nothing
while every layer reports success. The first error you see is much later:
`No swidge protocol registered for label: orchestra`.

This repo's fix is an `overrides` entry in `package.json` forcing the hoisted version.
Overrides only take effect through the lockfile — after dependency changes, regenerate it
(`rm -rf node_modules package-lock.json && npm install`) and confirm the bundle contains
a single copy.

### Cross-chain routes need an explicit `refundAddress`

The module defaults `refundChain` to the source chain but leaves `refundAddress` empty,
and the API rejects that pairing at order creation (`refundChain requires
refundAddress`). Pass the wallet's own source-chain address — a failed or expired order
then refunds straight back to the account that paid.

### Don't spend the entire balance when fees are charged in the same token

With a token paymaster, gas comes out of the same USDT being transferred. A full-balance
transfer leaves nothing for the fee, and the paymaster rejects the operation during
pre-flight (`PAYMASTER_ERROR: pm_getPaymasterData failed`) — before anything is signed
or broadcast. Reserve the module's `transferMaxFee` (this fork's **Max** button does
exactly that).

### Amounts cross the bridge as strings

The worklet serialises `BigInt` to a decimal string (`safeStringify`). So `SwidgeQuote`
says `fromTokenAmount: bigint`, but what arrives in React is `"2000000"`. Passing a real
`BigInt` *into* a call fails to serialise — pass strings. Orchestra accepts
`number | bigint | string` for amounts.

### Cross-chain destinations need an explicit recipient

Orchestra only auto-fills the recipient when the destination chain equals the source
chain:

```js
async _defaultRecipientAddress (destinationChain) {
  if (normalizeChain(destinationChain) !== this._defaultSourceChain()) return undefined
  return await this._account.getAddress()
}
```

For any cross-chain route you must pass `recipient`. The swap screen resolves it from the
wallet's own address for that chain, which keeps funds in-app.

### Fees are itemised and may use a different token

A USDT-in route can return a protocol fee denominated in **USDC**. Don't sum fee amounts
across entries — render each with its own `fee.token`.

### `useProtocol` returns `undefined`, it does not throw

If the wallet isn't ready, the proxy logs and resolves `undefined`. Check the result.

---

## 4. Why this fork upgrades `wdk-react-native-core`

Upstream `develop` pins:

```json
"@tetherto/wdk-react-native-core": "github:tetherto/wdk-react-native-core#0b2be6eb…"
```

Two problems:

1. **That commit has no `useProtocol`.** Its `AccountService.callAccountMethod` never
   forwards an `options` object, so there is no way to reach `getSwidgeProtocol` at all.
2. **It doesn't install.** That version depends on `github:tetherto/pear-wrk-wdk#v2`, and
   the `v2` branch no longer exists. The committed lockfile resolves it over `git+ssh`,
   which also requires every contributor to have GitHub SSH access — unacceptable for a
   repo meant to be forked.

So this fork moves to the published `1.0.0-beta.15`, whose most recent upstream commit is
literally `feat/add-swidge`, and which depends on `@tetherto/pear-wrk-wdk@1.0.0-beta.10`
from npm.

### What that migration changed

`beta.15` reorganised several APIs. The app-side changes:

| Before | After |
| --- | --- |
| `useWallet()` | Split into `useWdkApp()` + `useAddresses()`; reassembled by [`src/hooks/use-wallet.ts`](../src/hooks/use-wallet.ts) |
| `useWallet().callAccountMethod(net, i, m, args)` | `useAccount({network, accountIndex}).extension()[m](args)` |
| `useWalletManager().initializeFromMnemonic(m, id)` | `restoreWallet(m, id)` |
| `useWalletManager().initializeWallet({walletId})` | `unlock(walletId)` |
| `useWalletManager().hasWallet` | `wallets.length > 0` |
| `useWalletManager().refreshWalletList()` | removed; the list is reactive |
| `useBalancesForWallet(i, tokenConfigs, …)` | takes a flat `IAsset[]` — see `getAssets()` |
| `BalanceFetchResult.tokenAddress` | `BalanceFetchResult.assetId` |
| `WdkAppProvider networkConfigs/tokenConfigs` | `bundle` + `wdkConfigs` |
| `TokenConfigs` type export | defined locally in `get-token-configs.ts` |

The `useWallet` shim exists so the screens read the same as upstream, which keeps the
diff reviewable and makes it easier to track future upstream changes.

---

## 5. API keys in a mobile app

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

## 6. Before you use this with real money

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

## 7. Choosing routes

The live matrix (~2,800 routes) is public:

```bash
curl -s https://orchestration.flashnet.xyz/v1/orchestration/routes | jq '.routes | length'
```

Source chains this wallet registers today: `arbitrum` and `polygon` (see
`ORCHESTRA_SOURCE_CHAINS` in [`src/config/get-wdk-configs.ts`](../src/config/get-wdk-configs.ts)).
The swap screen limits destinations to chains the wallet also holds an address for, so
swapped funds land back in the app — edit `SOURCES` and `DESTINATIONS` in
[`src/app/swap.tsx`](../src/app/swap.tsx) to change either side.
