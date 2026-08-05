// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type { WdkConfigs } from '@tetherto/wdk-react-native-core';
import getChainsConfig, { SparkNetworkMode } from './get-chains-config';
import { NetworkMode } from '@/services/network-mode-service';

/**
 * Chains Orchestra can send source payments from. One Orchestra instance is
 * registered per source chain (the protocol is bound to a single account).
 *
 * Arbitrum is the default because the starter already runs it as an ERC-4337
 * smart account with a USDT paymaster — so the source transfer is gasless and
 * a demo wallet only ever needs USDT, never ETH. Polygon works the same way.
 * Solana uses a plain wallet instead, so its source payment pays fees in SOL.
 */
export const ORCHESTRA_SOURCE_CHAINS = ['arbitrum', 'polygon', 'solana'] as const;

/** Default source chain for the swap screen. */
export const ORCHESTRA_SOURCE_CHAIN = 'arbitrum';

/** Protocol name registered in wdk.config.js; also what getSwidgeProtocol() takes. */
export const ORCHESTRA_PROTOCOL = 'orchestra';

/**
 * Token contracts Orchestra uses for EVM source payments, keyed '<chain>:<asset>'.
 *
 * The package ships defaults, but production wallets are expected to pass their
 * own allowlist. These match the live Orchestra route matrix at
 * https://orchestration.flashnet.xyz/v1/orchestration/routes
 */
export const ORCHESTRA_SOURCE_TOKENS: Record<string, string> = {
  'arbitrum:USDT': '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  'ethereum:USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  'polygon:USDT': '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  'solana:USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

/**
 * Builds the config the WDK worklet is initialised with.
 *
 * `networks` registers wallet modules; `protocols` registers Orchestra as a
 * SwidgeProtocol on the source chain, which is what makes
 * `useProtocol({ protocolType: 'swidge', protocolName: 'orchestra' })` resolve.
 */
export const getWdkConfigs = (
  sparkNetwork: SparkNetworkMode = 'MAINNET',
  networkMode?: NetworkMode
): WdkConfigs => {
  const chains = getChainsConfig(sparkNetwork, networkMode);

  // The worklet expects { [network]: { blockchain, config } }, and asserts that
  // the key matches the blockchain field.
  const networks = Object.fromEntries(
    Object.entries(chains).map(([name, config]) => [name, { blockchain: name, config }])
  ) as WdkConfigs['networks'];

  const protocols: WdkConfigs['protocols'] = {};

  // One registration per source chain, all under the same protocol name —
  // WDK keys protocol registrations by (blockchain, name), so
  // useProtocol({ network, protocolName: 'orchestra' }) picks the right one.
  for (const sourceChain of ORCHESTRA_SOURCE_CHAINS) {
    if (!networks[sourceChain]) continue;
    protocols[`${ORCHESTRA_PROTOCOL}-${sourceChain}`] = {
      blockchain: sourceChain,
      protocolName: ORCHESTRA_PROTOCOL,
      config: {
        sourceChain,
        apiKey: process.env.EXPO_PUBLIC_FLASHNET_API_KEY,
        // Scoped client keys are the safe choice for a shipped mobile bundle;
        // anything in EXPO_PUBLIC_* is readable by anyone who unzips the app.
        authMode: process.env.EXPO_PUBLIC_FLASHNET_AUTH_MODE ?? 'client',
        sourceTokenAddresses: ORCHESTRA_SOURCE_TOKENS,
        ...(process.env.EXPO_PUBLIC_FLASHNET_BASE_URL
          ? { baseUrl: process.env.EXPO_PUBLIC_FLASHNET_BASE_URL }
          : {}),
      },
    };
  }

  return { networks, protocols };
};

export default getWdkConfigs;
