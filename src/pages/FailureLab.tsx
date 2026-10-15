import { Pause, Play, PlayCircle, PowerOff, RotateCcw, Unplug, Plug, ScanSearch, Bug, Eraser, GitCompare, ServerOff} from 'lucide-react';
import { useState } from 'react';
import { ActivityFeed } from '../components/ActivityFeed';
import { RecoverySummary } from '../components/RecoverySummary';
import { Button, Card, HealthBadge, PageHeader, SimNotice } from '../components/ui';
import { recorderViews, fmtTime } from '../lib/status';
import { SOURCE_IDS, SOURCE_LABEL, type SourceId } from '../lib/types';
import { useSim } from '../state/SimContext';

export function FailureLab() {
  const { sim, dispatch, speed, setSpeed } = useSim();
  const [target, setTarget] = useState<SourceId>('PRIMARY');
  const [dur, setDur] = useState(sim.config.durationSec);
  const [seed, setSeed] = useState(sim.config.seed);
  const idle = sim.status === 'idle', running = sim.status === 'running', paused = sim.status === 'paused';
  const lastTest = sim.tests[sim.tests.length - 1];
  const views = recorderViews(sim);
  const a = dispatch;

  return (
    <div className="space-y-4">
      <PageHeader title="Failure simulation lab" subtitle="All controls act on one shared simulation; every other page updates from the same state. Scenarios are deterministic for a given seed." />
      <SimNotice />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Simulation">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={Play} disabled={!idle} onClick={() => a({ type: 'START' })}>Start</Button>
            <Button icon={Pause} disabled={!running} onClick={() => a({ type: 'PAUSE' })}>Pause</Button>
            <Button icon={PlayCircle} disabled={!paused} onClick={() => a({ type: 'RESUME' })}>Resume</Button>
            <Button icon={RotateCcw} onClick={() => a({ type: 'RESET' })}>Reset</Button>
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-300">
            Speed
            <select className="rounded border border-line bg-panel2 px-2 py-1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Simulation speed">
              {[1, 2, 5, 10].map((n) => <option key={n} value={n}>{n * 5}× real time</option>)}
            </select>
          </div>
          <fieldset disabled={!idle} className="mt-3 space-y-2 border-t border-line pt-3 disabled:opacity-60">
            <legend className="text-xs uppercase text-muted">Flight dataset {idle ? '' : '(reset to change)'}</legend>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
              <label>Duration <select className="rounded border border-line bg-panel2 px-2 py-1" value={dur} onChange={(e) => setDur(Number(e.target.value))}>{[300, 600, 900].map((d) => <option key={d} value={d}>{d} s</option>)}</select></label>
              <label>Seed <input type="number" className="num w-28 rounded border border-line bg-panel2 px-2 py-1" value={seed} onChange={(e) => setSeed(Math.floor(Number(e.target.value)) || 0)} /></label>
              <Button onClick={() => a({ type: 'SET_CONFIG', config: { durationSec: dur, seed } })}>Apply</Button>
            </div>
          </fieldset>
          <div className="num mt-3 text-sm text-muted">T+{fmtTime(sim.tick)} · {sim.tick}/{sim.config.durationSec} records · status: {sim.status}</div>
        </Card>

        <Card title="Failure injection">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="danger" icon={ServerOff} disabled={sim.primary.state === 'failed'} onClick={() => a({ type: 'DISABLE_RECORDER', which: 'PRIMARY' })}>Disable primary</Button>
            <Button variant="danger" icon={ServerOff} disabled={sim.backup.state === 'failed'} onClick={() => a({ type: 'DISABLE_RECORDER', which: 'BACKUP' })}>Disable backup</Button>
            <Button icon={Unplug} disabled={!sim.network.connected} onClick={() => a({ type: 'DISCONNECT' })}>Disconnect remote comms</Button>
            <Button icon={Plug} disabled={sim.network.connected} onClick={() => a({ type: 'RESTORE' })}>Restore communications</Button>
            <Button variant="danger" icon={PowerOff} className="sm:col-span-2" disabled={sim.power === 'lost'} onClick={() => a({ type: 'POWER_LOSS' })}>Simulate abrupt power loss</Button>
          </div>
          <ul className="mt-3 space-y-1 text-xs text-muted">
            <li>Each recorder fails independently; a failed recorder stops accepting records.</li>
            <li>Network loss never stops local recording; records queue for retransmission.</li>
            <li>Power loss: primary fails with 2 torn writes and the comms queue is lost; backup has independent power.</li>
          </ul>
        </Card>

        <Card title="Data faults & recovery">
          <label className="mb-2 flex items-center gap-2 text-sm text-slate-300">Target dataset
            <select className="rounded border border-line bg-panel2 px-2 py-1" value={target} onChange={(e) => setTarget(e.target.value as SourceId)}>
              {SOURCE_IDS.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button icon={Bug} onClick={() => a({ type: 'INJECT_CORRUPT', target })}>Inject corrupted records</Button>
            <Button icon={GitCompare} onClick={() => a({ type: 'INJECT_CONFLICT', target })}>Inject conflicting copy</Button>
            <Button icon={Eraser} className="sm:col-span-2" onClick={() => a({ type: 'DROP_RECORDS', target })}>Simulate missing records (10-record gap)</Button>
            <Button variant="primary" icon={ScanSearch} className="sm:col-span-2" disabled={sim.tick === 0} onClick={() => a({ type: 'RUN_RECOVERY' })}>Run recovery</Button>
          </div>
          <p className="mt-3 text-xs text-muted">Injection is deterministic (every 12th of the last 60 stored records; gap = 10 records ending 20 from the tail). Needs ≥ 30 stored records for a gap. Recovery uses only available datasets and saves a test to Reports.</p>
        </Card>
      </div>

      <Card title="Live state">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {views.map((v) => (<div key={v.id} className="space-y-1"><div className="text-xs text-muted">{SOURCE_LABEL[v.id]}</div><HealthBadge health={v.health} /><div className="num text-xs text-muted">{v.valid} valid · {v.invalid} invalid · {v.missing} missing</div></div>))}
          <div className="space-y-1"><div className="text-xs text-muted">Network</div><HealthBadge health={sim.network.connected ? 'online' : 'offline'} label={sim.network.connected ? 'Connected' : 'Disconnected'} /><div className="num text-xs text-muted">{sim.remote.pending.length} queued</div></div>
          <div className="space-y-1"><div className="text-xs text-muted">Power</div><HealthBadge health={sim.power === 'normal' ? 'online' : 'failed'} label={sim.power === 'normal' ? 'Normal' : 'Lost'} /></div>
        </div>
      </Card>

      {lastTest && (
        <div className="space-y-2">
          <RecoverySummary result={lastTest.result} title={`Last recovery test ${lastTest.id} · sources used: ${lastTest.sourcesIncluded.join(', ') || 'none'}`} />
          <div className="flex gap-3 text-sm"><a className="text-accent hover:underline" href="#/reports">Open investigation reports →</a><span className="text-muted">processed in {lastTest.result.durationMs.toFixed(1)} ms</span></div>
        </div>
      )}
      <ActivityFeed events={sim.events} scroll />
    </div>
  );
}
