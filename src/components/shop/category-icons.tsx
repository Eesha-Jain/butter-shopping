import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

type PlatformSymbol = {
  ios: SFSymbol;
  android: AndroidSymbol;
  web: AndroidSymbol;
};

/** Cross-platform symbol names for top-level Shop categories. */
export const CATEGORY_ICONS = {
  Produce: { ios: 'leaf.fill', android: 'eco', web: 'eco' },
  Dairy: { ios: 'drop.fill', android: 'water_drop', web: 'water_drop' },
  'Meat & Seafood': { ios: 'fish.fill', android: 'set_meal', web: 'set_meal' },
  Pantry: { ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' },
  Snacks: {
    ios: 'takeoutbag.and.cup.and.straw.fill',
    android: 'takeout_dining',
    web: 'takeout_dining',
  },
  Beverages: { ios: 'cup.and.saucer.fill', android: 'coffee', web: 'coffee' },
  Frozen: { ios: 'snowflake', android: 'ac_unit', web: 'ac_unit' },
  Bakery: { ios: 'birthday.cake.fill', android: 'bakery_dining', web: 'bakery_dining' },
  Other: { ios: 'bag.fill', android: 'shopping_bag', web: 'shopping_bag' },
} as const satisfies Record<string, PlatformSymbol>;

export type CategoryIconName =
  | (typeof CATEGORY_ICONS)[keyof typeof CATEGORY_ICONS]['ios']
  | 'tag.fill'
  | 'carrot.fill';

const DEFAULT_SYMBOL = {
  ios: 'tag.fill',
  android: 'label',
  web: 'label',
} as const satisfies PlatformSymbol;

/** @deprecated Prefer CategoryIcon — kept for any string-only callers. */
export function iconForCategory(name: string): CategoryIconName {
  if (name === 'Vegetables') return 'carrot.fill';
  return (CATEGORY_ICONS as Record<string, { ios: CategoryIconName }>)[name]?.ios ?? 'tag.fill';
}

type IconProps = {
  size: number;
  color: string;
};

/** Filled apple — SF Symbols has no fruit glyph. */
function FruitIcon({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M12 3.5v4" stroke={color} strokeWidth={2} strokeLinecap="round" fill="none" />
      <Ellipse cx={14.5} cy={5} rx={2.4} ry={1.4} fill={color} />
      <Circle cx={9.4} cy={13.2} r={5.2} fill={color} />
      <Circle cx={14.6} cy={13.2} r={5.2} fill={color} />
    </Svg>
  );
}

/** Filled carrot with leafy top — readable at chip size on every platform. */
function VegetableIcon({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path
        d="M10.5 8.5C11 6.2 12.4 4.6 14 3.8c-.4 1.8.2 3.4 1.4 4.4.6-1.5.7-3.2.2-4.8 1.6 1.1 2.6 2.9 2.6 4.8"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        fill="none"
      />
      <Path d="M8.8 9.2 L15.8 12.2 L9.6 21.4 Z" fill={color} />
    </Svg>
  );
}

type CategoryIconProps = IconProps & {
  name: string;
};

/** Aisle chip icon — apple/carrot for produce children; SF/Material elsewhere. */
export function CategoryIcon({ name, size, color }: CategoryIconProps) {
  if (name === 'Fruits') return <FruitIcon size={size} color={color} />;
  if (name === 'Vegetables') return <VegetableIcon size={size} color={color} />;

  const symbol: PlatformSymbol =
    (CATEGORY_ICONS as Record<string, PlatformSymbol>)[name] ?? DEFAULT_SYMBOL;

  return <SymbolView name={symbol} size={size} tintColor={color} />;
}
