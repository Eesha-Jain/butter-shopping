import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import {
  listProductStoreOffers,
  publicImageUrl,
  type Product,
  type ProductStoreOffer,
} from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  product: Product | null;
  saleBadge?: string | null;
  quantityOnList?: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export const ProductDetailSheet = forwardRef<BottomSheetModal, Props>(function ProductDetailSheet(
  { product, saleBadge, quantityOnList, onAdd, onIncrement, onDecrement },
  ref,
) {
  const theme = useTheme();
  const snapPoints = useMemo(() => ['55%', '78%'], []);
  const imageUrl = product ? publicImageUrl('public-assets', product.image_path) : null;
  const onList = quantityOnList != null && quantityOnList > 0;
  const [offers, setOffers] = useState<ProductStoreOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);

  useEffect(() => {
    if (!product?.id) {
      setOffers([]);
      return;
    }
    let cancelled = false;
    setOffersLoading(true);
    void listProductStoreOffers(product.id)
      .then((rows) => {
        if (!cancelled) setOffers(rows);
      })
      .catch(() => {
        if (!cancelled) setOffers([]);
      })
      .finally(() => {
        if (!cancelled) setOffersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [product?.id]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const cheapestId = offers[0]?.storeProductId;

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
                <ThemedText type="subtitle">{product.name}</ThemedText>
                {product.brand ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {product.brand}
                  </ThemedText>
                ) : null}
              </View>
            </View>

            <View style={styles.compareBlock}>
              <ThemedText type="smallBold">Prices nearby</ThemedText>
              {offersLoading ? (
                <ActivityIndicator color={theme.primary} />
              ) : offers.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  No store prices yet for this product.
                </ThemedText>
              ) : (
                offers.map((offer) => {
                  const cheapest = offer.storeProductId === cheapestId;
                  return (
                    <View
                      key={offer.storeProductId}
                      style={[
                        styles.offerRow,
                        {
                          backgroundColor: cheapest
                            ? theme.backgroundSelected
                            : theme.backgroundElement,
                        },
                      ]}>
                      <View style={styles.offerMeta}>
                        <ThemedText type="smallBold" numberOfLines={1}>
                          {offer.chainName ?? offer.storeName}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                          {offer.storeName}
                          {!offer.isAvailable ? ' · may be unavailable' : ''}
                          {cheapest ? ' · best' : ''}
                        </ThemedText>
                      </View>
                      <ThemedText type="smallBold">{formatCents(offer.priceCents)}</ThemedText>
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
  compareBlock: {
    gap: Spacing.two,
  },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
