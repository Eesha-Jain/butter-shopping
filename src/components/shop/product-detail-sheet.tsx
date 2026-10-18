import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useSession } from '@/auth/session';
import {
  computeNetPrice,
  fetchVisaMerchantOffers,
  formatLocalDateTime,
  getEffectiveGroceryCashbackBps,
  listProductStoreOffers,
  publicImageUrl,
  refreshProductStoreOffers,
  reportManualPrice,
  resolveShopZip,
  runAction,
  setGroceryCashbackBps,
  showSuccessToast,
  type Product,
  type ProductStoreOffer,
  type VisaMerchantOffer,
} from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  product: Product | null;
  saleBadge?: string | null;
  quantityOnList?: number;
  favorited?: boolean;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onToggleFavorite?: () => void;
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/** Parses "$x.xx" / "x.xx" into positive cents under $500. */
function parseDollarsToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!cleaned || !/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const dollars = Number(cleaned);
  if (!Number.isFinite(dollars) || dollars <= 0 || dollars >= 500) return null;
  return Math.round(dollars * 100);
}

function isReportableOffer(offer: ProductStoreOffer): boolean {
  return Boolean(offer.storeId) && offer.storeId !== 'open-prices';
}

const CASHBACK_CHIPS = [
  { bps: 100, label: '1%' },
  { bps: 200, label: '2%' },
  { bps: 300, label: '3%+' },
] as const;

