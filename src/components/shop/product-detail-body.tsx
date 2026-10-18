import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

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
  refreshProductStoreOffers,
  reportManualPrice,
  reportStoreProductAvailability,
  resolveShopZip,
  runAction,
  showErrorToast,
  showSuccessToast,
  uploadPriceEvidence,
  type Product,
  type ProductStoreOffer,
  type SessionFoodRule,
  type VisaMerchantOffer,
} from '@/backend';
import type { FoodTrait, Promotion } from '@/backend/types';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type PendingEvidence = {
  uri: string;
  data: ArrayBuffer;
  contentType: string;
};

type Props = {
  product: Product;
  saleBadge?: string | null;
  promotion?: Promotion | null;
  preferenceRules?: SessionFoodRule[];
};

type DetailCacheEntry = {
  offers: ProductStoreOffer[];
  visaOffers: VisaMerchantOffer[];
  cashbackBps: number | null;
  refreshedAt: number;
};

// Session-lifetime cache so reopening a product shows prices instantly while refreshing quietly.
const detailCache = new Map<string, DetailCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

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

const STORE_SEARCH_URLS: [RegExp, string][] = [
  [/fred\s*meyer/i, 'https://www.fredmeyer.com/search?searchType=default_search&query='],
  [/qfc/i, 'https://www.qfc.com/search?searchType=default_search&query='],
  [/kroger/i, 'https://www.kroger.com/search?searchType=default_search&query='],
  [/safeway/i, 'https://www.safeway.com/shop/search-results.html?q='],
  [/trader\s*joe/i, 'https://www.traderjoes.com/home/search?global=yes&q='],
  [/whole\s*foods/i, 'https://www.wholefoodsmarket.com/grocery/search?k='],
];

