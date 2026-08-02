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

import { BaseAsset } from '@tetherto/wdk-react-native-core';
import { NetworkMode } from '@/services/network-mode-service';

export type TokenConfig = {
  address: string | null;
  symbol: string;
  name: string;
  decimals: number;
};

/**
 * Per-network token metadata, keyed by the network names in get-chains-config.ts.
 *
 * `@tetherto/wdk-react-native-core` stopped exporting this type in 1.0.0-beta.15
 * and balance queries now take a flat `IAsset[]` instead. The nested shape is
 * kept here because the screens read symbols and decimals off it; `getAssets()`
 * derives the flat list the balance hooks want.
 */
export type TokenConfigs = Record<string, { native: TokenConfig; tokens: TokenConfig[] }>;

const MAINNET_NETWORKS: string[] = ['ethereum', 'polygon', 'arbitrum', 'spark', 'plasma'];
const TESTNET_NETWORKS: string[] = ['sepolia', 'spark'];

const ALL_TOKEN_CONFIGS: TokenConfigs = {
  sepolia: {
    native: { address: null, symbol: 'ETH', name: 'Sepolia ETH', decimals: 18 },
    tokens: [
      {
        address: '0xd077a400968890eacc75cdc901f0356c943e4fdb',
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 6,
      },
    ],
  },
  plasma: {
    native: { address: null, symbol: 'ETH', name: 'Plasma ETH', decimals: 18 },
    tokens: [],
  },
  spark: {
    native: { address: null, symbol: 'BTC', name: 'Bitcoin', decimals: 8 },
    tokens: [],
  },
  ethereum: {
    native: { address: null, symbol: 'ETH', name: 'Ethereum', decimals: 18 },
    tokens: [
      {
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 6,
      },
      {
        address: '0x68749665FF8D2d112Fa859AA293F07A622782F38',
        symbol: 'XAUT',
        name: 'Tether Gold',
        decimals: 6,
      },
    ],
  },
  arbitrum: {
    native: { address: null, symbol: 'ETH', name: 'Ethereum', decimals: 18 },
    tokens: [
      {
        address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 6,
      },
    ],
  },
  polygon: {
    native: { address: null, symbol: 'MATIC', name: 'Polygon', decimals: 18 },
    tokens: [
      {
        address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 6,
      },
    ],
  },
};

const getTokenConfigs = (networkMode?: NetworkMode): TokenConfigs => {
  if (!networkMode) {
    return ALL_TOKEN_CONFIGS;
  }

  const allowedNetworks = networkMode === 'testnet' ? TESTNET_NETWORKS : MAINNET_NETWORKS;

  return Object.fromEntries(
    Object.entries(ALL_TOKEN_CONFIGS).filter(([key]) => allowedNetworks.includes(key))
  ) as TokenConfigs;
};

/** Stable identifier that comes back as `BalanceFetchResult.assetId`. */
export const assetId = (network: string, symbol: string) => `${network}:${symbol}`;

/**
 * Flat asset list for the balance hooks, which take `IAsset[]` as of beta.15.
 * Native coins and tokens are both represented; ids are assigned here, so
 * balance results can be mapped straight back to token metadata.
 */
export const getAssets = (networkMode?: NetworkMode): BaseAsset[] => {
  const configs = getTokenConfigs(networkMode);

  return Object.entries(configs).flatMap(([network, { native, tokens }]) => [
    new BaseAsset({
      id: assetId(network, native.symbol),
      network,
      symbol: native.symbol,
      name: native.name,
      decimals: native.decimals,
      isNative: true,
      address: null,
    }),
    ...tokens.map(
      (token) =>
        new BaseAsset({
          id: assetId(network, token.symbol),
          network,
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          isNative: false,
          address: token.address,
        })
    ),
  ]);
};

/** Resolve token metadata for a balance result. Returns undefined if unknown. */
export const getAssetMeta = (
  configs: TokenConfigs,
  network: string,
  id: string
): { config: TokenConfig; isNative: boolean } | undefined => {
  const networkTokens = configs[network];
  if (!networkTokens) return undefined;

  if (id === assetId(network, networkTokens.native.symbol)) {
    return { config: networkTokens.native, isNative: true };
  }

  const token = networkTokens.tokens.find((entry) => assetId(network, entry.symbol) === id);
  return token ? { config: token, isNative: false } : undefined;
};

export default getTokenConfigs;
