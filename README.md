# wdk-orchestra-module-starter

A self-custody, multi-chain mobile wallet with **cross-chain swaps built in** — a fork of
[`tetherto/wdk-starter-react-native`](https://github.com/tetherto/wdk-starter-react-native)
that adds [Flashnet Orchestra](https://docs.flashnet.xyz/products/orchestration/overview)
as a [WDK](https://docs.wallet.tether.io) swidge protocol.

Swap USDT on Arbitrum for BTC on Spark — or any of ~2,800 routes — from inside the wallet,
without giving up custody of your keys.

[![Demo Video](assets/docs/demo-thumbnail.png)](assets/docs/demo.mp4)

> [!WARNING]
> **Alpha software, real funds.** Both the upstream starter and the Orchestra module are
> alpha. Orchestra routes are **mainnet only** — a completed swap moves real money. Test
> with small amounts and read [State and Recovery](https://docs.wallet.tether.io/sdk/swidge-modules/swidge-orchestra/guides/state-and-recovery)
> before going near production.

## What this fork adds

The Orchestra integration itself is five files:

| File | Purpose |
| --- | --- |
| [`wdk.config.js`](wdk.config.js) | Declares the worklet bundle, including the Orchestra protocol module |
| [`src/config/get-wdk-configs.ts`](src/config/get-wdk-configs.ts) | Registers one Orchestra instance per source chain (Arbitrum, Polygon, and Solana) |
| [`src/app/swap.tsx`](src/app/swap.tsx) | The swap screen — asset pickers for both sides, balances with a fee-aware Max, live quotes, two-step execute, order tracking |
| [`src/hooks/use-wallet.ts`](src/hooks/use-wallet.ts) | Compatibility shim for the upstream `useWallet` hook |
| [`plugins/withIosModularHeaders.js`](plugins/withIosModularHeaders.js) | Podfile fix so the Spark module's Swift pods build on iOS |

There is also a **dependency upgrade** that touches more files than that: upstream pins
`@tetherto/wdk-react-native-core` to a GitHub commit that no longer installs, so this
fork moves to the published `1.0.0-beta.15` and updates the wallet screens to its API.
[docs/ORCHESTRA.md](docs/ORCHESTRA.md) documents the integration in full — read it if
you are adding Orchestra to your own WDK wallet.

## How it works

The WDK engine runs inside a **Bare worklet** on its own thread. Orchestra ships a `bare`
export and is compiled *into that bundle*, so it runs next to the wallet accounts rather
than talking to them across the bridge:

```
React Native (JS thread)              │  Bare worklet (separate thread)
                                      │
useProtocol({                         │  WDK engine
  network: 'arbitrum',                │   ├── wallet modules (evm-erc-4337, spark, …)
  accountIndex: 0,                    │   └── protocol modules
  protocolType: 'swidge',   ──HRPC──► │        └── orchestra
  protocolName: 'orchestra',          │             ├─ account.transfer() ─► Arbitrum
})                                    │             └─ HTTPS ─► orchestration.flashnet.xyz
  .quoteSwidge(…)                     │
  .prepareSwap(…)                     │
  .executeSwapIntent(…)               │
```

`useProtocol` returns a Proxy: every method call is marshalled over the worklet's RPC and
dispatched to `account.getSwidgeProtocol('orchestra')`. Private keys never leave the
worklet, and no adapter code is needed — the WDK bridge already models swidge protocols
as a first-class concept.

**Source payments are gasless on the EVM chains.** The starter runs Arbitrum and Polygon
as ERC-4337 Safe accounts with a USDT paymaster, so a demo wallet only ever needs USDT,
never ETH. Solana is a plain wallet — paying from it needs a little SOL for fees.

## Quick start

Requires Node.js >= 20.19.4, plus Xcode (iOS) or the Android SDK.

**1. Install**

```bash
npm install
```

`postinstall` compiles the worklet bundle (`wdk.config.js` → `wdk-bundle/`, ~9 MB, a few
seconds). It is gitignored; rebuild any time with `npm run bundle`.

**2. Configure**

```bash
cp .env.example .env
```

Add a **scoped Flashnet client key** to `.env`. This is the only key the app uses —
balances are read straight from each chain's RPC and prices from Bitfinex's public API.
Quoting works **without a key**, so you can see live pricing immediately; the key is
required to submit an order. `EXPO_PUBLIC_*` values are embedded in the built app and are
not secret — see [docs/ORCHESTRA.md §3](docs/ORCHESTRA.md#3-api-keys-in-a-mobile-app).

**3. Run**

```bash
npm run ios      # iOS simulator
npm run android  # Android emulator/device
```

## Running a swap

1. Create or import a wallet, then open **Swap** from the wallet screen.
2. Fund the wallet's **Arbitrum** address (Settings → Wallet Addresses) with a small
   amount of **USDT** — no ETH is needed, the ERC-4337 paymaster covers gas in USDT.
   **~5 USDT is a comfortable demo amount**: routes enforce a minimum of roughly a
   dollar, the flat protocol fee is 0.01, and gas is capped at 0.1 USDT per transfer.
3. Pick what you pay with (USDT on Arbitrum, Polygon, or Solana) and what you receive,
   then enter an amount — or tap **Max**, which reserves the paymaster fee headroom
   automatically. A live quote appears from Orchestra.
4. Tap **Swap**. The source transfer is signed inside the worklet, submitted to
   Orchestra, and the order card tracks status until it settles; the button offers
   **New swap** once it does.

Destination `BTC on Spark` settles fastest and lands back in the same wallet, which makes
the round trip visible in-app.

> [!TIP]
> Don't swap your entire balance by typing it manually: the paymaster charges gas in the
> same USDT you're sending, so a full-balance transfer leaves nothing to pay the fee and
> the paymaster rejects the operation (`pm_getPaymasterData failed`). The **Max** button
> exists precisely to keep that headroom for you.

> [!CAUTION]
> Orchestra routes are mainnet — a completed swap moves real funds. The screen uses the
> two-step `prepareSwap()` → `executeSwapIntent()` path, but keeps the intent in React
> state only. It is **not** persisted, so an app restart mid-swap loses the handle needed
> to resume. See [docs/ORCHESTRA.md §4](docs/ORCHESTRA.md#4-before-you-use-this-with-real-money).

## Networks & tokens

Every network supports balances, send, and receive. Swap routes are mainnet-only.

| Network | Mode | Account type | Swap | Fees |
|---------|------|--------------|------|------|
| **Arbitrum** | mainnet | Safe (ERC-4337) | source *(default)* | Gasless (USDT paymaster) |
| **Polygon** | mainnet | Safe (ERC-4337) | source + destination | Gasless (USDT paymaster) |
| **Solana** | mainnet | Native | source + destination | SOL |
| **Ethereum** | mainnet | Safe (ERC-4337) | destination | Gasless (USDT paymaster) |
| **Spark** | mainnet / regtest | Native (Bitcoin) | destination (BTC) | None |
| **Plasma** | mainnet | Safe (ERC-4337) | — | Gasless (USDT paymaster) |
| **Sepolia** | testnet | Safe (ERC-4337) | — | Gasless (USDT paymaster) |

| Token | Networks |
|-------|----------|
| **USD₮** (Tether USD) | Ethereum, Polygon, Arbitrum, Plasma, Sepolia, Spark, Solana (SPL) |
| **BTC** (Bitcoin) | Spark |
| **SOL** (Solana) | Solana |
| **XAU₮** (Tether Gold) | Ethereum |

> [!NOTE]
> A transaction history / activity feed is **not wired** — the upstream starter's
> Activity section had no data source, so it is hidden rather than shown empty.

## Customizing

- **RPC endpoints** — the public defaults may rate-limit; swap in your own `provider`
  URLs in [`src/config/get-chains-config.ts`](src/config/get-chains-config.ts).
- **Swap routes** — sources are `ORCHESTRA_SOURCE_CHAINS` in
  [`src/config/get-wdk-configs.ts`](src/config/get-wdk-configs.ts); the screen's options
  are `SOURCES` / `DESTINATIONS` in [`src/app/swap.tsx`](src/app/swap.tsx). Check the
  pair exists in the [route matrix](https://orchestration.flashnet.xyz/v1/orchestration/routes).
- **Tokens** — [`src/config/assets.ts`](src/config/assets.ts) and
  [`src/config/get-token-configs.ts`](src/config/get-token-configs.ts), plus an icon in
  `assets/images/tokens/`.
- **Networks** — [`src/config/networks.ts`](src/config/networks.ts),
  [`src/config/get-chains-config.ts`](src/config/get-chains-config.ts), and a wallet
  module in [`wdk.config.js`](wdk.config.js); then `npm run bundle`.
- **Theme** — `brandConfig` in [`src/app/_layout.tsx`](src/app/_layout.tsx).

## Troubleshooting

**`pod install`: "The following Swift pods cannot yet be integrated as static libraries"**

The Spark wallet module pulls in gRPC-Swift and SwiftNIO, whose C targets don't define
modules. Fixed by [`plugins/withIosModularHeaders.js`](plugins/withIosModularHeaders.js),
which adds `use_modular_headers!` to the Podfile. If you see this, the Podfile is stale —
re-run:

```bash
npx expo prebuild --platform ios
```

**`pod install`: `Unicode Normalization not appropriate for ASCII-8BIT`**

A CocoaPods/Ruby 4.x incompatibility — CocoaPods needs a UTF-8 locale. `npm run ios`
sets one for you; if you invoke CocoaPods directly:

```bash
cd ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install
```

**`pod install` fails cloning a pod (`RPC failed; curl 92 ... HTTP/2 stream`)**

A transient GitHub HTTP/2 issue. Retry over HTTP/1.1 without touching your global config:

```bash
cd ios && GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.version GIT_CONFIG_VALUE_0=HTTP/1.1 pod install
```

**Swap screen says "No route available"**

Orchestra enforces route minimums. Try a larger amount, and check the pair is live in
the [route matrix](https://orchestration.flashnet.xyz/v1/orchestration/routes).

**`No swidge protocol registered for label: orchestra`** (registration reports success)

Almost always a **duplicate `@tetherto/wdk-wallet` in the bundle**. The Orchestra package
pins an exact older version, so npm nests a second copy under it and the bundle ends up
with two `SwidgeProtocol` base classes — WDK's `registerProtocol()` silently registers
nothing, then the lookup throws. This repo fixes it with `overrides` in `package.json`,
**but overrides only apply through the lockfile** — if you changed dependencies,
regenerate it:

```bash
rm -rf node_modules package-lock.json && npm install
```

`npm ls @tetherto/wdk-wallet` should report exactly one version, not `invalid`. The same
applies to the other overrides (`react-native-mmkv`, `expo-crypto`,
`expo-local-authentication`), which hold native modules to Expo SDK 54-compatible
versions.

**`Module not initialized: orchestra` / protocol not found**

The worklet bundle is stale or missing. Rebuild it and restart Metro:

```bash
npm run bundle && npx expo start -c
```

**"Failed to fetch balance" toasts for one chain (RPC 403/401)**

Free public RPC endpoints rot over time — upstream's Ethereum and Polygon defaults both
died and were replaced in this fork. If a chain's balance fetch starts failing, test the
`provider` URL in [`src/config/get-chains-config.ts`](src/config/get-chains-config.ts)
with a curl `eth_chainId` call and swap in a live endpoint.

## License, contributing, support

Licensed under [Apache-2.0](LICENSE). Contributions are welcome — see the
[contributing guide](CONTRIBUTING.md) and [code of conduct](CODE_OF_CONDUCT.md). For WDK
itself, see [docs.wallet.tether.io](https://docs.wallet.tether.io); for Orchestra, see
[docs.flashnet.xyz](https://docs.flashnet.xyz/products/orchestration/overview). Found a
problem here? Open an issue.
