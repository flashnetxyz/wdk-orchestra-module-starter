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

import { useCallback, useMemo } from 'react';
import { useAddresses, useWdkApp } from '@tetherto/wdk-react-native-core';

/**
 * Compatibility shim for the `useWallet` hook that older builds of
 * `@tetherto/wdk-react-native-core` exported.
 *
 * That hook was removed in 1.0.0-beta.15 and split into `useWdkApp` (app
 * lifecycle) and `useAddresses` (address book). This fork needs beta.15 for
 * `useProtocol`, which is what exposes Flashnet Orchestra to the UI. Rather
 * than rewrite every screen, the old surface is reassembled here so the
 * screens keep reading the way they do upstream.
 *
 * `callAccountMethod` is deliberately not reimplemented: it needs the network
 * at hook-call time in beta.15, so the one screen that sent transactions
 * (`app/send/details.tsx`) uses `useAccount` directly instead.
 */
export interface UseWalletResult {
  /** network -> accountIndex -> address, for the active wallet. */
  addresses: Record<string, Record<number, string>>;
  isInitialized: boolean;
  getAddress: (network: string, accountIndex?: number) => Promise<string>;
}

export function useWallet(_options?: { walletId?: string }): UseWalletResult {
  // The screens pass the already-active wallet id, so there is no wallet
  // switching to do here — `useAddresses` always reflects the active wallet.
  const { state } = useWdkApp();
  const { data, getAddressesForNetwork, loadAddresses } = useAddresses();

  const isInitialized = state.status === 'READY';

  const addresses = useMemo(() => {
    const byNetwork: Record<string, Record<number, string>> = {};
    for (const info of data ?? []) {
      byNetwork[info.network] ??= {};
      byNetwork[info.network][info.accountIndex] = info.address;
    }
    return byNetwork;
  }, [data]);

  const getAddress = useCallback(
    async (network: string, accountIndex = 0): Promise<string> => {
      const cached = getAddressesForNetwork(network).find(
        (entry) => entry.accountIndex === accountIndex
      );
      if (cached) {
        return cached.address;
      }

      const [result] = await loadAddresses([accountIndex], [network]);
      if (result?.success) {
        return result.address;
      }
      throw result?.reason ?? new Error(`Could not derive a ${network} address`);
    },
    [getAddressesForNetwork, loadAddresses]
  );

  return { addresses, isInitialized, getAddress };
}
