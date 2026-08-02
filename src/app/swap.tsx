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

import {
  useBalancesForWallet,
  useProtocol,
  useWalletManager,
} from '@tetherto/wdk-react-native-core';
import { ArrowDown, Check, ChevronDown, Zap } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageSourcePropType,
  Keyboard,
  LayoutAnimation,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toast } from 'sonner-native';
import Header from '@/components/header';
import { colors } from '@/constants/colors';
import getChainsConfig from '@/config/get-chains-config';
import { assetId, getAssets } from '@/config/get-token-configs';
import { ORCHESTRA_PROTOCOL } from '@/config/get-wdk-configs';
import { networkConfigs, NetworkType } from '@/config/networks';
import { useWallet } from '@/hooks/use-wallet';
import getErrorMessage from '@/utils/get-error-message';

/**
 * Values crossing the worklet boundary are JSON, and the worklet serialises
 * BigInt as a decimal string — so amounts arrive as strings, not bigints.
 */
type WireAmount = string | number;

type WireFee = { type: string; amount: WireAmount; token: string };

type SwidgeQuote = {
  fromTokenAmount: WireAmount;
  toTokenAmount: WireAmount;
  toTokenAmountMin: WireAmount;
  fees: WireFee[];
  estimatedDuration?: number;
  expiry?: number;
  priceImpact?: number;
};

/** Returned by prepareSwap() — a quoted route that has not moved any funds yet. */
type SwapIntent = Record<string, unknown> & { quoteId?: string };

/** Returned by executeSwapIntent() — the source payment has been sent and submitted. */
type SwapState = SwapIntent & {
  orderId?: string;
  /** Scoped client keys get a per-order read token; status calls need it back. */
  readToken?: string;
  sourceTxHash?: string;
  status?: string;
  amountIn?: WireAmount;
  estimatedOut?: WireAmount;
};

type OrderStatus = { status?: string; order?: { status?: string } };

/** The slice of Flashnet Orchestra this screen drives. */
type OrchestraSwidge = {
  quoteSwidge: (options: Record<string, unknown>) => Promise<SwidgeQuote | undefined>;
  prepareSwap: (options: Record<string, unknown>) => Promise<SwapIntent | undefined>;
  executeSwapIntent: (intent: SwapIntent) => Promise<SwapState | undefined>;
  getOrderStatus: (target: SwapState) => Promise<OrderStatus | undefined>;
};

/** Decimals for tokens fees can be quoted in; stablecoins default to 6. */
const FEE_DECIMALS: Record<string, number> = { USDT: 6, USDC: 6, BTC: 8, ETH: 18 };

/**
 * Source options — each is a chain Orchestra was registered on in
 * get-wdk-configs.ts, running as an ERC-4337 account with a USDT paymaster
 * so the source payment stays gasless.
 */
const SOURCES = [
  { chain: 'arbitrum', asset: 'USDT', label: 'Tether USD', decimals: 6 },
  { chain: 'polygon', asset: 'USDT', label: 'Tether USD', decimals: 6 },
] as const;

type Source = (typeof SOURCES)[number];

const TOKEN_ICONS: Record<string, ImageSourcePropType> = {
  USDT: require('../../assets/images/tokens/tether-usdt-logo.png'),
  BTC: require('../../assets/images/tokens/bitcoin-btc-logo.png'),
};

/**
 * Destinations are limited to chains this wallet also holds an address for, so
 * the swapped funds land back in the app and the demo closes the loop.
 * The full route matrix is at:
 * https://orchestration.flashnet.xyz/v1/orchestration/routes
 */
const DESTINATIONS = [
  { chain: 'spark', asset: 'BTC', label: 'Bitcoin', decimals: 8 },
  { chain: 'ethereum', asset: 'USDT', label: 'Tether USD', decimals: 6 },
  { chain: 'polygon', asset: 'USDT', label: 'Tether USD', decimals: 6 },
] as const;

type Destination = (typeof DESTINATIONS)[number];

/** Human amount -> base units, without floating point drift. */
function toBaseUnits(value: string, decimals: number): string | null {
  if (!/^\d*\.?\d*$/.test(value) || value === '' || value === '.') return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) return null;
  const padded = fraction.padEnd(decimals, '0');
  const combined = `${whole}${padded}`.replace(/^0+/, '') || '0';
  return combined === '0' ? null : combined;
}

