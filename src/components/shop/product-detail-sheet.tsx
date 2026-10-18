import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import { forwardRef, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Product } from '@/backend';
import { publicImageUrl } from '@/backend';
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

export const ProductDetailSheet = forwardRef<BottomSheetModal, Props>(function ProductDetailSheet(
  { product, saleBadge, quantityOnList, onAdd, onIncrement, onDecrement },
  ref,
) {
  const theme = useTheme();
  const snapPoints = useMemo(() => ['42%'], []);
  const imageUrl = product ? publicImageUrl('public-assets', product.image_path) : null;
  const onList = quantityOnList != null && quantityOnList > 0;

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
      <BottomSheetView style={styles.content}>
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
      </BottomSheetView>
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
