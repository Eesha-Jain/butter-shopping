import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useSession } from '@/auth/session';
import { getMyProfile } from '@/backend';
import { ShopProfileDrawer } from '@/components/shop/shop-profile-drawer';

type AppProfileContextValue = {
  displayName: string | null;
  avatarPath: string | null;
  avatarVersion: number;
  headerName: string;
  profileOpen: boolean;
  openProfile: () => void;
  closeProfile: () => void;
  refreshProfile: () => Promise<void>;
  setAvatarPath: (path: string | null) => void;
  bumpAvatarVersion: () => void;
};

const AppProfileContext = createContext<AppProfileContextValue | null>(null);

export function AppProfileProvider({ children }: { children: ReactNode }) {
  const { isGuest, requestSignIn, signOut } = useSession();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);

  const refreshProfile = useCallback(async () => {
    if (isGuest) {
      setDisplayName(null);
      setAvatarPath(null);
      return;
    }
    try {
      const profile = await getMyProfile();
      setDisplayName(profile.display_name);
      setAvatarPath(profile.avatar_path);
    } catch {
      // Keep last known values; Shop/Plan can still render.
    }
  }, [isGuest]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const openProfile = useCallback(() => setProfileOpen(true), []);
  const closeProfile = useCallback(() => setProfileOpen(false), []);
  const bumpAvatarVersion = useCallback(() => setAvatarVersion(Date.now()), []);

  const headerName = isGuest ? 'Guest' : displayName?.trim() || 'Butter shopper';

  const value = useMemo(
    () => ({
      displayName,
      avatarPath,
      avatarVersion,
      headerName,
      profileOpen,
      openProfile,
      closeProfile,
      refreshProfile,
      setAvatarPath,
      bumpAvatarVersion,
    }),
    [
      displayName,
      avatarPath,
      avatarVersion,
      headerName,
      profileOpen,
      openProfile,
      closeProfile,
      refreshProfile,
      bumpAvatarVersion,
    ],
  );

  return (
    <AppProfileContext.Provider value={value}>
      {children}
      {profileOpen ? (
        <ShopProfileDrawer
          key="app-profile"
          visible
          displayName={displayName}
          avatarPath={avatarPath}
          avatarVersion={avatarVersion}
          isGuest={isGuest}
          onClose={closeProfile}
          onRequestAuth={(mode) => {
            closeProfile();
            requestSignIn(mode);
          }}
          onSignOut={async () => {
            closeProfile();
            await signOut();
          }}
          onAvatarChanged={(path) => {
            setAvatarPath(path);
            bumpAvatarVersion();
          }}
        />
      ) : null}
    </AppProfileContext.Provider>
  );
}

export function useAppProfile(): AppProfileContextValue {
  const ctx = useContext(AppProfileContext);
  if (!ctx) {
    throw new Error('useAppProfile must be used within AppProfileProvider');
  }
  return ctx;
}
