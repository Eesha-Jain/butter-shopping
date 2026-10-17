// src/hooks/useProductSearch.js
import { useCallback, useState } from "react";
import { searchProducts } from "../api/kroger";

export function useProductSearch(locationId) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // useCallback keeps the same function instance between renders,
  // which avoids unnecessary re-renders in components that use it
  const search = useCallback(
    async (term) => {
      if (!term.trim() || !locationId) return;
      setLoading(true);
      setError(null);
      try {
        setResults(await searchProducts(term, locationId));
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false); // runs whether the request succeeded or failed
      }
    },
    [locationId]
  );

  return { results, loading, error, search };
}