/** Base units -> human string, trimming trailing zeros. */
function fromBaseUnits(value: WireAmount, decimals: number): string {
  const raw = String(value ?? '0');
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Token logo with the chain badge tucked into the corner. */
function TokenIcon({ asset, chain, size = 36 }: { asset: string; chain: string; size?: number }) {
  const badge = networkConfigs[chain as NetworkType]?.icon;
  const badgeSize = Math.round(size * 0.45);
  return (
    <View style={{ width: size, height: size }}>
      <Image
        source={TOKEN_ICONS[asset] ?? TOKEN_ICONS.USDT}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
      {badge ? (
        <Image
          source={badge}
          style={[
            styles.chainBadge,
            {
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

export default function SwapScreen() {
  const insets = useSafeAreaInsets();
  const { wallets, activeWalletId } = useWalletManager();
  const currentWalletId = activeWalletId || wallets[0]?.identifier || 'default';
  const { isInitialized, getAddress } = useWallet({ walletId: currentWalletId });

  const [amount, setAmount] = useState('');
  const [source, setSource] = useState<Source>(SOURCES[0]);
  const [destination, setDestination] = useState<Destination>(DESTINATIONS[0]);
  const [picker, setPicker] = useState<'source' | 'destination' | null>(null);
  const [quote, setQuote] = useState<SwidgeQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [state, setState] = useState<SwapState | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // True once the on-screen amount/quote have been submitted. The form stays
  // visible — clearing it mid-flow made the whole card stack jump — but a
  // spent form can't be re-submitted until it is edited or explicitly reset.
  const [formSpent, setFormSpent] = useState(false);

  // This is the whole integration: a swidge protocol bound to the selected
  // source account. Every call is forwarded into the worklet and executed
  // against account.getSwidgeProtocol('orchestra') on that chain.
  const orchestra = useProtocol<OrchestraSwidge>({
    network: source.chain,
    accountIndex: 0,
    protocolType: 'swidge',
    protocolName: ORCHESTRA_PROTOCOL,
  });

  // A route to the source itself is not a swap; hide it from the picker.
  const destinations = DESTINATIONS.filter(
    (option) => !(option.chain === source.chain && option.asset === source.asset)
  );

  // Guards against a slow quote landing after a newer one.
  const quoteSeq = useRef(0);

  const baseAmount = toBaseUnits(amount, source.decimals);

  // Balances for both sides, read the standard way: useBalancesForWallet()
  // over the shared asset list from get-token-configs, narrowed to the two
  // assets on screen.
  const sourceAssetId = assetId(source.chain, source.asset);
  const destinationAssetId = assetId(destination.chain, destination.asset);
  const swapAssets = useMemo(
    () =>
      getAssets().filter(
        (asset) => asset.getId() === sourceAssetId || asset.getId() === destinationAssetId
      ),
    [sourceAssetId, destinationAssetId]
  );
  const { data: balanceResults, refetch: refetchBalance } = useBalancesForWallet(0, swapAssets, {
    enabled: isInitialized && swapAssets.length > 0,
  });
  const readBalance = (id: string) => {
    const entry = balanceResults?.find((result) => result.assetId === id);
    return entry?.success ? String(entry.balance ?? '0') : null;
  };
  const balanceBase = readBalance(sourceAssetId);
  const destinationBalanceBase = readBalance(destinationAssetId);

  // Gas comes out of the same token via the paymaster, capped at the module's
  // transferMaxFee (in base units — see the wallet-modules docs). Max reserves
  // that cap: swapping the full balance leaves nothing to pay the fee with,
  // and the paymaster rejects the operation at pm_getPaymasterData.
  const feeReserve = getChainsConfig()[source.chain]?.transferMaxFee ?? 0;
  const maxBase = balanceBase !== null ? BigInt(balanceBase) - BigInt(feeReserve) : null;

  const handleMax = useCallback(() => {
    if (maxBase === null || maxBase <= 0n) return;
    setAmount(fromBaseUnits(maxBase.toString(), source.decimals));
  }, [maxBase, source.decimals]);

  /**
   * One route shape drives both quoteSwidge() and prepareSwap() — the
   * documented SwidgeOptions form (fromToken/toToken/fromTokenAmount).
   * https://docs.wdk.tether.io/sdk/swidge-modules/swidge-orchestra/guides/quote-and-execute/
   *
   * Both addresses are the wallet's own: the destination chain cannot be
   * inferred cross-chain, so `recipient` keeps the swapped funds in-app, and
   * the API requires an explicit `refundAddress` to pair with the refundChain
   * the module defaults to — a failed or expired order sends the source funds
   * back to the wallet's own source-chain address.
   */
  const buildRouteOptions = useCallback(
    async (amountBase: string) => {
      const [recipient, refundAddress] = await Promise.all([
        getAddress(destination.chain, 0),
        getAddress(source.chain, 0),
      ]);
      return {
        fromToken: `${source.chain}:${source.asset}`,
        toToken: `${destination.chain}:${destination.asset}`,
        toChain: destination.chain,
        fromTokenAmount: amountBase,
        recipient,
        refundAddress,
        slippage: 0.01,
      };
    },
    [source, destination, getAddress]
  );

  // Quote whenever the amount, source, or destination settles.
  useEffect(() => {
    if (!isInitialized || !baseAmount) {
      setQuote(null);
      setError(null);
      return;
    }

    const seq = ++quoteSeq.current;
    let cancelled = false;
    setIsQuoting(true);

    const timer = setTimeout(async () => {
      try {
        const next = await orchestra.quoteSwidge(await buildRouteOptions(baseAmount));
        if (cancelled || seq !== quoteSeq.current) return;
        setQuote(next ?? null);
        setError(next ? null : 'No route available for this amount.');
      } catch (err) {
        if (cancelled || seq !== quoteSeq.current) return;
        setQuote(null);
        setError(getErrorMessage(err, 'Could not fetch a quote'));
      } finally {
        if (!cancelled && seq === quoteSeq.current) setIsQuoting(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseAmount, source, destination, isInitialized]);

  const handleSwap = useCallback(async () => {
    if (!baseAmount || !quote) return;

    Keyboard.dismiss();
    setIsSwapping(true);
    setError(null);

    // Two steps rather than the one-call swidge(), for two reasons:
    //  1. prepareSwap() is the persistence boundary — the intent exists before
    //     any funds move, which is what makes recovery possible.
    //  2. swidge() drops the per-order readToken, which scoped client keys
    //     need in order to read status back.
    let intent: SwapIntent | undefined;
    try {
      intent = await orchestra.prepareSwap(await buildRouteOptions(baseAmount));
      if (!intent) throw new Error('Could not prepare the swap');
    } catch (err) {
      // Nothing has moved yet — this is always safe to retry.
      setError(getErrorMessage(err, 'Could not prepare the swap'));
      toast.error('Could not prepare the swap');
      setIsSwapping(false);
      return;
    }

    // A production wallet should persist `intent` here, before funds move.
    setState(intent);

    try {
      // Funds move here: the source payment is signed and sent from the WDK
      // account inside the worklet, then submitted to Orchestra.
      const submitted = await orchestra.executeSwapIntent(intent);
      if (!submitted) throw new Error('Swap did not return a state');

      // The order card slides in below; the amount and quote stay on screen
      // as the terms of the swap that was just sent.
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setState(submitted);
      setOrderStatus(submitted.status ?? 'pending');
      setFormSpent(true);
      refetchBalance();
      toast.success('Swap submitted');
    } catch (err) {
      // Past this point the source payment may already have been broadcast, so
      // this is NOT safely retryable — resuming the existing order is correct.
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setError(
        `${getErrorMessage(err, 'Swap failed')} — the source payment may already have been sent. ` +
          'Check the order status before retrying.'
      );
      toast.error('Swap failed after preparing');
    } finally {
      setIsSwapping(false);
    }
  }, [baseAmount, quote, buildRouteOptions, orchestra, refetchBalance]);

  // Poll until the order reaches a terminal state. The whole state object is
  // passed back so the readToken travels with it.
  useEffect(() => {
    if (!state?.orderId || !orderStatus || TERMINAL_STATUSES.includes(orderStatus)) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const status = await orchestra.getOrderStatus(state);
        if (cancelled || !status) return;
        const next = status.order?.status ?? status.status ?? 'pending';
        setOrderStatus(next);
        // Settled orders change one balance on each side; refresh both.
        if (TERMINAL_STATUSES.includes(next)) refetchBalance();
      } catch {
        // Transient polling failures are expected; keep the last known status.
      }
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.orderId, orderStatus]);

  const canSwap = Boolean(quote) && !isQuoting && !isSwapping && isInitialized;

  // While the submitted form is untouched, the button narrates the order:
  // "Swapping…" until it settles, then "New swap" to reset. Editing the
  // amount or route un-spends the form and returns to the normal quote flow.
  const orderSettled = Boolean(
    state?.orderId && orderStatus && TERMINAL_STATUSES.includes(orderStatus)
  );
  const showNewSwap = formSpent && orderSettled && !isSwapping;

  const handleNewSwap = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setAmount('');
    setQuote(null);
    setState(null);
    setOrderStatus(null);
    setError(null);
    setFormSpent(false);
  }, []);

  const handleAmountChange = useCallback((text: string) => {
    setAmount(text);
    setFormSpent(false);
  }, []);

  const buttonLabel = isSwapping
    ? 'Swapping…'
    : formSpent
      ? orderSettled
        ? 'New swap'
        : 'Swapping…'
      : isQuoting
        ? 'Fetching quote…'
        : baseAmount
          ? 'Swap'
          : 'Enter an amount';
  const buttonEnabled = showNewSwap || (canSwap && !formSpent);

  const receiveAmount = quote ? fromBaseUnits(quote.toTokenAmount, destination.decimals) : '';
  const rate =
    quote && baseAmount
      ? `1 ${source.asset} ≈ ${trimRate(
          Number(fromBaseUnits(quote.toTokenAmount, destination.decimals)) /
            Number(fromBaseUnits(quote.fromTokenAmount, source.decimals))
        )} ${destination.asset}`
      : null;

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Header title="Swap" />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* You pay */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardLabel}>You pay</Text>
              <View style={styles.gaslessTag}>
                <Zap size={11} color={colors.primary} />
                <Text style={styles.gaslessTagText}>Gasless</Text>
              </View>
            </View>
            <View style={styles.cardRow}>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={handleAmountChange}
                placeholder="0"
                placeholderTextColor={colors.textTertiary}
                keyboardType="decimal-pad"
                editable={!isSwapping}
              />
              <TouchableOpacity
                style={[styles.assetSelector, styles.assetSelectorTappable]}
                onPress={() => setPicker('source')}
                disabled={isSwapping}
                activeOpacity={0.7}
              >
                <TokenIcon asset={source.asset} chain={source.chain} size={32} />
                <View style={styles.assetSelectorLabels}>
                  <Text style={styles.assetSymbol}>{source.asset}</Text>
                  <Text style={styles.assetChain}>
                    on {networkConfigs[source.chain as NetworkType]?.name}
                  </Text>
                </View>
                <ChevronDown size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {balanceBase !== null && (
              <View style={styles.balanceRow}>
                <Text style={styles.balanceText}>
                  Balance: {fromBaseUnits(balanceBase, source.decimals)} {source.asset}
                </Text>
                <TouchableOpacity
                  style={styles.maxButton}
                  onPress={handleMax}
                  disabled={isSwapping || maxBase === null || maxBase <= 0n}
                  activeOpacity={0.7}
                >
                  <Text style={styles.maxButtonText}>Max</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Direction divider */}
          <View style={styles.dividerWrap}>
            <View style={styles.dividerLine} />
            <View style={styles.dividerButton}>
              <ArrowDown size={18} color={colors.primary} />
            </View>
            <View style={styles.dividerLine} />
          </View>

          {/* You receive */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardLabel}>You receive</Text>
            </View>
            <View style={styles.cardRow}>
              {isQuoting && !quote ? (
                <ActivityIndicator color={colors.textTertiary} style={styles.receiveSpinner} />
              ) : (
                <Text
                  style={[styles.receiveAmount, !receiveAmount && styles.receiveAmountEmpty]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {receiveAmount || '0'}
                </Text>
              )}
              <TouchableOpacity
                style={[styles.assetSelector, styles.assetSelectorTappable]}
                onPress={() => setPicker('destination')}
                disabled={isSwapping}
                activeOpacity={0.7}
              >
                <TokenIcon asset={destination.asset} chain={destination.chain} size={32} />
                <View style={styles.assetSelectorLabels}>
                  <Text style={styles.assetSymbol}>{destination.asset}</Text>
                  <Text style={styles.assetChain}>
                    on {networkConfigs[destination.chain as NetworkType]?.name}
                  </Text>
                </View>
                <ChevronDown size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {destinationBalanceBase !== null && (
              <View style={styles.balanceRow}>
                <Text style={styles.balanceText}>
                  Balance: {fromBaseUnits(destinationBalanceBase, destination.decimals)}{' '}
                  {destination.asset}
                </Text>
              </View>
            )}
          </View>

          {/* Quote details */}
          {quote && (
            <View style={styles.quoteCard}>
              {rate ? <QuoteRow label="Rate" value={rate} /> : null}
              {quote.estimatedDuration ? (
                <QuoteRow label="Estimated time" value={`~${quote.estimatedDuration}s`} />
              ) : null}
              <QuoteRow
                label="Minimum received"
                value={`${fromBaseUnits(quote.toTokenAmountMin, destination.decimals)} ${destination.asset}`}
              />
              {/* Fees are itemised and each carries its own token — Orchestra
                  can quote a protocol fee in USDC on a USDT route — so they
                  are listed separately rather than summed. */}
              {(quote.fees ?? []).map((fee, index) => (
                <QuoteRow
                  key={`${fee.type}-${fee.token}-${index}`}
                  label={`${capitalize(fee.type)} fee`}
                  value={`${fromBaseUnits(fee.amount, FEE_DECIMALS[fee.token] ?? 6)} ${fee.token}`}
                />
              ))}
              <QuoteRow label="Network fee" value="Paid in USDT via paymaster" />
            </View>
          )}

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {state && (
            <View style={styles.resultCard}>
              <QuoteRow label="Order" value={shorten(state.orderId ?? '—')} />
              <QuoteRow label="Status" value={orderStatus ?? 'pending'} emphasis />
              {state.sourceTxHash ? (
                <QuoteRow label="Source tx" value={shorten(state.sourceTxHash)} />
              ) : null}
            </View>
          )}

          <TouchableOpacity
            style={[styles.swapButton, !buttonEnabled && styles.swapButtonDisabled]}
            onPress={showNewSwap ? handleNewSwap : handleSwap}
            disabled={!buttonEnabled}
          >
            <Text style={[styles.swapButtonText, !buttonEnabled && styles.swapButtonTextDisabled]}>
              {buttonLabel}
            </Text>
          </TouchableOpacity>

          {!isInitialized && <Text style={styles.hint}>Unlock your wallet to fetch a quote.</Text>}
        </ScrollView>

        {/* Asset picker — serves both sides of the swap */}
        {/* animationType="slide" would slide the dimmed backdrop up with the
            sheet, which reads as a dark curtain; fading dims it in place. */}
        <Modal
          visible={picker !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setPicker(null)}
        >
          <Pressable style={styles.sheetBackdrop} onPress={() => setPicker(null)}>
            <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>
                {picker === 'source' ? 'Pay with' : 'Receive asset'}
              </Text>
              {(picker === 'source' ? SOURCES : destinations).map((option) => {
                const current = picker === 'source' ? source : destination;
                const selected = option.chain === current.chain && option.asset === current.asset;
                return (
                  <TouchableOpacity
                    key={`${option.chain}:${option.asset}`}
                    style={[styles.sheetItem, selected && styles.sheetItemSelected]}
                    onPress={() => {
                      if (picker === 'source') {
                        const nextSource = option as Source;
                        setSource(nextSource);
                        // Keep the destination valid: a route back to the same
                        // chain+asset is not a swap.
                        if (
                          destination.chain === nextSource.chain &&
                          destination.asset === nextSource.asset
                        ) {
                          const fallback = DESTINATIONS.find(
                            (d) => !(d.chain === nextSource.chain && d.asset === nextSource.asset)
                          );
                          if (fallback) setDestination(fallback);
                        }
                      } else {
                        setDestination(option as Destination);
                      }
                      // A route change means a new swap is being composed.
                      setFormSpent(false);
                      setPicker(null);
                    }}
                    activeOpacity={0.7}
                  >
                    <TokenIcon asset={option.asset} chain={option.chain} size={40} />
                    <View style={styles.sheetItemLabels}>
                      <Text style={styles.sheetItemSymbol}>{option.asset}</Text>
                      <Text style={styles.sheetItemName}>
                        {option.label} on {networkConfigs[option.chain as NetworkType]?.name}
                      </Text>
                    </View>
                    {selected ? <Check size={18} color={colors.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </TouchableWithoutFeedback>
  );
}

const TERMINAL_STATUSES = ['completed', 'failed', 'refunded', 'expired', 'cancelled'];

function shorten(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

/** Rates span sats-per-dollar to dollars-per-dollar; keep enough precision for both. */
function trimRate(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return value >= 1 ? value.toFixed(4).replace(/\.?0+$/, '') : value.toPrecision(4);
}

function QuoteRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.quoteRow}>
      <Text style={styles.quoteLabel}>{label}</Text>
      <Text style={[styles.quoteValue, emphasis && styles.quoteValueEmphasis]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.borderDark,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  gaslessTag: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 101, 1, 0.12)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  gaslessTagText: { color: colors.primary, fontSize: 11, fontWeight: '600' },
  cardRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  balanceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
    marginTop: 10,
  },
  balanceText: { color: colors.textTertiary, fontSize: 12 },
  maxButton: {
    backgroundColor: 'rgba(255, 101, 1, 0.12)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  maxButtonText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  amountInput: {
    color: colors.text,
    flex: 1,
    fontSize: 34,
    fontWeight: '600',
    padding: 0,
  },
  receiveAmount: { color: colors.text, flex: 1, fontSize: 34, fontWeight: '600' },
  receiveAmountEmpty: { color: colors.textTertiary },
  receiveSpinner: { flex: 1, alignItems: 'flex-start' },
  assetSelector: {
    alignItems: 'center',
    backgroundColor: colors.cardDark,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  assetSelectorTappable: { paddingRight: 12 },
  assetSelectorLabels: { alignItems: 'flex-start' },
  assetSymbol: { color: colors.text, fontSize: 15, fontWeight: '700' },
  assetChain: { color: colors.textSecondary, fontSize: 11 },
  chainBadge: {
    // Chain marks ship on transparent backgrounds; the white disk keeps them
    // legible at badge size regardless of what they overlap.
    backgroundColor: colors.white,
    borderColor: colors.card,
    borderWidth: 1.5,
    bottom: -2,
    position: 'absolute',
    right: -2,
  },
  dividerWrap: { alignItems: 'center', flexDirection: 'row', marginVertical: 6 },
  dividerLine: { backgroundColor: colors.borderDark, flex: 1, height: 1 },
  dividerButton: {
    alignItems: 'center',
    backgroundColor: colors.cardDark,
    borderColor: colors.background,
    borderRadius: 999,
    borderWidth: 3,
    height: 40,
    justifyContent: 'center',
    marginHorizontal: 10,
    width: 40,
  },
  quoteCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  resultCard: {
    backgroundColor: colors.card,
    borderColor: colors.primary,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  quoteRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  quoteLabel: { color: colors.textSecondary, fontSize: 13 },
  quoteValue: { color: colors.text, flexShrink: 1, fontSize: 14, marginLeft: 16 },
  quoteValueEmphasis: { fontSize: 16, fontWeight: '700' },
  errorBox: {
    backgroundColor: colors.dangerBackground,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 16,
    padding: 12,
  },
  errorText: { color: colors.error, fontSize: 13 },
  swapButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 16,
    justifyContent: 'center',
    marginTop: 24,
    paddingVertical: 17,
  },
  swapButtonDisabled: { backgroundColor: colors.card },
  swapButtonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  swapButtonTextDisabled: { color: colors.textTertiary },
  hint: { color: colors.textTertiary, fontSize: 12, marginTop: 12, lineHeight: 17 },
  sheetBackdrop: {
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: colors.border,
    borderRadius: 999,
    height: 4,
    marginBottom: 14,
    width: 36,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 10,
    marginLeft: 4,
  },
  sheetItem: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  sheetItemSelected: { backgroundColor: colors.cardDark },
  sheetItemLabels: { flex: 1 },
  sheetItemSymbol: { color: colors.text, fontSize: 15, fontWeight: '700' },
  sheetItemName: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
});
