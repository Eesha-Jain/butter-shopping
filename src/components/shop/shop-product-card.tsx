import { memo } from 'react';

import {
  formatPromotionBadge,
  promotionSavingsHint,
  type Product,
  type Promotion,
} from '@/backend';
import { ProductCard } from '@/components/shop/product-card';
import type { ProductPeekAnchor } from '@/components/shop/product-peek-layout';

/** Stable (identity never changes) handlers shared by every shop card. */
export type ShopCardActions = {
  open: (product: Product, anchor: ProductPeekAnchor, compact: boolean, haptic: boolean) => void;
  toggleFavorite: (product: Product) => void;
  add: (product: Product) => void;
  increment: (product: Product) => void;
  decrement: (product: Product) => void;
};

type Props = {
  product: Product;
  actions: ShopCardActions;
  index?: number;
  compact?: boolean;
  metaLabel?: string | null;
  butterColor?: string;
  promotion: Promotion | null;
  priceCents: number | null;
  cashbackActive: boolean;
  quantityOnList?: number;
  isPeekSource: boolean;
  favorited: boolean;
};

/**
 * Memoized shop card: only re-renders when its own price / qty / favorite / promo changes,
 * so hidden lists and unrelated state updates don't redraw every product.
 */
export const ShopProductCard = memo(function ShopProductCard({
  product,
  actions,
  index,
  compact = false,
  metaLabel,
  butterColor,
  promotion,
  priceCents,
  cashbackActive,
  quantityOnList,
  isPeekSource,
  favorited,
}: Props) {
  const hint = promotion ? promotionSavingsHint(promotion, priceCents) : null;
  const savingsCents =
    hint?.compareAtCents != null && priceCents != null && hint.compareAtCents > priceCents
      ? hint.compareAtCents - priceCents
      : null;
  return (
    <ProductCard
      product={product}
      index={index}
      compact={compact}
      metaLabel={metaLabel}
      butterColor={butterColor}
      saleBadge={promotion ? formatPromotionBadge(promotion) : null}
      compareAtCents={hint?.compareAtCents}
      savingsLabel={hint?.savingsLabel}
      savingsCents={savingsCents}
      priceNote={!promotion && cashbackActive && priceCents != null ? 'after cash back' : null}
      quantityOnList={quantityOnList}
      priceCents={priceCents}
      isPeekSource={isPeekSource}
      favorited={favorited}
      onPress={(anchor) => actions.open(product, anchor, compact, false)}
      onLongPress={(anchor) => actions.open(product, anchor, compact, true)}
      onDoubleTap={() => actions.toggleFavorite(product)}
      onAdd={() => actions.add(product)}
      onIncrement={() => actions.increment(product)}
      onDecrement={() => actions.decrement(product)}
    />
  );
});
