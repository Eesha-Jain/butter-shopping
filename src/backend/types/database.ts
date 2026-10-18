/**
 * Hand-written Database types for the baseline migrations.
 * After this project is linked to Supabase, regenerate this file with:
 * `npx supabase gen types typescript --linked > src/backend/types/database.ts`
 * Re-export shared names from `src/backend/types/index.ts` for the rest of the app.
 */

type Table<Row extends Record<string, unknown>> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

type View<Row extends Record<string, unknown>> = {
  Row: Row;
  Relationships: [];
};

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type GroupKind = 'personal' | 'household' | 'event';
export type TraitKind = 'ingredient' | 'allergen' | 'chemical' | 'dietary' | 'certification';
export type TraitRelation = 'contains' | 'may_contain' | 'suitable' | 'certified';
export type FoodRuleMode = 'avoid' | 'require' | 'prefer';
export type TripStatus = 'draft' | 'ordered' | 'cancelled';
export type FulfillmentMethod = 'self_pickup' | 'store_pickup' | 'delivery';
export type ShareStatus = 'owed' | 'paid';

export type Database = {
  public: {
    Tables: {
      colleges: Table<College>;
      dining_plans: Table<DiningPlan>;
      chains: Table<Chain>;
      stores: Table<Store>;
      product_categories: Table<ProductCategory>;
      products: Table<Product>;
      store_products: Table<StoreProduct>;
      prices: Table<Price>;
      discount_groups: Table<DiscountGroup>;
      promotions: Table<Promotion>;
      food_traits: Table<FoodTrait>;
      product_traits: Table<ProductTrait>;
      profiles: Table<Profile>;
      user_locations: Table<UserLocation>;
      user_stores: Table<UserStore>;
      discount_eligibilities: Table<DiscountEligibility>;
      user_food_rules: Table<UserFoodRule>;
      groups: Table<Group>;
      group_members: Table<GroupMember>;
      lists: Table<GroceryList>;
      list_items: Table<ListItem>;
      item_habits: Table<ItemHabit>;
      shopping_trips: Table<ShoppingTrip>;
      orders: Table<Order>;
      order_items: Table<OrderItem>;
      order_shares: Table<OrderShare>;
      purchases: Table<Purchase>;
      recipes: Table<Recipe>;
      recipe_ingredients: Table<RecipeIngredient>;
      sponsorships: Table<Sponsorship>;
      push_tokens: Table<PushToken>;
      product_favorites: Table<ProductFavorite>;
    };
    Views: {
      current_prices: View<CurrentPrice>;
      current_unit_prices: View<CurrentUnitPrice>;
      v_list_items: View<ResolvedListItem>;
      v_order_summary: View<OrderSummary>;
      v_group_balances: View<GroupBalance>;
      v_recipe_detail: View<RecipeDetail>;
      v_due_habits: View<DueHabit>;
      v_expiring_purchases: View<ExpiringPurchase>;
      v_trending: View<TrendingRow>;
    };
    Functions: {
      create_group: { Args: { p_name: string; p_kind: 'household' | 'event' }; Returns: string };
      join_group: { Args: { p_invite_code: string }; Returns: string };
      leave_group: { Args: { p_group_id: string }; Returns: undefined };
      nearby_shops: {
        Args: { p_latitude: number; p_longitude: number; p_radius_km?: number };
        Returns: NearbyStore[];
      };
      price_options: {
        Args: {
          p_group_id: string;
          p_category_id: string | null;
          p_product_id: string | null;
          p_planned_for: string;
          p_quantity: number;
          p_amount_base: number | null;
          p_size_flexible: boolean;
          p_latitude?: number | null;
          p_longitude?: number | null;
        };
        Returns: PriceOption[];
      };
      recommend_shopping_plan: {
        Args: {
          p_list_id: string;
          p_planned_for: string;
          p_latitude?: number | null;
          p_longitude?: number | null;
        };
        Returns: ShoppingPlanLine[];
      };
      create_trip_from_list: {
        Args: {
          p_list_id: string;
          p_planned_for: string;
          p_fulfillment_method?: FulfillmentMethod;
          p_delivery_location_id?: string | null;
          p_latitude?: number | null;
          p_longitude?: number | null;
        };
        Returns: string;
      };
      confirm_order: { Args: { p_order_id: string }; Returns: undefined };
      finalize_order: { Args: { p_order_id: string }; Returns: undefined };
      record_purchase: {
        Args: {
          p_group_id: string;
          p_store_product_id: string;
          p_quantity: number;
          p_unit_price_cents: number;
          p_expires_on?: string | null;
          p_purchased_at?: string | null;
        };
        Returns: string;
      };
      add_due_habit_items: { Args: Record<string, never>; Returns: number };
      recommend_discount_date: {
        Args: {
          p_latitude?: number | null;
          p_longitude?: number | null;
          p_radius_km?: number | null;
        };
        Returns: string | null;
      };
      list_reportable_stores: { Args: Record<string, never>; Returns: ReportableStore[] };
      register_reportable_store: {
        Args: {
          p_name: string;
          p_kind: 'trader_joes' | 'campus';
          p_college_name?: string | null;
          p_address_line1?: string | null;
          p_city?: string | null;
          p_region?: string | null;
          p_postal_code?: string | null;
          p_latitude?: number | null;
          p_longitude?: number | null;
        };
        Returns: string;
      };
      report_manual_price: {
        Args: {
          p_store_id: string;
          p_product_name: string;
          p_price_cents: number;
          p_brand?: string | null;
          p_upc?: string | null;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type College = AddressFields & {
  id: string;
  name: string;
  logo_path: string | null;
  style: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DiningPlan = {
  id: string;
  college_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type Chain = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type Store = AddressFields & {
  id: string;
  name: string;
  chain_id: string | null;
  college_id: string | null;
  accepts_snap: boolean;
  source: string;
  source_ref: string;
  created_at: string;
  updated_at: string;
};

export type ProductCategory = {
  id: string;
  name: string;
  parent_id: string | null;
  base_unit: 'g' | 'ml' | 'ct';
  /** Days after purchase before a typical item spoils; null = non-perishable/unknown. */
  typical_shelf_life_days: number | null;
  created_at: string;
  updated_at: string;
};

export type Product = {
  id: string;
  name: string;
  brand: string | null;
  upc: string | null;
  category_id: string | null;
  /** off | keyword | manual — how category_id was assigned */
  category_source: 'off' | 'keyword' | 'manual' | null;
  size_base_amount: number | null;
  size_base_unit: 'g' | 'ml' | 'ct' | null;
  /** Overrides category typical_shelf_life_days when set. */
  shelf_life_days: number | null;
  image_path: string | null;
  ingredients_text: string | null;
  ingredients_updated_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProductFavorite = {
  user_id: string;
  product_id: string;
  created_at: string;
};

export type StoreProduct = {
  id: string;
  store_id: string;
  product_id: string;
  store_sku: string | null;
  product_url: string | null;
  is_available: boolean;
  created_at: string;
  updated_at: string;
};

export type ReportableStore = {
  id: string;
  name: string;
  chain_name: string | null;
  college_id: string | null;
  college_name: string | null;
  address_line1: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
};

export type Price = {
  id: string;
  store_product_id: string;
  price_cents: number;
  source: 'api' | 'scrape' | 'user_report';
  submitted_by: string | null;
  created_at: string;
  regular_price_cents: number | null;
  external_ref: string | null;
};

export type DiscountGroup = {
  code: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type Promotion = {
  id: string;
  store_id: string | null;
  chain_id: string | null;
  product_id: string | null;
  discount_type: 'percent_off' | 'amount_off' | 'bogo';
  discount_value: number;
  requires_group: string | null;
  weekdays: number[] | null;
  month_days: number[] | null;
  month_ordinals: number[] | null;
  starts_at: string;
  ends_at: string;
  created_at: string;
  updated_at: string;
  external_ref: string | null;
};

export type FoodTrait = {
  id: string;
  code: string;
  name: string;
  kind: TraitKind;
  created_at: string;
  updated_at: string;
};

export type ProductTrait = {
  id: string;
  product_id: string;
  trait_id: string;
  relation: TraitRelation;
  source: 'external' | 'model' | 'user_report' | 'manual';
  observed_at: string;
};

export type Profile = {
  id: string;
  display_name: string | null;
  avatar_path: string | null;
  college_id: string | null;
  dining_plan_id: string | null;
  weekly_budget_cents: number | null;
  preferred_days: number[] | null;
  max_stores_per_trip: number | null;
  transport_mode: 'walk' | 'bike' | 'drive' | 'transit' | 'rideshare' | null;
  /** Grocery cashback in basis points (e.g. 300 = 3%). Never a card number. */
  grocery_cashback_bps: number | null;
  /** When Eat/Save/Shop onboarding was finished or skipped. */
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UserLocation = AddressFields & {
  id: string;
  user_id: string;
  label: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type UserStore = {
  user_id: string;
  store_id: string;
  created_at: string;
};

export type DiscountEligibility = {
  user_id: string;
  group_code: string;
  consented_at: string;
};

export type UserFoodRule = {
  id: string;
  user_id: string;
  trait_id: string;
  mode: FoodRuleMode;
  created_at: string;
  updated_at: string;
};

export type Group = {
  id: string;
  name: string;
  kind: GroupKind;
  invite_code: string | null;
  created_by: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GroupMember = {
  id: string;
  group_id: string;
  user_id: string;
  role: 'owner' | 'member';
  created_at: string;
  updated_at: string;
};

export type GroceryList = {
  id: string;
  group_id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type ListItem = {
  id: string;
  list_id: string;
  added_by: string | null;
  product_id: string | null;
  category_id: string | null;
  custom_name: string | null;
  quantity: number;
  amount_base: number | null;
  size_flexible: boolean;
  source_recipe_id: string | null;
  done_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ItemHabit = {
  id: string;
  group_id: string;
  product_id: string | null;
  category_id: string | null;
  interval_days: number;
  usual_amount_base: number | null;
  next_due_on: string;
  auto_add_enabled: boolean;
  source: 'user' | 'inferred';
  created_at: string;
  updated_at: string;
};

export type ShoppingTrip = {
  id: string;
  group_id: string;
  planned_for: string;
  fulfillment_method: FulfillmentMethod;
  delivery_location_id: string | null;
  status: TripStatus;
  created_at: string;
  updated_at: string;
};

export type Order = {
  id: string;
  trip_id: string;
  group_id: string;
  store_id: string;
  status: TripStatus;
  expires_at: string | null;
  paid_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  checkout_url: string | null;
  placed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderItem = {
  id: string;
  order_id: string;
  store_product_id: string;
  quantity: number;
  unit_price_cents: number;
  list_item_id: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderShare = {
  id: string;
  order_id: string;
  user_id: string;
  amount_cents: number;
  status: ShareStatus;
  settled_via: 'manual' | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Purchase = {
  id: string;
  user_id: string;
  group_id: string;
  store_product_id: string;
  quantity: number;
  unit_price_cents: number;
  order_id: string | null;
  purchased_at: string;
  expires_on: string | null;
};

export type Recipe = {
  id: string;
  title: string;
  source_url: string | null;
  video_url: string | null;
  instructions: string | null;
  servings: number | null;
  image_path: string | null;
  created_by: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

export type RecipeIngredient = {
  id: string;
  recipe_id: string;
  raw_text: string;
  category_id: string | null;
  amount_base: number | null;
  created_at: string;
  updated_at: string;
};

export type Sponsorship = {
  id: string;
  product_id: string | null;
  recipe_id: string | null;
  college_id: string | null;
  starts_at: string;
  ends_at: string;
  created_at: string;
  updated_at: string;
};

export type PushToken = {
  id: string;
  user_id: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  created_at: string;
  updated_at: string;
};

export type AddressFields = {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type CurrentPrice = {
  store_product_id: string;
  price_cents: number;
  source: Price['source'];
  created_at: string;
  is_stale: boolean;
};

/** Completeness + trust flags per store listing (product_price_health view). */
export type ProductPriceHealth = {
  store_product_id: string;
  store_id: string;
  product_id: string;
  has_upc: boolean;
  has_size: boolean;
  has_trusted_price: boolean;
  price_source: Price['source'] | null;
  is_stale: boolean;
  completeness_score: number;
};

export type CurrentUnitPrice = {
  store_product_id: string;
  price_cents: number;
  is_stale: boolean;
  size_base_amount: number | null;
  size_base_unit: Product['size_base_unit'];
  cents_per_base_unit: number | null;
};

export type ResolvedListItem = {
  id: string;
  list_id: string;
  quantity: number;
  amount_base: number | null;
  size_flexible: boolean;
  done_at: string | null;
  product_id: string | null;
  category_id: string | null;
  custom_name: string | null;
  source_recipe_id: string | null;
  display_name: string | null;
  best_store_product_id: string | null;
  best_price_cents: number | null;
  best_price_is_stale: boolean | null;
};

export type OrderSummary = {
  order_id: string;
  trip_id: string;
  group_id: string;
  store_id: string;
  status: TripStatus;
  planned_for: string;
  fulfillment_method: FulfillmentMethod;
  delivery_location_id: string | null;
  expires_at: string | null;
  placed_at: string | null;
  confirmed_at: string | null;
  paid_by: string | null;
  checkout_url: string | null;
  item_count: number;
  total_cents: number;
};

export type GroupBalance = {
  group_id: string;
  user_id: string;
  paid_by: string | null;
  amount_owed_cents: number | null;
};

export type RecipeDetail = {
  recipe_id: string;
  title: string;
  servings: number | null;
  image_path: string | null;
  instructions: string | null;
  is_public: boolean;
  created_by: string | null;
  ingredient_id: string;
  raw_text: string;
  category_id: string | null;
  amount_base: number | null;
  est_min_price_cents: number | null;
};

export type DueHabit = {
  id: string;
  group_id: string;
  product_id: string | null;
  category_id: string | null;
  interval_days: number;
  usual_amount_base: number | null;
  next_due_on: string;
  auto_add_enabled: boolean;
};

export type ExpiringPurchase = {
  id: string;
  group_id: string;
  user_id: string;
  store_product_id: string;
  quantity: number;
  expires_on: string;
  purchased_at: string;
};

export type TrendingRow = {
  kind: 'product' | 'recipe';
  product_id: string | null;
  recipe_id: string | null;
  college_id: string | null;
  source: 'organic' | 'sponsored';
  score: number | null;
  starts_at: string | null;
  ends_at: string | null;
};

export type NearbyStore = {
  id: string;
  name: string;
  chain_id: string | null;
  college_id: string | null;
  address_line1: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_km: number | null;
};

export type PriceOption = {
  product_id: string;
  store_id: string;
  store_product_id: string;
  shelf_price_cents: number;
  line_cents: number;
  cents_per_base_unit: number | null;
  distance_km: number | null;
  is_stale: boolean;
  preferred_match: boolean;
  /** Resolved product then category shelf life in days. */
  shelf_life_days: number | null;
  /** Daily usage from habit or amount_base/7; null means no waste penalty. */
  usage_per_day: number | null;
  /** How much of the pack is usable before spoil. */
  usable_amount_base: number | null;
  /** line_cents / usable_amount_base; prefer this when ranking offers. */
  effective_cents_per_base: number | null;
};

export type ShoppingPlanLine = {
  list_item_id: string;
  display_name: string | null;
  store_id: string | null;
  store_product_id: string | null;
  shelf_price_cents: number | null;
  line_cents: number | null;
  distance_km: number | null;
  is_stale: boolean | null;
  over_budget: boolean;
  /** Waste-adjusted unit cost used to pick this offer. */
  effective_cents_per_base: number | null;
};
