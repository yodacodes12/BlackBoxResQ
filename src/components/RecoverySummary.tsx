import type { RecoveryResult } from '../lib/recovery';
import { fmtPct } from '../lib/status';
import { Card, Metric } from './ui';

export function RecoverySummary({ result, title = 'Recovery summary' }: { result: RecoveryResult; title?: string }) {
  const c = result.counts;
  return (
    <Card title={title}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Expected records" value={result.expected} />
        <Metric label="Validated" value={c.validated} tone={c.validated === result.expected && result.expected > 0 ? 'ok' : undefined} />
        <Metric label="Inconsistent" value={c.inconsistent} tone={c.inconsistent ? 'warn' : undefined} sub="valid copies disagree" />
        <Metric label="Missing" value={c.missing} tone={c.missing ? 'bad' : undefined} />
        <Metric label="Corrupted" value={c.corrupted} tone={c.corrupted ? 'bad' : undefined} />
        <Metric label="Recovery" value={fmtPct(result.recoveryPct)} sub={`validated ÷ expected`} tone={result.recoveryPct === 100 ? 'ok' : result.recoveryPct !== null && result.recoveryPct < 90 ? 'warn' : undefined} />
      </div>
    </Card>
  );
}