function storeSearchUrl(storeLabel: string, productName: string): string {
  const match = STORE_SEARCH_URLS.find(([pattern]) => pattern.test(storeLabel));
  if (match) return `${match[1]}${encodeURIComponent(productName)}`;
  return `https://www.google.com/search?q=${encodeURIComponent(`${storeLabel} ${productName}`)}`;
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

/**
 * Store price comparison (net of profile cash back), promo/trait chips, and price/stock reporting.
 * Mount with `key={product.id}` so per-product state resets.
 */
export function ProductDetailBody({ product, saleBadge, promotion, preferenceRules = [] }: Props) {
  const theme = useTheme();
  const { isGuest, requestSignIn } = useSession();
  const cached = detailCache.get(product.id);
  const [offers, setOffers] = useState<ProductStoreOffer[]>(cached?.offers ?? []);
  const [offersLoading, setOffersLoading] = useState(!cached);
  const [visaOffers, setVisaOffers] = useState<VisaMerchantOffer[]>(cached?.visaOffers ?? []);
  const [cashbackBps, setCashbackBps] = useState<number | null>(cached?.cashbackBps ?? null);
  const [checkingStores, setCheckingStores] = useState(
    !cached || Date.now() - cached.refreshedAt > CACHE_TTL_MS,
  );
  const [reportingStoreId, setReportingStoreId] = useState<string | null>(null);
  const [reportPriceText, setReportPriceText] = useState('');
  const [reportEvidence, setReportEvidence] = useState<PendingEvidence | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [stockBusyId, setStockBusyId] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [matchLabels, setMatchLabels] = useState<string[]>([]);
  const [otherStoresOpen, setOtherStoresOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

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
        const prev = detailCache.get(product.id);
        detailCache.set(product.id, {
          offers: rows,
          visaOffers: visa.offers,
          cashbackBps: bps,
          refreshedAt: prev?.refreshedAt ?? 0,
        });
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
      try {
        const hit = detailCache.get(product.id);
        // Fresh cache: skip the slow live store check entirely.
        if (hit && Date.now() - hit.refreshedAt <= CACHE_TTL_MS) return;
        const zip = await resolveShopZip();
        if (cancelled) return;
        const rows = await refreshProductStoreOffers(product, zip);
        const prev = detailCache.get(product.id);
        detailCache.set(product.id, {
          offers: rows,
          visaOffers: prev?.visaOffers ?? [],
          cashbackBps: prev?.cashbackBps ?? null,
          refreshedAt: Date.now(),
        });
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

  const startReport = (offer: ProductStoreOffer) => {
    if (isGuest) {
      requestSignIn();
      return;
    }
    setReportingStoreId(offer.storeId);
    setReportPriceText((offer.priceCents / 100).toFixed(2));
    setReportEvidence(null);
    setReportError(null);
  };

  const cancelReport = () => {
    setReportingStoreId(null);
    setReportPriceText('');
    setReportEvidence(null);
    setReportError(null);
  };

  const pickEvidence = async (source: 'library' | 'camera') => {
    try {
      if (source === 'library') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          showErrorToast(new Error('Photo library access is required for shelf photos.'));
          return;
        }
      } else {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          showErrorToast(new Error('Camera access is required for shelf photos.'));
          return;
        }
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 0.75,
      };
      const result =
        source === 'library'
          ? await ImagePicker.launchImageLibraryAsync(options)
          : await ImagePicker.launchCameraAsync(options);
      if (result.canceled || !result.assets?.[0]?.uri) return;

      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const data = await response.arrayBuffer();
      setReportEvidence({
        uri: asset.uri,
        data,
        contentType: asset.mimeType ?? 'image/jpeg',
      });
      setReportError(null);
    } catch (err) {
      showErrorToast(err, 'Could not attach that photo.');
    }
  };

  const chooseEvidenceSource = () => {
    Alert.alert('Shelf photo', 'Add a photo of the current shelf tag.', [
      { text: 'Take photo', onPress: () => void pickEvidence('camera') },
      { text: 'Photo library', onPress: () => void pickEvidence('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const submitReport = async (offer: ProductStoreOffer) => {
    if (reportSubmitting) return;
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
      await runAction(async () => {
        let evidencePath: string | undefined;
        if (reportEvidence) {
          evidencePath = await uploadPriceEvidence({
            data: reportEvidence.data,
            contentType: reportEvidence.contentType,
          });
        }
        await reportManualPrice({
          storeId: offer.storeId,
          productName: product.name,
          priceCents,
          brand: product.brand ?? undefined,
          upc: product.upc ?? undefined,
          evidencePath,
        });
      }, 'Could not save that price.');
      showSuccessToast(
        reportEvidence ? 'Price + photo saved' : 'Price updated',
        offer.chainName ?? offer.storeName,
      );
      cancelReport();
      const rows = await listProductStoreOffers(product.id);
      setOffers(rows);
      detailCache.delete(product.id);
    } catch {
      // runAction already toasts
    } finally {
      setReportSubmitting(false);
    }
  };

  const toggleStock = async (offer: ProductStoreOffer, isAvailable: boolean) => {
    if (stockBusyId) return;
    if (isGuest) {
      requestSignIn();
      return;
    }
    if (!isReportableOffer(offer) || offer.storeProductId.startsWith('open-prices')) return;

    setStockBusyId(offer.storeProductId);
    try {
      await runAction(
        () =>
          reportStoreProductAvailability({
            storeProductId: offer.storeProductId,
            isAvailable,
          }),
        'Could not update stock status.',
      );
      showSuccessToast(
        isAvailable ? 'Marked in stock' : 'Marked out of stock',
        offer.chainName ?? offer.storeName,
      );
      setOffers((prev) =>
        prev.map((row) =>
          row.storeProductId === offer.storeProductId ? { ...row, isAvailable } : row,
        ),
      );
    } catch {
      // runAction already toasts
    } finally {
      setStockBusyId(null);
    }
  };

  const openStoreSearch = async (offer: ProductStoreOffer) => {
    try {
      await WebBrowser.openBrowserAsync(
        storeSearchUrl(offer.chainName ?? offer.storeName, product.name),
      );
    } catch (e) {
      showErrorToast(e);
    }
  };

  const openIssueMenu = (offer: ProductStoreOffer) => {
    Alert.alert('Something wrong?', offer.chainName ?? offer.storeName, [
      { text: 'Report wrong price', onPress: () => startReport(offer) },
      {
        text: offer.isAvailable ? 'Mark out of stock' : 'Mark back in stock',
        onPress: () => void toggleStock(offer, !offer.isAvailable),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const renderOfferRow = (
    offer: ProductStoreOffer,
    net: ReturnType<typeof computeNetPrice>,
    opts: { highlight?: boolean },
  ) => {
    const reporting = reportingStoreId === offer.storeId;
    const canReport = isReportableOffer(offer);
    const showNet = net.netCents < net.shelfCents;
    const row = (
      <View
        style={[
          styles.offerRow,
          {
            backgroundColor: theme.background,
            borderColor: opts.highlight ? theme.primary : theme.border,
            borderWidth: opts.highlight ? 2 : StyleSheet.hairlineWidth,
            borderLeftWidth: opts.highlight ? 4 : StyleSheet.hairlineWidth,
            borderLeftColor: opts.highlight ? theme.primary : theme.border,
          },
        ]}>
        <View style={styles.offerMeta}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {offer.chainName ?? offer.storeName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {offer.storeName}
            {!offer.isAvailable ? ' · out of stock' : ''}
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
                <TextInput
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
              {reportEvidence ? (
                <View style={styles.evidenceRow}>
                  <Image
                    source={{ uri: reportEvidence.uri }}
                    style={styles.evidenceThumb}
                    contentFit="cover"
                  />
                  <Pressable
                    onPress={() => setReportEvidence(null)}
                    disabled={reportSubmitting}
                    hitSlop={6}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Remove photo
                    </ThemedText>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={chooseEvidenceSource}
                  disabled={reportSubmitting}
                  style={[styles.reportBtn, { borderColor: theme.borderInk }]}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Add shelf photo
                  </ThemedText>
                </Pressable>
              )}
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

    if (reporting) return <View key={offer.storeProductId}>{row}</View>;

    return (
      <ReanimatedSwipeable
        key={offer.storeProductId}
        friction={2}
        rightThreshold={40}
        overshootRight={false}
        renderRightActions={() => (
          <View style={styles.swipeActions}>
            <Pressable
              accessibilityLabel={`Open ${offer.chainName ?? offer.storeName} website`}
              onPress={() => void openStoreSearch(offer)}
              style={[styles.swipeBtn, { borderColor: theme.borderInk }]}>
              <SymbolView
                name={{ ios: 'safari', android: 'open_in_new', web: 'open_in_new' }}
                size={20}
                tintColor={theme.text}
              />
            </Pressable>
            {canReport ? (
              <Pressable
                accessibilityLabel="Report a problem with this listing"
                onPress={() => openIssueMenu(offer)}
                style={[styles.swipeBtn, { borderColor: theme.borderInk }]}>
                {stockBusyId === offer.storeProductId ? (
                  <ActivityIndicator color={theme.text} size="small" />
                ) : (
                  <SymbolView
                    name={{
                      ios: 'exclamationmark.triangle',
                      android: 'warning',
                      web: 'warning',
                    }}
                    size={20}
                    tintColor={theme.text}
                  />
                )}
              </Pressable>
            ) : null}
          </View>
        )}>
        {row}
      </ReanimatedSwipeable>
    );
  };

  return (
    <View style={styles.root}>
      {best ? (
        <View style={styles.heroPrice}>
          <ThemedText style={[styles.heroPriceValue, { color: theme.text }]}>
            {formatCents(
              best.net.netCents < best.net.shelfCents ? best.net.netCents : best.net.shelfCents,
            )}
          </ThemedText>
          <ThemedText type="smallBold">
            at {best.offer.chainName ?? best.offer.storeName}
            {best.net.netCents < best.net.shelfCents ? ' · best after rewards' : ''}
          </ThemedText>
          {(savingsVsNext > 0 || best.net.cashbackCents > 0 || best.net.visaOfferCents > 0) && (
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
            <View style={[styles.infoChip, { borderColor: theme.border }]}>
              <ThemedText type="smallBold">{promoChipLabel}</ThemedText>
            </View>
          ) : null}
          {matchLabels.map((label) => (
            <View key={label} style={[styles.infoChip, { borderColor: theme.border }]}>
              <ThemedText type="smallBold">Matches: {label}</ThemedText>
            </View>
          ))}
        </View>
      )}

      {checkingStores ? (
        <ThemedText type="small" themeColor="textSecondary">
          Checking nearby stores…
        </ThemedText>
      ) : null}

      {best ? (
        <View style={styles.compareBlock}>
          {renderOfferRow(best.offer, best.net, { highlight: true })}
          {otherOffers.length > 0 ? (
            <>
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
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'stretch',
    gap: Spacing.three,
  },
  heroPrice: {
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
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
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
  evidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  evidenceThumb: {
    width: 56,
    height: 56,
    borderRadius: Spacing.one,
  },
  swipeActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.one,
    paddingLeft: Spacing.one,
  },
  swipeBtn: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: Radius.button,
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
    alignSelf: 'flex-start',
  },
  reportSubmit: {
    borderWidth: 0,
  },
});
