import { Spacing } from '@/constants/theme';

export type ProductPeekAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const PEEK_MAX_WIDTH = 380;

/** Conservative height until content onLayout refines it. */
export const PEEK_DEFAULT_HEIGHT = 400;

type Insets = { top: number; bottom: number; left: number; right: number };

/**
 * Expanded peek frame: centered on the source card, clamped inside the screen.
 */
export function computeExpandedPeekRect(
  anchor: ProductPeekAnchor,
  window: { width: number; height: number },
  insets: Insets,
  contentHeight = PEEK_DEFAULT_HEIGHT,
): ProductPeekAnchor {
  const hPad = Spacing.four;
  const minX = hPad + insets.left;
  const minY = insets.top + Spacing.two;
  const maxRight = window.width - insets.right - hPad;
  const maxBottom = window.height - insets.bottom - Spacing.two;

  const expandedWidth = Math.min(PEEK_MAX_WIDTH, maxRight - minX);
  const expandedHeight = Math.min(contentHeight, maxBottom - minY);

  const sourceCx = anchor.x + anchor.width / 2;
  const sourceCy = anchor.y + anchor.height / 2;

  let x = sourceCx - expandedWidth / 2;
  let y = sourceCy - expandedHeight / 2;

  x = Math.max(minX, Math.min(x, maxRight - expandedWidth));
  y = Math.max(minY, Math.min(y, maxBottom - expandedHeight));

  return { x, y, width: expandedWidth, height: expandedHeight };
}

export function isValidPeekAnchor(anchor: ProductPeekAnchor | null | undefined): anchor is ProductPeekAnchor {
  return anchor != null && anchor.width > 0 && anchor.height > 0;
}
