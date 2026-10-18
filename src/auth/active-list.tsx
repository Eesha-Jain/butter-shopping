import {
  createContext,
  use,
  useCallback,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';

import { useSession } from '@/auth/session';
import { listMyListTargets, type ActiveListTarget } from '@/backend';
import { getItem, removeItem, setItem } from '@/backend/storage';

type ActiveListContextValue = {
  targets: ActiveListTarget[];
  activeTarget: ActiveListTarget | null;
  isLoading: boolean;
  setActiveTarget: (target: ActiveListTarget) => void;
  refreshTargets: () => Promise<ActiveListTarget[]>;
  /** Select the target whose group id matches (after create/join). */
  selectGroupId: (groupId: string) => Promise<void>;
};

const ActiveListContext = createContext<ActiveListContextValue | null>(null);

export function useActiveList(): ActiveListContextValue {
  const value = use(ActiveListContext);
  if (!value) {
    throw new Error('useActiveList must be used within an ActiveListProvider');
  }
  return value;
}

function pickActiveTarget(
  targets: ActiveListTarget[],
  preferredListId: string | null,
): ActiveListTarget | null {
  if (preferredListId) {
    const restored = targets.find((row) => row.list.id === preferredListId);
    if (restored) return restored;
  }
  const personal = targets.find((row) => row.group.kind === 'personal');
  return personal ?? targets[0] ?? null;
}

export function ActiveListProvider({ children }: PropsWithChildren) {
  const { session, isGuest } = useSession();
  const [targets, setTargets] = useState<ActiveListTarget[]>([]);
  const [activeTarget, setActiveTargetState] = useState<ActiveListTarget | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const setActiveTarget = useCallback((target: ActiveListTarget) => {
    setActiveTargetState(target);
    setItem('activeListId', target.list.id);
  }, []);

  const refreshTargets = useCallback(async () => {
    if (isGuest || !session) {
      setTargets([]);
      setActiveTargetState(null);
      setIsLoading(false);
      return [];
    }
    setIsLoading(true);
    try {
      const nextTargets = await listMyListTargets();
      setTargets(nextTargets);
      const next = pickActiveTarget(nextTargets, getItem('activeListId'));
      setActiveTargetState(next);
      if (next) {
        setItem('activeListId', next.list.id);
      } else {
        removeItem('activeListId');
      }
      return nextTargets;
    } catch {
      setTargets([]);
      setActiveTargetState(null);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [isGuest, session]);

  const selectGroupId = useCallback(
    async (groupId: string) => {
      const nextTargets = await refreshTargets();
      const match = nextTargets.find((row) => row.group.id === groupId);
      if (match) {
        setActiveTarget(match);
      } else if (nextTargets[0]) {
        setActiveTarget(nextTargets[0]);
      }
    },
    [refreshTargets, setActiveTarget],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshTargets();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshTargets]);

  const value: ActiveListContextValue = {
    targets,
    activeTarget,
    isLoading,
    setActiveTarget,
    refreshTargets,
    selectGroupId,
  };

  return <ActiveListContext.Provider value={value}>{children}</ActiveListContext.Provider>;
}
