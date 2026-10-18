/**
 * App-facing data access. Screens import from here instead of calling Supabase
 * table queries directly. See README.md for which function belongs to which task.
 */
export { AppError } from '../errors';
export type {
  FoodRuleMode, FulfillmentMethod,
  GroupKind, TraitKind,
  TraitRelation,
  TripStatus
} from '../types';
export {
  getSession,
  onAuthStateChange,
  requestPasswordReset,
  signIn,
  signInWithGoogle,
  signOut,
  signUp
} from './auth';
export {
  findProductByUpc, findProductByUpc, getCurrentPrice, getCurrentPrice, getStore, getStore, listCurrentPromotions, listCurrentPromotions,
  nearbyShops, nearbyStores,
  productWarnings, productWarnings, reportPrice, reportPrice, searchCategories, searchCategories, searchProducts, searchProducts
} from './catalog';
export { nextPreferredGroceryDate } from './dates';
export {
  createGroup, createGroup, joinGroup, joinGroup, leaveGroup, leaveGroup, listGroupBalances, listGroupBalances, listGroupMembers, listGroupMembers, listMyGroups, listMyGroups, updateGroup, updateGroup
} from './groups';
export {
  addListItem, addListItem, addRecipeToList, addRecipeToList, createList, createList, listGroupLists, listGroupLists, listResolvedItems, listResolvedItems, removeListItem, removeListItem, setListItemDone, setListItemDone, updateListItem, updateListItem
} from './lists';
export { fetchNearbyShops, getUserCoords } from './locationService';
export { evenShareCents, payerRemainderCents } from './money';
export { registerPushToken, removePushToken, sendOrderConfirmationPush } from './notifications';
export {
  cancelOrder, cancelOrder, confirmOrder, confirmOrder, createTripFromList, createTripFromList, finalizeOrder, finalizeOrder, getTrip, getTrip, listOrderItems, listOrderItems, listOrderShares, listOrderShares, markSharePaid, markSharePaid, previewEvenSplit, previewEvenSplit, requestCheckoutLink, requestCheckoutLink
} from './orders';
export {
  getWeeklyBudgetCents, getWeeklyBudgetCents, priceOptions, priceOptions, recommendShoppingPlan, recommendShoppingPlan, suggestGroceryDate, suggestGroceryDate
} from './planning';
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

