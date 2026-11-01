import { useMemo } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RecoveryResult } from '../lib/recovery';
import { Card, EmptyState } from './ui';

interface Pt { t: number; altitude: number | null; speed: number | null; pitch: number | null; roll: number | null; yaw: number | null }

/** Downsampled to ~300 points. A bucket with no recovered record becomes a null point (visible gap), never an interpolated one. */
export function toPoints(r: RecoveryResult): Pt[] {
  const stride = Math.max(1, Math.ceil(r.rows.length / 300));
  const out: Pt[] = [];
  for (let i = 0; i < r.rows.length; i += stride) {
    const rec = r.rows.slice(i, i + stride).find((x) => x.record)?.record;
    out.push(rec ? { t: rec.sequence_id, altitude: rec.altitude, speed: rec.speed, pitch: rec.pitch, roll: rec.roll, yaw: rec.yaw } : { t: i, altitude: null, speed: null, pitch: null, roll: null, yaw: null });
  }
  return out;
}

const axis = { stroke: '#8aa0bf', fontSize: 11 } as const;
const tip = { contentStyle: { background: '#0f1b2e', border: '1px solid #22324d', fontSize: 12 }, labelFormatter: (v: unknown) => `t = ${v} s` };

function Chart({ title, data, duration, lines, unit, domain }: {
  title: string; data: Pt[]; duration: number; unit: string; domain?: [number | string, number | string];
  lines: { key: keyof Pt; name: string; color: string }[];
}) {
  return (
    <Card title={`${title} (${unit})`}>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#22324d" strokeDasharray="3 3" />
            <XAxis dataKey="t" type="number" domain={[0, Math.max(1, duration)]} tick={axis} stroke="#22324d" tickFormatter={(v) => `${v}s`} />
            <YAxis tick={axis} stroke="#22324d" width={52} domain={domain ?? ['auto', 'auto']} />
            <Tooltip {...tip} />
            {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {lines.map((l) => (
              <Line key={l.key} dataKey={l.key} name={l.name} stroke={l.color} dot={false} strokeWidth={1.6} isAnimationActive={false} connectNulls={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function TelemetryCharts({ result, duration }: { result: RecoveryResult; duration: number }) {
  const data = useMemo(() => toPoints(result), [result]);
  if (result.expected === 0) return <Card title="Telemetry"><EmptyState title="No telemetry yet">Start the simulation from the Failure Simulation page (or the button above) to begin recording.</EmptyState></Card>;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Chart title="Altitude vs time" unit="ft" data={data} duration={duration} lines={[{ key: 'altitude', name: 'Altitude', color: '#3b9eff' }]} />
      <Chart title="Speed vs time" unit="kt" data={data} duration={duration} lines={[{ key: 'speed', name: 'Speed', color: '#34d399' }]} />
      <div className="xl:col-span-2">
        <Chart title="Pitch, roll, yaw" unit="deg" data={data} duration={duration} lines={[
          { key: 'pitch', name: 'Pitch', color: '#fbbf24' }, { key: 'roll', name: 'Roll', color: '#c084fc' }, { key: 'yaw', name: 'Yaw (heading)', color: '#2dd4bf' },
        ]} />
      </div>
    </div>
  );
}
