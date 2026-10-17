
export type GroceryProduct = {
  id: string;
  name: string;
  brand?: string;
  upc?: string;
  store: string;
  price: number | null;
  currency: string;
  size?: string;
  source: string;
  date?: string;
};