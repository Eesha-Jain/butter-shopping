import { AppProfileProvider } from '@/auth/app-profile';
import AppTabs from '@/components/app-tabs';

export default function AppLayout() {
  return (
    <AppProfileProvider>
      <AppTabs />
    </AppProfileProvider>
  );
}
