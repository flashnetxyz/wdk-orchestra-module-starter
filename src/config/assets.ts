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

import { FiatCurrency } from '@/services/pricing-service';
import { NetworkType } from '@/config/networks';

export interface AssetConfig {
  name: string;
  symbol: string;
  icon: any;
  color: string;
  supportedNetworks: NetworkType[];
}

export interface Asset {
  id: string;
  name: string;
  symbol: string;
  amount: string;
  fiatValue: number;
  fiatCurrency: FiatCurrency;
  icon: string | any;
  color: string;
}

export type AssetTicker = 'btc' | 'usdt' | 'xaut' | 'sol';

export const assetConfig: Record<string, AssetConfig> = {
  btc: {
    name: 'Bitcoin',
    symbol: 'BTC',
    icon: require('../../assets/images/tokens/bitcoin-btc-logo.png'),
    color: 'transparent',
    supportedNetworks: ['spark'],
  },
  usdt: {
    name: 'USD₮',
    symbol: 'USD₮',
    icon: require('../../assets/images/tokens/tether-usdt-logo.png'),
    color: 'transparent',
    supportedNetworks: ['ethereum', 'polygon', 'arbitrum', 'plasma', 'sepolia', 'solana'],
  },
  sol: {
    name: 'Solana',
    symbol: 'SOL',
    icon: require('../../assets/images/chains/solana-sol-logo.png'),
    color: 'transparent',
    supportedNetworks: ['solana'],
  },
  xaut: {
    name: 'XAU₮',
    symbol: 'XAU₮',
    icon: require('../../assets/images/tokens/tether-xaut-logo.png'),
    color: 'transparent',
    supportedNetworks: ['ethereum'],
  },
};
