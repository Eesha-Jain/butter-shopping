/**
 * App-facing data access. Screens import from here instead of calling Supabase
 * table queries directly. See README.md for which function belongs to which task.
 */
export { AppError } from '../errors';
export type {
  FoodRuleMode, FulfillmentMethod, GroupKind, TraitKind, TraitRelation, TripStatus
} from '../types';
export {
  getOptionalUserId,
  getSession,
  onAuthStateChange,
  requestPasswordReset,
  signIn,
  signInWithGoogle,
  signOut,
  signUp
} from './auth';
export {
  ensureCatalogForTerm,
  findOrIngestProductByUpc,
  findProductByUpc,
  formatPromotionBadge,
  promotionSavingsHint,
  getCheapestPriceCentsByProductIds,
  getStorePriceCentsByProductIds,
  getCurrentPrice,
  getProductPromotionMap, getProductsByIds, getProductTraitsForIds, getStore,
  listActiveProducts,
  listCampusPopularProducts,
  listCategories, listCurrentPromotions, listProductsGroupedByCategory,
  listProductStoreOffers, listReportableStores, listReportedOffers, listStoreShelf, nearbyShops,
  productWarnings,
  refreshProductStoreOffers,
  registerReportableStore,
  reportManualPrice,
  reportPrice,
  reportStoreProductAvailability,
  searchCategories,
  searchProducts,
  uploadPriceEvidence,
} from './catalog';
export type { CategoryProductSection, ProductStoreOffer } from './catalog';
export {
  contributeReportedPriceToOpenPrices,
  fetchOpenPricesByUpc,
  fetchOpenPricesByUpcs,
  getOpenPricesCentsByUpcs,
  openPricesGeoKey,
} from './open-prices';
export type { OpenPriceRow, OpenPricesGeo } from './open-prices';
export { nextPreferredGroceryDate } from './dates';
export { listMyFavoriteProductIds, setProductFavorite } from './favorites';
export {
  applyFoodFilters,
  areAllTraitsAvoided,
  groupAvoidTraitsForFilterUi,
  groupTraitsForFilterUi,
  indexTraitsByProduct,
  rulesFromUserFoodRules,
  toggleAvoidGroup,
} from './foodFilters';
export type {
  AvoidTraitGroup,
  AvoidTraitGroupId,
  SessionFoodRule,
  ShopSort,
} from './foodFilters';
export {
  createGroup,
  getGroup,
  joinGroup,
  leaveGroup,
  listGroupBalances,
  listGroupMembers,
  listGroupMembersWithProfiles,
  listMyGroups,
  updateGroup,
} from './groups';
export type { GroupMemberWithProfile } from './groups';
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
  updateListItem
} from './lists';
export type { ActiveListTarget } from './lists';
export {
  formatLocalDateTime,
  getDeviceTimeZone,
  isPriorLocalCalendarDay, todayLocalDateKey, toLocalDateKey
} from './localTime';
export {
  fetchNearbyShops,
  getUserCoords,
  resolveSearchCoords,
  resolveShopZip
} from './locationService';
export type { SearchCoords } from './locationService';
export { evenShareCents, payerRemainderCents } from './money';
export { registerPushToken, removePushToken, sendOrderConfirmationPush } from './notifications';
export {
  cancelOrder,
  confirmOrder,
  createTripFromList,
  finalizeOrder,
  findOpenTrip,
  getTrip,
  listGroupOrders,
  listOrderItems,
  listOrderShares,
  markSharePaid,
  placeStoreOrderFromList,
  previewEvenSplit,
  requestCheckoutLink,
} from './orders';
export type { GroupOrderRow } from './orders';
export {
  getWeeklyBudgetCents,
  planLowestTrip,
  priceOptions,
  recommendShoppingPlan,
  suggestBestShopDate,
  suggestDiscountDate,
  suggestGroceryDate
} from './planning';
export type { BestShopDay, ShopDayReason, ShopDayStoreHint } from './planning';
export { getWeeklyShoppingBoard } from './weeklyShopping';
export type { WeeklyBoardChip, WeeklyBoardColumn, WeeklyShoppingBoard } from './weeklyShopping';
export { listColleges, resolveCollegeId } from './colleges';
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
  uploadMyAvatar
} from './profiles';
export {
  addDueHabitItems,
  listExpiringPurchases,
  listHabits,
  listMyStapleProductIds,
  listPurchases,
  recordPurchase,
  saveHabit
} from './purchases';
export {
  addRecipeIngredient,
  createRecipe,
  getRecipeDetail,
  listTrending,
  listVisibleRecipes
} from './recipes';
export { analyzeRipeness } from './ripeness';
export type { RipenessResult } from './ripeness';
export { getProductSafety, traitsChangedSince } from './safety';
export * from './voice';