export const ProductDetailSheet = forwardRef<BottomSheetModal, Props>(function ProductDetailSheet(
  { product, saleBadge, quantityOnList, favorited, onAdd, onIncrement, onDecrement, onToggleFavorite },
  ref,
) {
  const theme = useTheme();
  const { isGuest, requestSignIn } = useSession();
  const snapPoints = useMemo(() => ['55%', '78%'], []);
  const imageUrl = product ? publicImageUrl('public-assets', product.image_path) : null;
  const onList = quantityOnList != null && quantityOnList > 0;
  const [offers, setOffers] = useState<ProductStoreOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [visaOffers, setVisaOffers] = useState<VisaMerchantOffer[]>([]);
  const [cashbackBps, setCashbackBps] = useState<number | null>(null);
  const [showCashbackPrompt, setShowCashbackPrompt] = useState(false);
  const [checkingStores, setCheckingStores] = useState(false);
  const [reportingStoreId, setReportingStoreId] = useState<string | null>(null);
  const [reportPriceText, setReportPriceText] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    if (!product?.id) {
      setOffers([]);
      setCheckingStores(false);
      setReportingStoreId(null);
      setReportPriceText('');
      setReportError(null);
      return;
    }
    let cancelled = false;
    setOffersLoading(true);
    setCheckingStores(false);
    setReportingStoreId(null);
    setReportPriceText('');
    setReportError(null);

    void Promise.all([
      listProductStoreOffers(product.id),
      fetchVisaMerchantOffers(),
      getEffectiveGroceryCashbackBps(isGuest),
    ])
      .then(([rows, visa, bps]) => {
        if (cancelled) return;
        setOffers(rows);
        setVisaOffers(visa.offers);
        setCashbackBps(bps);
        setShowCashbackPrompt(bps == null && rows.length > 1);
      })
      .catch(() => {
        if (!cancelled) {
          setOffers([]);
          setVisaOffers([]);
        }
      })
      .finally(() => {
        if (!cancelled) setOffersLoading(false);
      });

    void (async () => {
      setCheckingStores(true);
      try {
        const zip = await resolveShopZip();
        if (cancelled) return;
        const rows = await refreshProductStoreOffers(product, zip);
        if (!cancelled) setOffers(rows);
      } catch {
        // Keep cached offers already shown.
      } finally {
        if (!cancelled) setCheckingStores(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [product, isGuest]);

  const ranked = useMemo(() => {
    return [...offers]
      .map((offer) => {
        const chainLabel = offer.chainName ?? offer.storeName;
        const net = computeNetPrice(offer.priceCents, cashbackBps, chainLabel, visaOffers);
        return { offer, net };
      })
      .sort((a, b) => a.net.netCents - b.net.netCents);
  }, [offers, cashbackBps, visaOffers]);

  const bestId = ranked[0]?.offer.storeProductId;

  const pickCashback = async (bps: number | null) => {
    setCashbackBps(bps);
    setShowCashbackPrompt(false);
    try {
      await setGroceryCashbackBps(bps, isGuest);
    } catch {
      // Local state still updates the comparison.
    }
  };

  const startReport = (offer: ProductStoreOffer) => {
    if (isGuest) {
      requestSignIn();
      return;
    }
    setReportingStoreId(offer.storeId);
    setReportPriceText((offer.priceCents / 100).toFixed(2));
    setReportError(null);
  };

  const cancelReport = () => {
    setReportingStoreId(null);
    setReportPriceText('');
    setReportError(null);
  };

  const submitReport = async (offer: ProductStoreOffer) => {
    if (!product || reportSubmitting) return;
    if (isGuest) {
      requestSignIn();
      return;
    }
    const priceCents = parseDollarsToCents(reportPriceText);
    if (priceCents == null) {
      setReportError('Enter a price between $0.01 and $499.99');
      return;
    }
    setReportSubmitting(true);
    setReportError(null);
    try {
      await runAction(
        () =>
          reportManualPrice({
            storeId: offer.storeId,
            productName: product.name,
            priceCents,
            brand: product.brand ?? undefined,
            upc: product.upc ?? undefined,
          }),
        'Could not save that price.',
      );
      showSuccessToast('Price updated', offer.chainName ?? offer.storeName);
      cancelReport();
      const rows = await listProductStoreOffers(product.id);
      setOffers(rows);
    } catch {
      // runAction already toasts
    } finally {
      setReportSubmitting(false);
    }
  };

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={snapPoints}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme.background }}
      handleIndicatorStyle={{ backgroundColor: theme.border }}>
      <BottomSheetScrollView contentContainerStyle={styles.content}>
        {product ? (
          <>
            <View style={styles.row}>
              <View style={[styles.imageWrap, { backgroundColor: theme.backgroundElement }]}>
                {saleBadge ? (
                  <View style={[styles.badge, { backgroundColor: theme.primary }]}>
                    <ThemedText type="small" style={{ color: theme.primaryText }}>
                      {saleBadge}
                    </ThemedText>
                  </View>
                ) : null}
                {imageUrl ? (
                  <Image source={{ uri: imageUrl }} style={styles.image} contentFit="cover" />
                ) : null}
              </View>
              <View style={styles.meta}>
                <View style={styles.titleRow}>
                  <ThemedText type="subtitle" style={styles.titleFlex}>
                    {product.name}
                  </ThemedText>
                  {onToggleFavorite ? (
                    <Pressable onPress={onToggleFavorite} hitSlop={8} style={styles.heartBtn}>
                      <ThemedText
                        type="subtitle"
                        style={{ color: favorited ? theme.error : theme.textSecondary }}>
                        {favorited ? '♥' : '♡'}
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </View>
                {product.brand ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {product.brand}
                  </ThemedText>
                ) : null}
              </View>
            </View>

            <View style={styles.compareBlock}>
              <ThemedText type="smallBold">Prices nearby</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                After cash back
                {cashbackBps != null ? ` (${cashbackBps / 100}%)` : ''}
                {visaOffers.length > 0 ? ' + Visa offers' : ''}
              </ThemedText>
              {showCashbackPrompt ? (
                <View style={[styles.prompt, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold">Factor in grocery cash back?</ThemedText>
                  <View style={styles.chipRow}>
                    {CASHBACK_CHIPS.map((chip) => (
                      <Pressable
                        key={chip.bps}
                        onPress={() => void pickCashback(chip.bps)}
                        style={[styles.chip, { borderColor: theme.border }]}>
                        <ThemedText type="smallBold">{chip.label}</ThemedText>
                      </Pressable>
                    ))}
                    <Pressable
                      onPress={() => setShowCashbackPrompt(false)}
                      style={[styles.chip, { borderColor: theme.border }]}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Not now
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>
              ) : null}
              {checkingStores ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Checking nearby stores…
                </ThemedText>
              ) : null}
              {offersLoading && offers.length === 0 ? (
                <ActivityIndicator color={theme.primary} />
              ) : ranked.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  No store prices yet for this product.
                </ThemedText>
              ) : (
                ranked.map(({ offer, net }) => {
                  const best = offer.storeProductId === bestId;
                  const showNet = net.netCents < net.shelfCents;
                  const reporting = reportingStoreId === offer.storeId;
                  const canReport = isReportableOffer(offer);
                  return (
                    <View
                      key={offer.storeProductId}
                      style={[
                        styles.offerRow,
                        {
                          backgroundColor: best
                            ? theme.backgroundSelected
                            : theme.backgroundElement,
                        },
                      ]}>
                      <View style={styles.offerMeta}>
                        <ThemedText type="smallBold" numberOfLines={1}>
                          {offer.chainName ?? offer.storeName}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                          {offer.storeName}
                          {!offer.isAvailable ? ' · may be unavailable' : ''}
                          {best ? ' · best after rewards' : ''}
                          {net.visaOffer ? ` · ${net.visaOffer.title}` : ''}
                        </ThemedText>
                        {reporting ? (
                          <View style={styles.reportForm}>
                            <ThemedText type="small" themeColor="textSecondary">
                              Correct shelf price
                            </ThemedText>
                            <View style={styles.reportInputRow}>
                              <ThemedText type="smallBold">$</ThemedText>
                              <BottomSheetTextInput
                                value={reportPriceText}
                                onChangeText={(text) => {
                                  setReportPriceText(text);
                                  setReportError(null);
                                }}
                                keyboardType="decimal-pad"
                                placeholder="0.00"
                                placeholderTextColor={theme.textSecondary}
                                style={[
                                  styles.reportInput,
                                  {
                                    color: theme.text,
                                    borderColor: theme.border,
                                    backgroundColor: theme.background,
                                  },
                                ]}
                                editable={!reportSubmitting}
                              />
                            </View>
                            {reportError ? (
                              <ThemedText type="small" themeColor="error">
                                {reportError}
                              </ThemedText>
                            ) : null}
                            <View style={styles.reportActions}>
                              <Pressable
                                onPress={cancelReport}
                                disabled={reportSubmitting}
                                style={[styles.reportBtn, { borderColor: theme.border }]}>
                                <ThemedText type="small" themeColor="textSecondary">
                                  Cancel
                                </ThemedText>
                              </Pressable>
                              <Pressable
                                onPress={() => void submitReport(offer)}
                                disabled={reportSubmitting}
                                style={[
                                  styles.reportBtn,
                                  styles.reportSubmit,
                                  { backgroundColor: theme.primary },
                                ]}>
                                {reportSubmitting ? (
                                  <ActivityIndicator color={theme.primaryText} size="small" />
                                ) : (
                                  <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
                                    Submit
                                  </ThemedText>
                                )}
                              </Pressable>
                            </View>
                          </View>
                        ) : canReport ? (
                          <Pressable onPress={() => startReport(offer)} hitSlop={6}>
                            <ThemedText type="small" themeColor="textSecondary">
                              Report wrong price
                            </ThemedText>
                          </Pressable>
                        ) : null}
                      </View>
                      {!reporting ? (
                        <View style={styles.priceCol}>
                          {showNet ? (
                            <ThemedText
                              type="small"
                              themeColor="textSecondary"
                              style={styles.shelfStrike}>
                              {formatCents(net.shelfCents)}
                            </ThemedText>
                          ) : null}
                          <ThemedText type="smallBold">
                            {formatCents(showNet ? net.netCents : net.shelfCents)}
                          </ThemedText>
                          {offer.observedAt ? (
                            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                              Updated {formatLocalDateTime(offer.observedAt)}
                            </ThemedText>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })
              )}
            </View>

            {onList ? (
              <View style={[styles.stepper, { backgroundColor: theme.primary }]}>
                <Pressable onPress={onDecrement} style={styles.stepBtn}>
                  <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
                    −
                  </ThemedText>
                </Pressable>
                <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
                  {quantityOnList} on list
                </ThemedText>
                <Pressable onPress={onIncrement} style={styles.stepBtn}>
                  <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
                    +
                  </ThemedText>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={onAdd}
                style={[styles.addBtn, { backgroundColor: theme.primary }]}>
                <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
                  Add to list
                </ThemedText>
              </Pressable>
            )}
          </>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  imageWrap: {
    width: 96,
    height: 96,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    top: Spacing.one,
    left: Spacing.one,
    zIndex: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.one,
  },
  meta: {
    flex: 1,
    gap: Spacing.one,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  titleFlex: {
    flex: 1,
  },
  heartBtn: {
    paddingTop: 2,
  },
  compareBlock: {
    gap: Spacing.two,
  },
  prompt: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  offerMeta: {
    flex: 1,
    gap: 2,
  },
  priceCol: {
    alignItems: 'flex-end',
    gap: 2,
  },
  shelfStrike: {
    textDecorationLine: 'line-through',
  },
  reportForm: {
    marginTop: Spacing.two,
    gap: Spacing.two,
  },
  reportInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  reportInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 16,
    minHeight: 40,
  },
  reportActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  reportBtn: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportSubmit: {
    borderWidth: 0,
  },
  addBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    minHeight: 48,
  },
  stepBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
