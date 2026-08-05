# wdk-orchestra-module-starter

A self-custody, multi-chain mobile wallet with **cross-chain swaps built in** — a fork of
[`tetherto/wdk-starter-react-native`](https://github.com/tetherto/wdk-starter-react-native)
that adds [Flashnet Orchestra](https://docs.flashnet.xyz/products/orchestration/overview)
as a WDK swidge protocol.

Swap USDT on Arbitrum for BTC on Spark — or any of ~2,800 routes — from inside the wallet,
without giving up custody of your keys.

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
| [`src/config/get-wdk-configs.ts`](src/config/get-wdk-configs.ts) | Registers one Orchestra instance per source chain (Arbitrum and Polygon) |
| [`src/app/swap.tsx`](src/app/swap.tsx) | The swap screen — asset pickers for both sides, balances with a fee-aware Max, live quotes, two-step execute, order tracking |
| [`src/hooks/use-wallet.ts`](src/hooks/use-wallet.ts) | Compatibility shim for the upstream `useWallet` hook |
| [`plugins/withIosModularHeaders.js`](plugins/withIosModularHeaders.js) | Podfile fix so the Spark module's Swift pods build on iOS |

There is also a **dependency upgrade** that touches more files than that. Upstream
`develop` pins `@tetherto/wdk-react-native-core` to a GitHub commit that predates
`useProtocol` — and which no longer installs, because its own `pear-wrk-wdk#v2`
dependency points at a deleted branch over `git+ssh`. This fork moves to the published
`1.0.0-beta.15`, whose API differs enough to require mechanical updates across the wallet
screens (hook renames, `IAsset[]` balance queries, `assetId` instead of `tokenAddress`).

[docs/ORCHESTRA.md](docs/ORCHESTRA.md) documents the integration in full.

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

**Source payments are gasless.** The starter runs Arbitrum as an ERC-4337 Safe account
with a USDT paymaster, and Orchestra's source token for `arbitrum:USDT` is that same
contract — so a demo wallet only ever needs USDT, never ETH.

Click below to see the base wallet in action:

[![Demo Video](assets/docs/demo-thumbnail.png)](assets/docs/demo.mp4)

## 🔍 About WDK

This repository is part of the [**WDK (Wallet Development Kit)**](https://wallet.tether.io/) project, which empowers developers to build secure, non-custodial wallets with unified blockchain access, stateless architecture, and complete user control. 

For detailed documentation about the complete WDK ecosystem, visit [docs.wallet.tether.io](https://docs.wallet.tether.io).

## 🌟 Features

### Multi-Chain Support (ERC-4337 Safe Accounts)
- **Ethereum**: Safe smart contract account with gas sponsorship via paymaster
- **Polygon**: Safe account with low-cost transactions and gas sponsorship
- **Arbitrum**: Safe account on Layer 2 with gas sponsorship support
- **Plasma**: Safe account on Tether's native Layer 2 network
- **Sepolia**: Safe account on Ethereum testnet for development
- **Spark**: Bitcoin Layer 2 with instant transfers (native Bitcoin addresses)

### Network Mode Toggle
- **Mainnet/Testnet Switch**: Easy toggle between mainnet and testnet in settings
- **Automatic Refresh**: Balance and token lists update when switching modes
- **Consistent State**: All screens respect the current network mode

### Multi-Token Support
- **BTC**: Bitcoin on Spark network
- **USD₮ (Tether USD)**: Multi-chain USD₮ support (Ethereum, Polygon, Arbitrum, Plasma, Spark)
- **XAU₮ (Tether Gold)**: Gold-backed stablecoin on Ethereum

### Wallet Management
- **Secure Seed Generation**: Cryptographically secure 12-word mnemonic generation
- **Seed Import**: Import existing BIP39-compatible mnemonic phrases
- **Encrypted Storage**: Secure key storage via native secure storage (iOS Keychain, Android KeyStore)
- **Biometric Authentication**: Face ID/Touch ID for wallet unlock
- **Wallet Naming**: Custom wallet names for better organization

### Asset Management
- **Real-Time Balances**: Live balance reads over each chain's RPC (no indexer key required)
- **Price Conversion**: Real-time fiat pricing via Bitfinex integration
- **Multi-Asset View**: Aggregate portfolio view across all tokens and chains
- **Asset Details**: Detailed per-token views with per-network balances

### User Experience
- **Cross-Chain Swap**: Quote and execute Orchestra routes with live order tracking *(this fork)*
- **QR Code Scanner**: Scan wallet addresses and payment requests via camera
- **Send Flows**: Complete send flow with network and token selection
- **Receive Flows**: Generate QR codes for receiving payments
- **Settings**: Wallet management, security, and app preferences
- **Dark Mode**: Modern dark theme optimized for readability

> [!NOTE]
> A transaction history / activity feed is **not wired** in this fork — the upstream
> starter's Activity section had no data source, so it is hidden rather than shown empty.

## 🧱 Platform Prerequisites

- Node.js >= 20.19.4
- iOS: Xcode toolchain
- Android: SDK (see `app.json` build properties for version requirements)

## ⬇️ Installation

Clone this repository and install dependencies:

```bash
npm install
```

`postinstall` compiles the worklet bundle (`wdk.config.js` → `wdk-bundle/`, ~9 MB, about
3 seconds). It is gitignored; rebuild any time with `npm run bundle`.

## 🔄 Swap setup (this fork)

Copy the env file and add a **scoped Flashnet client key**:

```bash
cp .env.example .env
```

```bash
EXPO_PUBLIC_FLASHNET_API_KEY=your_scoped_client_key
EXPO_PUBLIC_FLASHNET_AUTH_MODE=client
```

Quoting works **without a key**, so you can see live pricing immediately; the key is
required to submit an order. `EXPO_PUBLIC_*` values are embedded in the built app and are
not secret — see [docs/ORCHESTRA.md §3](docs/ORCHESTRA.md#3-api-keys-in-a-mobile-app).

### Running a swap

1. Create or import a wallet, then open **Swap** from the wallet screen.
2. Fund the wallet's **Arbitrum** address (Settings → Wallet Addresses) with a small
   amount of **USDT** — no ETH is needed, the ERC-4337 paymaster covers gas in USDT.
   **~5 USDT is a comfortable demo amount**: routes enforce a minimum of roughly a
   dollar, the flat protocol fee is 0.01, and gas is capped at 0.1 USDT per transfer.
3. Pick what you pay with (USDT on Arbitrum or Polygon) and what you receive, then enter
   an amount — or tap **Max**, which reserves the paymaster fee headroom automatically.
   A live quote appears from Orchestra.
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

## 🔑 Environment Setup

**Optional but Recommended:** Configure API keys for balance, transaction data, and Tron network support:

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and configure the following:
# EXPO_PUBLIC_WDK_INDEXER_BASE_URL=https://wdk-api.tether.io
# EXPO_PUBLIC_WDK_INDEXER_API_KEY=your_wdk_api_key_here
# EXPO_PUBLIC_TRON_API_KEY=your_tron_api_key_here (optional, for Tron network)
# EXPO_PUBLIC_TRON_API_SECRET=your_tron_api_secret_here (optional, for Tron network)
```

**Note:** The WDK Indexer API key is used for balance and transaction API requests. While not mandatory for development, it enables full functionality. Tron API keys are optional and only needed if you want to use the Tron network. Get your free WDK Indexer API key in the [WDK docs](https://docs.wallet.tether.io/).

## 🔧 Provider Configuration (Recommended)

**For Better Performance:** The app uses public RPC endpoints by default, which may have rate limits and variable performance. (This fork already replaced two upstream defaults that had gone dead — `eth.merkle.io` and `polygon-rpc.com` — with PublicNode equivalents.) For a better experience, customize provider URLs in `src/config/get-chains-config.ts`:

### Customizable Endpoints

Edit `src/config/get-chains-config.ts` to update these provider URLs:

**Ethereum**
```typescript
ethereum: {
  provider: 'https://ethereum-rpc.publicnode.com',  // Replace with your Ethereum RPC URL
  bundlerUrl: 'https://api.candide.dev/public/v3/ethereum',
  paymasterUrl: 'https://api.candide.dev/public/v3/ethereum',
}
```

**Arbitrum**
```typescript
arbitrum: {
  provider: 'https://arb1.arbitrum.io/rpc',  // Replace with your Arbitrum RPC URL
  bundlerUrl: 'https://api.candide.dev/public/v3/arbitrum',
  paymasterUrl: 'https://api.candide.dev/public/v3/arbitrum',
}
```

Do the same for other chains.


## 🚀 Run

Then start the app:

```bash
# iOS simulator
npm run ios

# Android emulator/device
npm run android
```

## 📁 Project Structure

```
src/
├── app/                         # App screens (Expo Router file-based routing)
│   ├── _layout.tsx              # Root layout with providers
│   ├── index.tsx                # Entry point & routing logic
│   ├── onboarding/              # Onboarding flow screens
│   ├── wallet-setup/            # Wallet creation/import flows
│   ├── wallet.tsx               # Main wallet dashboard
│   ├── assets.tsx               # Asset list screen
│   ├── send/                    # Send flow screens
│   ├── receive/                 # Receive flow screens
│   ├── authorize.tsx            # Biometric authentication
│   ├── settings.tsx             # App settings
│   ├── scan-qr.tsx              # QR code scanner
│   ├── swap.tsx                 # [fork] Cross-chain swap via Flashnet Orchestra
│   └── token-details.tsx        # Individual token details
├── components/                  # Reusable UI components
│   ├── onboarding/              # Onboarding components
│   ├── ui/                      # Base UI components
│   └── *.tsx                    # Shared components
├── config/                      # Configuration files
│   ├── assets.ts                # Token/asset configurations
│   ├── avatar-options.ts        # Wallet avatar configurations
│   ├── networks.ts              # Network configurations
│   ├── get-chains-config.ts     # Chain-specific settings & provider URLs
│   ├── get-token-configs.ts     # Token metadata + IAsset list for balance queries
│   └── get-wdk-configs.ts       # [fork] Worklet config; registers Orchestra as a swidge protocol
├── services/                    # Business logic & external services
│   └── pricing-service.ts       # Fiat pricing via Bitfinex
├── hooks/                       # Custom React hooks
│   ├── use-debounced-navigation.ts  # Debounced navigation to prevent rapid taps
│   ├── use-keyboard.ts          # Keyboard visibility detection
│   ├── use-wallet.ts            # [fork] Compatibility shim for the removed useWallet hook
│   └── use-wallet-avatar.ts     # Wallet avatar management
└── utils/                       # Utility functions
    ├── gas-fee-calculator.ts    # Gas fee estimation & network utilities
    ├── format-amount.ts         # Amount formatting helpers
    ├── format-token-amount.ts   # Token-specific amount formatting
    ├── format-usd-value.ts      # USD value formatting
    ├── get-display-symbol.ts    # Token symbol display utilities
    ├── get-denomination-value.ts # Token denomination utilities
    ├── parse-worklet-error.ts   # Worklet error parsing for better UX
    └── recent-tokens.ts         # Recent token tracking
```

## 🏗️ Architecture & Key Flows

### App Architecture
The app follows a clean architecture pattern with clear separation of concerns:

1. **Providers Layer** (`_layout.tsx`)
   - `WalletProvider`: Manages wallet state, ERC-4337 Safe accounts, blockchain interactions, and WDK service
   - `ThemeProvider`: Handles dark mode and custom theming
   - `NavigationThemeProvider`: React Navigation theme configuration

2. **Screen Layer** (`app/` directory)
   - File-based routing via Expo Router
   - Each screen is a self-contained React component
   - Navigation handled automatically based on file structure

3. **Business Logic** (`services/` directory)
   - Pricing service for real-time fiat conversion

4. **Configuration** (`config/` directory)
   - Centralized network and asset configurations
   - Chain-specific RPC endpoints and settings

### User Flows

#### First-Time User (Create Wallet)
1. **Onboarding** → View welcome screen with app features
2. **Wallet Setup** → Choose "Create New Wallet"
3. **Name Wallet** → Set a custom wallet name
4. **Secure Wallet** → View and backup 12-word seed phrase
5. **Confirm Phrase** → Verify seed phrase knowledge
6. **Complete** → Wallet created and unlocked
7. **Wallet Dashboard** → Access main wallet interface

#### Returning User (Import Wallet)
1. **Onboarding** → View welcome screen
2. **Wallet Setup** → Choose "Import Existing Wallet"
3. **Import Wallet** → Enter 12-word seed phrase
4. **Name Wallet** → Set a custom wallet name
5. **Complete** → Wallet imported and unlocked
6. **Wallet Dashboard** → Access main wallet interface

#### Existing User (App Launch)
1. **Entry Point** (`index.tsx`) → Check wallet status
2. **Authorization** → Biometric authentication (Face ID/Touch ID)
3. **Wallet Dashboard** → Access wallet after unlock

#### Send Flow
1. **Wallet Dashboard** → Tap "Send" button
2. **Select Token** → Choose token to send (BTC, USD₮, XAU₮)
3. **Select Network** → Choose blockchain network
4. **Send Details** → Enter recipient address, amount, and review fees
5. **Confirm** → Approve transaction
6. **Transaction Submitted** → View transaction status

#### Receive Flow
1. **Wallet Dashboard** → Tap "Receive" button
2. **Select Token** → Choose token to receive
3. **Select Network** → Choose blockchain network
4. **Receive Details** → View QR code and address, copy or share

## 🌐 Supported Networks & Operations

This starter supports the following blockchain networks and operations:

### Mainnet Networks (ERC-4337 Safe Accounts)
| Network | Account Type | Balance | Send | Receive | Swap source | Gas Sponsorship |
|---------|--------------|---------|------|---------|-------------|-----------------|
| **Ethereum** | Safe (ERC-4337) | ✅ | ✅ | ✅ | — | ✅ |
| **Polygon** | Safe (ERC-4337) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Arbitrum** | Safe (ERC-4337) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Plasma** | Safe (ERC-4337) | ✅ | ✅ | ✅ | — | ✅ |
| **Spark** | Native (Bitcoin) | ✅ | ✅ | ✅ | — | N/A |

### Testnet Networks
| Network | Account Type | Balance | Send | Receive | Swap source | Gas Sponsorship |
|---------|--------------|---------|------|---------|-------------|-----------------|
| **Sepolia** | Safe (ERC-4337) | ✅ | ✅ | ✅ | — | ✅ |
| **Spark (Regtest)** | Native (Bitcoin) | ✅ | ✅ | ✅ | — | N/A |

Orchestra routes are mainnet-only, so the swap screen is a mainnet feature. Adding more
swap source chains is one config entry — see `ORCHESTRA_SOURCE_CHAINS` in
[`src/config/get-wdk-configs.ts`](src/config/get-wdk-configs.ts).

### Token Support

| Token | Symbol | Networks (Account Type) |
|-------|--------|-------------------------|
| **Bitcoin** | BTC | Spark (Native) |
| **Tether USD** | USD₮ | Ethereum (Safe), Polygon (Safe), Arbitrum (Safe), Plasma (Safe), Spark (Native), Sepolia (Safe) |
| **Tether Gold** | XAU₮ | Ethereum (Safe) |

### Key Features
- **ERC-4337 Safe Accounts**: All EVM networks use Safe smart contract accounts for enhanced security and flexibility
- **Gas Sponsorship**: EVM networks (Ethereum, Polygon, Arbitrum, Plasma) offer gasless transactions via paymasters - users don't need native tokens for gas
- **Multi-Network**: Send the same token across different networks based on preference and fees
- **Real-Time Data**: Live balance updates read directly from each chain's RPC
- **QR Code Support**: Generate and scan QR codes for easy address sharing

## 🔒 Security Features

This starter implements multiple layers of security for protecting user assets:

### Smart Contract Account Security (ERC-4337)
- **Safe Accounts**: EVM networks use battle-tested Safe smart contract accounts
- **Account Abstraction**: Enhanced transaction validation and execution logic
- **Gasless Transactions**: Users don't need native tokens for gas - transactions are sponsored via paymasters
- **Future Flexibility**: Smart contract accounts enable future features like social recovery, spending limits, and multi-sig

### Secure Key Management
- **BareKit Worklets**: Cryptographic operations run in isolated worklet context
- **Secret Manager**: Keys stored encrypted using native secure storage (iOS Keychain, Android KeyStore)
- **No Key Exposure**: Private keys never leave the secure context or device
- **BIP39 Compliant**: Standard 12-word mnemonic seed phrase generation

### Authentication
- **Biometric Lock**: Face ID/Touch ID for wallet unlock
- **App Lock**: Wallet locked on app background/close
- **Session Management**: Secure session handling with automatic timeout

### Transaction Security
- **User Confirmation**: All transactions require explicit user approval
- **Amount Verification**: Clear display of amounts and fees before signing
- **Address Validation**: Input validation for recipient addresses
- **Network Selection**: User must explicitly choose network to prevent errors

### Best Practices
- **No Analytics**: No user data or transaction info sent to third parties
- **Local Storage**: All wallet data stored locally on device
- **Open Source**: Fully auditable codebase
- **Non-Custodial**: Users have complete control of their private keys

## ⚙️ Polyfills & Build Configuration

### Node.js Polyfills
The app includes comprehensive Node.js polyfills for React Native compatibility via `@tetherto/wdk-react-native-core/metro-polyfills`
### Native Modules
- **Sodium**: `sodium-javascript` (WebAssembly-based cryptography)
- **Random**: `react-native-get-random-values` (secure randomness)
- **PBKDF2**: `react-native-fast-pbkdf2` (key derivation)
- **TCP**: `react-native-tcp-socket` (for Bitcoin Electrum)

## 🧪 Available Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start Expo development server with dev client |
| `npm run ios` | Run on iOS simulator |
| `npm run android` | Run on Android emulator/device |
| `npm run web` | Run in web browser |
| `npm run prebuild` | Generate native project files |
| `npm run prebuild:clean` | Clean and regenerate native project files |
| `npm run lint` | Run ESLint to check code quality |
| `npm run lint:fix` | Run ESLint and auto-fix issues |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check code formatting without making changes |
| `npm run typecheck` | Run TypeScript type checking |

## 🔗 Version & Compatibility

### Core Dependencies
- **Expo**: 54.0.31
- **React**: 19.1.0
- **React Native**: 0.81.4
- **TypeScript**: 5.9.2

### Key Features
- **New Architecture**: Enabled in `app.json` for improved performance
- **React Native Reanimated**: 4.1.6 for smooth animations
- **React Compiler**: Enabled for automatic memoization

### Platform Requirements
- **Android**: minSdkVersion 29, compileSdkVersion 36
- **iOS**: Latest Xcode toolchain recommended
- **Node.js**: >= 20.19.4 required

### WDK Packages
- `@tetherto/wdk-react-native-core`: Core wallet provider with hooks and state management
- `@tetherto/wdk-uikit-react-native`: UI components library
- `@tetherto/wdk-pricing-provider`: Fiat pricing integration
- `@tetherto/wdk-pricing-bitfinex-http`: Bitfinex price data provider

## 🎨 Customization Guide

### Adding New Tokens
1. Add token configuration in `src/config/assets.ts`:
```typescript
export const assetConfig: Record<string, AssetConfig> = {
  newtoken: {
    name: 'New Token',
    icon: require('../../assets/images/tokens/newtoken-logo.png'),
    color: '#YOUR_COLOR',
    supportedNetworks: [NetworkType.ETHEREUM],
  },
};
```

2. Add token icon to `assets/images/tokens/`

### Adding New Networks
1. Add network configuration in `src/config/networks.ts`:
```typescript
[NetworkType.NEW_NETWORK]: {
  id: 'new-network',
  name: 'New Network',
  gasLevel: 'Low',
  gasColor: '#34C759',
  icon: require('../../assets/images/chains/new-network-logo.png'),
  color: '#YOUR_COLOR',
}
```

2. Add chain configuration in `src/config/get-chains-config.ts`:
```typescript
newnetwork: {
  chainId: YOUR_CHAIN_ID,
  blockchain: 'newnetwork',
  provider: 'https://your-rpc-url.com',
  // Add other chain-specific configuration
}
```

3. Add chain logo to `assets/images/chains/`

### Customizing Theme & Brand
Update the brand configuration in `src/app/_layout.tsx`:
```typescript
<ThemeProvider
  defaultMode="dark"
  brandConfig={{
    primaryColor: '#YOUR_BRAND_COLOR',
  }}
>
```

## 🐛 Troubleshooting

### Common Issues

**Metro bundler cache issues**
```bash
npx expo start -c
```

**Native build issues**
```bash
npm run prebuild:clean
cd ios && pod install
cd android && ./gradlew clean
```

**Type errors after updates**
```bash
npm run typecheck
```

**`Unicode Normalization not appropriate for ASCII-8BIT` during `pod install`**

A CocoaPods/Ruby 4.x incompatibility, not a project problem — CocoaPods needs a UTF-8
locale. `npm run ios` sets one for you (it also covers the `pod install` that
`expo run:ios` runs internally). If you invoke CocoaPods directly:

```bash
cd ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install
```

**`pod install` fails cloning a pod (`RPC failed; curl 92 ... HTTP/2 stream`)**

A transient GitHub HTTP/2 issue. Retry over HTTP/1.1 without touching your global
git config:

```bash
cd ios && GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.version GIT_CONFIG_VALUE_0=HTTP/1.1 pod install
```

**`pod install` fails: "The following Swift pods cannot yet be integrated as static libraries"**

The Spark wallet module pulls in gRPC-Swift and SwiftNIO, whose C targets don't define
modules. Fixed by [`plugins/withIosModularHeaders.js`](plugins/withIosModularHeaders.js),
which adds `use_modular_headers!` to the Podfile. If you see this, the plugin isn't
registered in `app.json` or the Podfile is stale — re-run:

```bash
npx expo prebuild --platform ios
```

**Swap screen says "No route available"**

Orchestra enforces route minimums. Try a larger amount, and check the pair is live in
the [route matrix](https://orchestration.flashnet.xyz/v1/orchestration/routes).

**`No swidge protocol registered for label: orchestra`** (registration reports success)

Almost always a **duplicate `@tetherto/wdk-wallet` in the bundle**. The Orchestra package
pins an exact older version, so npm nests a second copy under it and the bundle ends up
with two `SwidgeProtocol` base classes. WDK's `registerProtocol()` checks
`instanceof SwidgeProtocol` against *its* copy and silently registers nothing — every
layer reports success, then the lookup throws. This repo fixes it with an `overrides`
entry in `package.json` forcing the hoisted version, **but overrides only apply through
the lockfile** — if you changed dependencies, regenerate it:

```bash
rm -rf node_modules package-lock.json && npm install
```

The same rule applies to the other three overrides (`react-native-mmkv`, `expo-crypto`,
`expo-local-authentication`), which hold transitive native modules back to versions
compatible with Expo SDK 54 — `npm ls react-native-mmkv` should report exactly one
version, not `invalid`.

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

### Development Tips
- Use Expo Dev Client for faster development cycles
- Enable Fast Refresh for instant UI updates
- Check Metro bundler logs for build issues
- Use React DevTools for component debugging
- Monitor network requests in browser DevTools (web) or Reactotron (native)

## 📜 License

This project is licensed under the Apache-2.0 - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

- Read the [code of conduct](CODE_OF_CONDUCT.md)
- See [contributing guide](CONTRIBUTING.md)

## 🆘 Support

For support, please:
- Check the [WDK documentation](https://docs.wallet.tether.io)
- Open an issue on the GitHub repository
- Join the WDK developer community
