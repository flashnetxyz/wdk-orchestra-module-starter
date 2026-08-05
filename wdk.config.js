// Worklet bundle definition for the WDK engine.
//
// Everything listed here is compiled into a single artifact that runs inside a
// Bare worklet on its own thread, isolated from the UI. Wallet modules provide
// the accounts; protocol modules provide operations on top of those accounts.
//
// Regenerate after changing this file:
//   npx wdk-worklet-bundler generate --install

module.exports = {
  transport: 'hrpc',

  // Wallet modules, keyed by the network names used in src/config/get-chains-config.ts.
  // Every EVM chain here is configured with a bundler + paymaster, so they run as
  // ERC-4337 smart accounts and can pay gas in USDT.
  networks: {
    ethereum: { package: '@tetherto/wdk-wallet-evm-erc-4337' },
    arbitrum: { package: '@tetherto/wdk-wallet-evm-erc-4337' },
    polygon: { package: '@tetherto/wdk-wallet-evm-erc-4337' },
    plasma: { package: '@tetherto/wdk-wallet-evm-erc-4337' },
    sepolia: { package: '@tetherto/wdk-wallet-evm-erc-4337' },
    spark: { package: '@tetherto/wdk-wallet-spark' },
    // Plain (non-gasless) Solana wallet: SPL transfers pay fees in SOL.
    solana: { package: '@tetherto/wdk-wallet-solana' },
  },

  // Protocol modules. `orchestra` is the only addition this fork makes to the
  // upstream starter: it exposes Flashnet Orchestra as a WDK SwidgeProtocol, so
  // accounts gain getSwidgeProtocol('orchestra') inside the worklet.
  protocols: {
    orchestra: { package: 'wdk-protocol-swidge-orchestra' },
  },

  // Native addon backing Spark's FROST signing. Must be required before anything else.
  preloadModules: ['@buildonspark/spark-frost-bare-addon'],

  // Deliberately not a dot-directory: Metro and watchman treat leading-dot
  // folders inconsistently, and the app imports this file directly.
  output: {
    bundle: './wdk-bundle/wdk-worklet.bundle.js',
  },
};
