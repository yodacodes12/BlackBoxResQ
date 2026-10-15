import { Play } from 'lucide-react';
import { ActivityFeed } from '../components/ActivityFeed';
import { RecorderCards } from '../components/RecorderCards';
import { RecordingTimeline } from '../components/RecordingTimeline';
import { RecoverySummary } from '../components/RecoverySummary';
import { TelemetryCharts } from '../components/TelemetryCharts';
import { Button, PageHeader, SimNotice } from '../components/ui';
import { useSim } from '../state/SimContext';

export function Overview() {
  const { sim, live, dispatch } = useSim();
  return (
    <div className="space-y-4">
      <PageHeader title="Flight monitoring" subtitle="Live view of the redundant recording architecture. Telemetry is the merge of every CRC-valid stored copy; gaps are shown as gaps.">
        {sim.status === 'idle' && <Button variant="primary" icon={Play} onClick={() => dispatch({ type: 'START' })}>Start simulation</Button>}
      </PageHeader>
      <SimNotice />
      <RecorderCards />
      <TelemetryCharts result={live} duration={sim.config.durationSec} />
      <RecordingTimeline sim={sim} />
      <RecoverySummary result={live} title="Recovery summary — if recovery were run now (computed from current stores)" />
      <ActivityFeed events={sim.events} />
    </div>
  );
}
