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
  findProductByUpc,
  getCurrentPrice,
  getStore,
  listCurrentPromotions,
  nearbyStores,
  productWarnings,
  reportPrice,
  searchCategories,
  searchProducts
} from './catalog';
export { nextPreferredGroceryDate } from './dates';
export {
  createGroup,
  joinGroup,
  leaveGroup,
  listGroupBalances,
  listGroupMembers,
  listMyGroups,
  updateGroup
} from './groups';
export {
  addListItem,
  addRecipeToList,
  createList,
  listGroupLists,
  listResolvedItems,
  removeListItem,
  setListItemDone,
  updateListItem
} from './lists';
export { evenShareCents, payerRemainderCents } from './money';
export { registerPushToken, removePushToken, sendOrderConfirmationPush } from './notifications';
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
  requestCheckoutLink
} from './orders';
export {
  getWeeklyBudgetCents,
  priceOptions,
  recommendShoppingPlan,
  suggestGroceryDate
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

