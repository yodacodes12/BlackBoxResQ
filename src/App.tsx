import { useEffect, useState, type ReactElement } from 'react';
import { Layout, NAV } from './components/Layout';
import { Overview } from './pages/Overview';
import { RecoveryLab } from './pages/RecoveryLab';
import { FailureLab } from './pages/FailureLab';
import { Reports } from './pages/Reports';
import { SensorHealth } from './pages/SensorHealth';

const PAGES: Record<string, () => ReactElement> = {
  overview: Overview, sensor: SensorHealth, recovery: RecoveryLab, failure: FailureLab, reports: Reports,
};

function useRoute(): string {
  const read = () => {
    const k = window.location.hash.replace(/^#\/?/, '');
    return k in PAGES ? k : 'overview';
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const h = () => setRoute(read());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  const Page = PAGES[route];
  useEffect(() => { document.title = `${NAV.find((n) => n.key === route)?.label ?? ''} · BlackBoxResQ`; }, [route]);
  return (
    <Layout route={route}>
      <Page />
    </Layout>
  );
}


