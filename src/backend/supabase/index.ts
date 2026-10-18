/**
 * App-facing data access. Screens import from here instead of calling Supabase
 * table queries directly. See README.md for which function belongs to which task.
 */
export { AppError } from '../errors';
export { evenShareCents, payerRemainderCents } from './money';
export { nextPreferredGroceryDate } from './dates';
export {
  getSession,
  onAuthStateChange,
  requestPasswordReset,
  signIn,
  signInWithGoogle,
  signOut,
  signUp,
} from './auth';
export {
  getMyProfile,
  listFoodTraits,
  listMyDiscountEligibilities,
  listMyFoodRules,
  listMyLocations,
  preferStore,
  publicImageUrl,
  removeMyAvatar,
  saveMyLocation,
  setDiscountEligibility,
  setMyFoodRules,
  unpreferStore,
  updateMyProfile,
  uploadMyAvatar,
} from './profiles';
export {
  createGroup,
  joinGroup,
  leaveGroup,
  listGroupBalances,
  listGroupMembers,
  listMyGroups,
  updateGroup,
} from './groups';
export {
  addListItem,
  addRecipeToList,
  buildStandardList,
  createList,
  getActiveListProductQtyMap,
  getDefaultGroceryList,
  getMyDefaultList,
  listGroupLists,
  listListItems,
  listMyListTargets,
  listResolvedItems,
  removeListItem,
  setListItemDone,
  updateListItem,
} from './lists';
export type { ActiveListTarget } from './lists';
export {
  ensureCatalogForTerm,
  findOrIngestProductByUpc,
  findProductByUpc,
  formatPromotionBadge,
  getCheapestPriceCentsByProductIds,
  getCurrentPrice,
  getProductPromotionMap,
  getProductTraitsForIds,
  getProductsByIds,
  getStore,
  listActiveProducts,
  listCampusPopularProducts,
  listCategories,
  listCurrentPromotions,
  listReportedOffers,
  listReportableStores,
  nearbyShops,
  productWarnings,
  registerReportableStore,
  reportManualPrice,
  reportPrice,
  searchCategories,
  searchProducts,
} from './catalog';
export {
  applyFoodFilters,
  groupTraitsForFilterUi,
  indexTraitsByProduct,
  rulesFromUserFoodRules,
} from './foodFilters';
export type { SessionFoodRule, ShopSort } from './foodFilters';
export { fetchNearbyShops, getUserCoords, resolveShopZip } from './locationService';
export {
  getWeeklyBudgetCents,
  planLowestTrip,
  priceOptions,
  recommendShoppingPlan,
  suggestDiscountDate,
  suggestGroceryDate,
} from './planning';
export {
  cancelOrder,
  confirmOrder,
  createTripFromList,
  finalizeOrder,
  getTrip,
  listOrderItems,
  listOrderShares,
  markSharePaid,
  previewEvenSplit,
  requestCheckoutLink,
} from './orders';
export {
  addDueHabitItems,
  listExpiringPurchases,
  listHabits,
  listMyStapleProductIds,
  listPurchases,
  recordPurchase,
  saveHabit,
} from './purchases';
export {
  addRecipeIngredient,
  createRecipe,
  getRecipeDetail,
  listTrending,
  listVisibleRecipes,
} from './recipes';
export { getProductSafety, traitsChangedSince } from './safety';
export { registerPushToken, removePushToken, sendOrderConfirmationPush } from './notifications';
export { analyzeRipeness } from './ripeness';
export type { RipenessResult } from './ripeness';
export type {
  FulfillmentMethod,
  GroupKind,
  FoodRuleMode,
  TraitKind,
  TraitRelation,
  TripStatus,
} from '../types';
