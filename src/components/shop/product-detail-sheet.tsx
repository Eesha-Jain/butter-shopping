import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useSession } from '@/auth/session';
import {
  computeNetPrice,
  fetchVisaMerchantOffers,
  formatLocalDateTime,
  formatPromotionBadge,
  getEffectiveGroceryCashbackBps,
  getProductTraitsForIds,
  listFoodTraits,
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
  type SessionFoodRule,
  type VisaMerchantOffer,
} from '@/backend';
import type { FoodTrait, Promotion } from '@/backend/types';
import { ThemedText } from '@/components/themed-text';
import { ButterButton } from '@/components/ui/butter-button';
import { ButterChip } from '@/components/ui/butter-chip';
import { Fonts, Radius, SheetChrome, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  product: Product | null;
  saleBadge?: string | null;
  promotion?: Promotion | null;
  preferenceRules?: SessionFoodRule[];
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

function formatPromoEnds(promo: Promotion): string | null {
  try {
    const ends = new Date(promo.ends_at);
    if (Number.isNaN(ends.getTime())) return null;
    return `ends ${ends.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
  } catch {
    return null;
  }
}

function formatGroupLabel(code: string): string {
  return `${code.charAt(0).toUpperCase()}${code.slice(1)} deal`;
}

const CASHBACK_CHIPS = [
  { bps: 100, label: '1%' },
  { bps: 200, label: '2%' },
  { bps: 300, label: '3%+' },
] as const;

export const ProductDetailSheet = forwardRef<BottomSheetModal, Props>(function ProductDetailSheet(
  {
    product,
    saleBadge,
    promotion,
    preferenceRules = [],
    quantityOnList,
    favorited,
    onAdd,
    onIncrement,
    onDecrement,
    onToggleFavorite,
  },
  ref,
) {
  const theme = useTheme();
  const { isGuest, requestSignIn } = useSession();
  const snapPoints = useMemo(() => ['55%', '82%'], []);
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
  const [matchLabels, setMatchLabels] = useState<string[]>([]);
  const [otherStoresOpen, setOtherStoresOpen] = useState(false);

  useEffect(() => {
    if (!product?.id) {
      setOffers([]);
      setCheckingStores(false);
      setReportingStoreId(null);
      setReportPriceText('');
      setReportError(null);
      setMatchLabels([]);
      setOtherStoresOpen(false);
      return;
    }
    let cancelled = false;
    setOffersLoading(true);
    setCheckingStores(false);
    setReportingStoreId(null);
    setReportPriceText('');
    setReportError(null);
    setOtherStoresOpen(false);

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

    void (async () => {
      try {
        const preferRequire = preferenceRules.filter(
          (rule) => rule.mode === 'prefer' || rule.mode === 'require',
        );
        if (preferRequire.length === 0) {
          if (!cancelled) setMatchLabels([]);
          return;
        }
        const [productTraits, catalog] = await Promise.all([
          getProductTraitsForIds([product.id]),
          listFoodTraits(),
        ]);
        if (cancelled) return;
        const byId = new Map<string, FoodTrait>(catalog.map((t) => [t.id, t]));
        const labels: string[] = [];
        for (const rule of preferRequire) {
          const hit = productTraits.some(
            (trait) =>
              trait.trait_id === rule.trait_id &&
              (trait.relation === 'suitable' || trait.relation === 'certified'),
          );
          if (!hit) continue;
          const name = byId.get(rule.trait_id)?.name;
          if (name && !labels.includes(name)) labels.push(name);
        }
        setMatchLabels(labels.slice(0, 4));
      } catch {
        if (!cancelled) setMatchLabels([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [product, isGuest, preferenceRules]);

  const ranked = useMemo(() => {
    return [...offers]
      .map((offer) => {
        const chainLabel = offer.chainName ?? offer.storeName;
        const net = computeNetPrice(offer.priceCents, cashbackBps, chainLabel, visaOffers);
        return { offer, net };
      })
      .sort((a, b) => a.net.netCents - b.net.netCents);
  }, [offers, cashbackBps, visaOffers]);

  const best = ranked[0] ?? null;
  const runnerUp = ranked[1] ?? null;
  const otherOffers = ranked.slice(1);

  const savingsVsNext =
    best && runnerUp ? Math.max(0, runnerUp.net.netCents - best.net.netCents) : 0;

  const promoChipLabel = useMemo(() => {
    if (!promotion && !saleBadge) return null;
    const badge = saleBadge ?? (promotion ? formatPromotionBadge(promotion) : null);
    if (!badge) return null;
    const bits = [badge];
    if (promotion) {
      const ends = formatPromoEnds(promotion);
      if (ends) bits.push(ends);
      if (promotion.requires_group) bits.push(formatGroupLabel(promotion.requires_group));
    }
    return bits.join(' · ');
  }, [promotion, saleBadge]);

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
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.45}
      />
    ),
    [],
  );

  const renderOfferRow = (
    offer: ProductStoreOffer,
    net: ReturnType<typeof computeNetPrice>,
    opts: { highlight?: boolean },
  ) => {
    const reporting = reportingStoreId === offer.storeId;
    const canReport = isReportableOffer(offer);
    const showNet = net.netCents < net.shelfCents;
    return (
      <View
        key={offer.storeProductId}
        style={[
          styles.offerRow,
          {
            backgroundColor: opts.highlight ? theme.backgroundSelected : theme.backgroundElement,
            borderColor: opts.highlight ? theme.borderInk : theme.border,
            borderWidth: opts.highlight ? 2 : 1,
          },
        ]}>
        <View style={styles.offerMeta}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {offer.chainName ?? offer.storeName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {offer.storeName}
            {!offer.isAvailable ? ' · may be unavailable' : ''}
            {opts.highlight ? ' · best after rewards' : ''}
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
                      borderColor: theme.borderInk,
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
                  style={[styles.reportBtn, { borderColor: theme.borderInk }]}>
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
                    { backgroundColor: theme.secondary },
                  ]}>
                  {reportSubmitting ? (
                    <ActivityIndicator color={theme.primary} size="small" />
                  ) : (
                    <ThemedText type="smallBold" style={{ color: theme.primary }}>
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
              <ThemedText type="small" themeColor="textSecondary" style={styles.shelfStrike}>
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
  };

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={snapPoints}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      backgroundStyle={{
        backgroundColor: theme.background,
        borderTopLeftRadius: SheetChrome.topRadius,
        borderTopRightRadius: SheetChrome.topRadius,
      }}
      handleIndicatorStyle={{
        backgroundColor: theme.primary,
        width: SheetChrome.handleWidth,
        height: SheetChrome.handleHeight,
      }}>
      <BottomSheetScrollView contentContainerStyle={styles.content}>
        {product ? (
          <>
            <View style={styles.row}>
              <View
                style={[
                  styles.imageWrap,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.borderInk,
                  },
                ]}>
                {saleBadge ? (
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: theme.primary, borderColor: theme.borderInk },
                    ]}>
                    <ThemedText type="smallBold" style={{ color: theme.primaryText, fontSize: 11 }}>
                      {saleBadge}
                    </ThemedText>
                  </View>
                ) : null}
                {imageUrl ? (
                  <Image source={{ uri: imageUrl }} style={styles.image} contentFit="contain" />
                ) : (
                  <View style={styles.imagePlaceholder}>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      {product.name.slice(0, 1).toUpperCase()}
                    </ThemedText>
                  </View>
                )}
              </View>
              <View style={styles.meta}>
                <View style={styles.titleRow}>
                  <ThemedText type="smallBold" style={styles.titleFlex}>
                    {product.name}
                  </ThemedText>
                  {onToggleFavorite ? (
                    <Pressable
                      onPress={onToggleFavorite}
                      hitSlop={8}
                      style={[
                        styles.heartBtn,
                        { borderColor: theme.borderInk, backgroundColor: theme.background },
                      ]}>
                      <SymbolView
                        name={favorited ? 'heart.fill' : 'heart'}
                        size={18}
                        tintColor={favorited ? theme.error : theme.textSecondary}
                      />
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

            {best ? (
              <View
                style={[
                  styles.heroPrice,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.borderInk,
                  },
                ]}>
                <ThemedText style={styles.heroPriceValue}>
                  {formatCents(
                    best.net.netCents < best.net.shelfCents
                      ? best.net.netCents
                      : best.net.shelfCents,
                  )}
                </ThemedText>
                <ThemedText type="smallBold">
                  at {best.offer.chainName ?? best.offer.storeName}
                  {best.net.netCents < best.net.shelfCents ? ' · best after rewards' : ''}
                </ThemedText>
                {(savingsVsNext > 0 ||
                  best.net.cashbackCents > 0 ||
                  best.net.visaOfferCents > 0) && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {[
                      savingsVsNext > 0
                        ? `Save ${formatCents(savingsVsNext)} vs ${runnerUp?.offer.chainName ?? runnerUp?.offer.storeName ?? 'next'}`
                        : null,
                      best.net.cashbackCents > 0
                        ? `−${formatCents(best.net.cashbackCents)} cash back`
                        : null,
                      best.net.visaOfferCents > 0
                        ? `−${formatCents(best.net.visaOfferCents)} Visa`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </ThemedText>
                )}
              </View>
            ) : offersLoading ? (
              <ActivityIndicator color={theme.primary} />
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                No store prices yet for this product.
              </ThemedText>
            )}

            {(promoChipLabel || matchLabels.length > 0) && (
              <View style={styles.chipRow}>
                {promoChipLabel ? (
                  <View
                    style={[
                      styles.infoChip,
                      { backgroundColor: theme.backgroundSelected, borderColor: theme.borderInk },
                    ]}>
                    <ThemedText type="smallBold">{promoChipLabel}</ThemedText>
                  </View>
                ) : null}
                {matchLabels.map((label) => (
                  <View
                    key={label}
                    style={[
                      styles.infoChip,
                      { backgroundColor: theme.backgroundElement, borderColor: theme.borderInk },
                    ]}>
                    <ThemedText type="smallBold">Matches: {label}</ThemedText>
                  </View>
                ))}
              </View>
            )}

            {showCashbackPrompt ? (
              <View
                style={[
                  styles.prompt,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.borderInk,
                  },
                ]}>
                <ThemedText type="smallBold">Factor in grocery cash back?</ThemedText>
                <View style={styles.chipRow}>
                  {CASHBACK_CHIPS.map((chip) => (
                    <ButterChip
                      key={chip.bps}
                      label={chip.label}
                      selected={false}
                      onPress={() => void pickCashback(chip.bps)}
                    />
                  ))}
                  <ButterChip label="Not now" selected={false} onPress={() => setShowCashbackPrompt(false)} />
                </View>
              </View>
            ) : null}

            {checkingStores ? (
              <ThemedText type="small" themeColor="textSecondary">
                Checking nearby stores…
              </ThemedText>
            ) : null}

            {otherOffers.length > 0 ? (
              <View style={styles.compareBlock}>
                <Pressable
                  onPress={() => setOtherStoresOpen((v) => !v)}
                  style={styles.otherToggle}
                  hitSlop={6}>
                  <ThemedText type="smallBold">
                    {otherStoresOpen ? 'Hide' : 'Other stores'} ({otherOffers.length})
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {otherStoresOpen ? '▲' : '▼'}
                  </ThemedText>
                </Pressable>
                {otherStoresOpen
                  ? otherOffers.map(({ offer, net }) =>
                      renderOfferRow(offer, net, { highlight: false }),
                    )
                  : null}
              </View>
            ) : best ? (
              <View style={styles.compareBlock}>
                {renderOfferRow(best.offer, best.net, { highlight: true })}
              </View>
            ) : null}

            {onList ? (
              <View
                style={[
                  styles.stepper,
                  {
                    backgroundColor: theme.backgroundSelected,
                    borderColor: theme.borderInk,
                  },
                ]}>
                <Pressable onPress={onDecrement} style={styles.stepBtn}>
                  <ThemedText type="smallBold">−</ThemedText>
                </Pressable>
                <ThemedText type="smallBold">{quantityOnList} on list</ThemedText>
                <Pressable onPress={onIncrement} style={styles.stepBtn}>
                  <ThemedText type="smallBold">+</ThemedText>
                </Pressable>
              </View>
            ) : (
              <ButterButton label="Add to list" variant="ink" onPress={onAdd} />
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
    borderRadius: Radius.button,
    overflow: 'hidden',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.one,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: Spacing.one,
    left: Spacing.one,
    zIndex: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.one,
    borderWidth: 1.5,
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
    fontSize: Type.section,
    lineHeight: 28,
  },
  heartBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPrice: {
    borderWidth: 2,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  heroPriceValue: {
    fontFamily: Fonts.sansBold,
    fontSize: 28,
    lineHeight: 34,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  infoChip: {
    borderWidth: 2,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  prompt: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.card,
    borderWidth: 2,
  },
  compareBlock: {
    gap: Spacing.two,
  },
  otherToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.one,
  },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.button,
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
    borderWidth: 2,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 16,
    fontFamily: Fonts.sans,
    minHeight: 40,
  },
  reportActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  reportBtn: {
    borderWidth: 2,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportSubmit: {
    borderWidth: 0,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.button,
    borderWidth: 2,
    paddingHorizontal: Spacing.three,
    minHeight: 52,
  },
  stepBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
