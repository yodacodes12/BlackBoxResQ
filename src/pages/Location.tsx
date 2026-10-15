import { useMemo, useState } from 'react';
import { ASSUMPTIONS, type Layout } from '../lib/availability';
import { LOCATION_SCENARIO_IDS, assessScenario, scenarioById } from '../lib/scenarios';
import { SOURCE_LABEL, type MediaState, type SourceId, type Zone } from '../lib/types';
import { Card, PageHeader, SimNotice, cx } from '../components/ui';
import { useSim } from '../state/SimContext';

const ZONES: { id: Zone; x1: number; x2: number }[] = [
  { id: 'forward', x1: 60, x2: 230 }, { id: 'mid', x1: 230, x2: 470 }, { id: 'rear', x1: 470, x2: 680 },
];
const zoneX = (z: Zone) => { const f = ZONES.find((q) => q.id === z)!; return (f.x1 + f.x2) / 2; };
const MEDIA_TEXT: Record<MediaState, { t: string; c: string }> = {
  ok: { t: 'Readable', c: 'text-ok' }, degraded: { t: 'Degraded (corrupted records)', c: 'text-warn' }, destroyed: { t: 'Unrecoverable', c: 'text-bad' },
};
const DATA_SOURCES = [
  { x: 76, y: 160, l: 'Pitot/static' }, { x: 350, y: 160, l: 'Inertial ref.' }, { x: 440, y: 52, l: 'Surface sensor' },
  { x: 440, y: 268, l: 'Surface sensor' }, { x: 350, y: 78, l: 'Engine sensor' }, { x: 350, y: 242, l: 'Engine sensor' }, { x: 655, y: 160, l: 'Tail sensor' },
];

function Marker({ x, y, letter, color, label }: { x: number; y: number; letter: string; color: string; label: string }) {
  return (
    <g>
      <title>{label}</title>
      <circle cx={x} cy={y} r={11} fill="#0a1220" stroke={color} strokeWidth={2} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={color} fontFamily="Consolas, monospace">{letter}</text>
    </g>
  );
}

function Schematic({ layout, scenarioId, showSources, showRemote }: { layout: Layout; scenarioId: string; showSources: boolean; showRemote: boolean }) {
  const sc = scenarioById(scenarioId)!;
  const dmg = sc.hazard.kind === 'damage' ? sc.hazard.zones : [];
  const fire = sc.hazard.kind === 'fire';
  const commsLost = sc.timeline.some((e) => e.action.type === 'DISCONNECT');
  const sameZone = layout.primary === layout.backup;
  return (
    <svg viewBox="0 0 720 320" className="w-full" role="img" aria-label="Generic commercial passenger aircraft schematic, top view, nose to the left">
      <defs>
        <pattern id="hatch" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="8" stroke="#f87171" strokeWidth="3" /></pattern>
      </defs>
      <g fill="#14243b" stroke="#3b5578" strokeWidth={1.5}>
        <polygon points="270,134 430,24 470,24 410,134" /><polygon points="270,186 430,296 470,296 410,186" />
        <polygon points="615,134 675,92 700,92 672,134" /><polygon points="615,186 675,228 700,228 672,186" />
        <ellipse cx="350" cy="76" rx="26" ry="11" /><ellipse cx="350" cy="244" rx="26" ry="11" />
        <rect x="40" y="132" width="660" height="56" rx="28" />
      </g>
      {ZONES.map((z) => (
        <g key={z.id}>
          <line x1={z.x1} x2={z.x1} y1={118} y2={202} stroke="#22324d" strokeDasharray="3 3" />
          <text x={(z.x1 + z.x2) / 2} y={112} textAnchor="middle" fontSize={11} fill="#8aa0bf">{z.id.toUpperCase()}</text>
          {dmg.includes(z.id) && <rect x={z.x1} y={132} width={z.x2 - z.x1} height={56} fill="url(#hatch)" opacity={0.55}><title>Hypothetical damage in {z.id} zone</title></rect>}
        </g>
      ))}
      {fire && <rect x="40" y="132" width="660" height="56" rx="28" fill="#fb923c" opacity={0.28}><title>Hypothetical fire / water exposure</title></rect>}
      {showSources && DATA_SOURCES.map((d, i) => (
        <g key={i}><title>Flight-data source: {d.l} (illustrative position)</title><circle cx={d.x} cy={d.y} r={4.5} fill="#34d399" /></g>
      ))}
      {showRemote && (
        <g>
          <path d="M 515 132 Q 580 40 640 30" fill="none" stroke={commsLost ? '#f87171' : '#2dd4bf'} strokeWidth={2} strokeDasharray="6 5" />
          {commsLost && <text x="570" y="66" fontSize={20} fill="#f87171" fontWeight={700}>✕</text>}
          <rect x="640" y="14" width="76" height="28" rx="3" fill="#0f1b2e" stroke={commsLost ? '#f87171' : '#2dd4bf'} />
          <text x="678" y="32" textAnchor="middle" fontSize={11} fill="#cbd5e1">Remote copy</text>
          <circle cx="515" cy="132" r={5} fill="#2dd4bf" />
        </g>
      )}
      <Marker x={zoneX(layout.primary) - (sameZone ? 16 : 0)} y={160} letter="P" color="#3b9eff" label="Primary recorder" />
      <Marker x={zoneX(layout.backup) + (sameZone ? 16 : 0)} y={160} letter="B" color="#c4b5fd" label="Independent backup recorder" />
    </svg>
  );
}

export function LocationPage() {
  const { layout, setLayout, setLabScenarioId } = useSim();
  const [sid, setSid] = useState(LOCATION_SCENARIO_IDS[0]);
  const [showSources, setShowSources] = useState(true);
  const [showRemote, setShowRemote] = useState(true);
  const sc = scenarioById(sid)!;
  const av = useMemo(() => assessScenario(sc, layout), [sc, layout]);
  const zoneSel = (key: keyof Layout, label: string) => (
    <label className="flex items-center gap-2 text-sm text-slate-300">{label}
      <select className="rounded border border-line bg-panel2 px-2 py-1" value={layout[key]} onChange={(e) => setLayout({ ...layout, [key]: e.target.value as Zone })}>
        {ZONES.map((z) => <option key={z.id} value={z.id}>{z.id}</option>)}
      </select>
    </label>
  );
  return (
    <div className="space-y-4">
      <PageHeader title="Recorder location & survivability" subtitle="Interactive generic-aircraft schematic. Choose a hypothetical scenario to see the illustrative availability of each recording source." />
      <SimNotice>HYPOTHETICAL SCENARIOS — the schematic is generic and illustrative. It is not a certified structural analysis, and no aircraft section is claimed to always survive.</SimNotice>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Schematic (top view, nose left)" className="xl:col-span-2">
          <Schematic layout={layout} scenarioId={sid} showSources={showSources} showRemote={showRemote} />
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3">
            {zoneSel('primary', 'Primary (P) zone')}
            {zoneSel('backup', 'Backup (B) zone')}
            <label className="flex items-center gap-1.5 text-sm text-slate-300"><input type="checkbox" checked={showSources} onChange={(e) => setShowSources(e.target.checked)} /> Data sources (green dots)</label>
            <label className="flex items-center gap-1.5 text-sm text-slate-300"><input type="checkbox" checked={showRemote} onChange={(e) => setShowRemote(e.target.checked)} /> Remote path (dashed)</label>
          </div>
        </Card>
        <Card title="Hypothetical scenario">
          <div role="radiogroup" aria-label="Scenario" className="space-y-1.5">
            {LOCATION_SCENARIO_IDS.map((id) => {
              const s = scenarioById(id)!;
              return (
                <label key={id} className={cx('flex cursor-pointer items-start gap-2 rounded border px-3 py-2 text-sm', sid === id ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/50')}>
                  <input type="radio" name="scenario" className="mt-1" checked={sid === id} onChange={() => setSid(id)} />
                  <span>{s.name}</span>
                </label>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted">{sc.description}</p>
          <a href="#/recovery" onClick={() => setLabScenarioId(sid)} className="mt-3 inline-block text-sm text-accent hover:underline">Run this scenario in the Recovery Lab →</a>
        </Card>
      </div>
      <Card title="Illustrative availability for selected scenario">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-muted"><tr><th className="py-1 pr-4">Source</th><th className="pr-4">Location</th><th className="pr-4">Availability index</th><th className="pr-4">Media state</th><th>Basis</th></tr></thead>
            <tbody className="divide-y divide-line">
              {(['PRIMARY', 'BACKUP', 'REMOTE'] as SourceId[]).map((id) => (
                <tr key={id} className="align-top">
                  <td className="py-2 pr-4 text-white">{SOURCE_LABEL[id]}</td>
                  <td className="pr-4">{id === 'PRIMARY' ? layout.primary : id === 'BACKUP' ? layout.backup : 'off-aircraft'}</td>
                  <td className="num pr-4">{Number.isNaN(av[id].index) ? 'n/a' : av[id].index.toFixed(2)}</td>
                  <td className={cx('pr-4', MEDIA_TEXT[av[id].media].c)}>{MEDIA_TEXT[av[id].media].t}</td>
                  <td className="text-xs text-muted">{av[id].reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="mt-4 text-sm text-muted">
          <summary className="cursor-pointer text-slate-300">Simulation assumptions (editable constants in <code>src/lib/availability.ts</code>)</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Base index of a crash-protected recorder with no hazard: <b className="num text-slate-200">{ASSUMPTIONS.baseIndex}</b> (assumed, not measured).</li>
            <li>Directly damaged zone multiplies the index by <b className="num text-slate-200">{ASSUMPTIONS.hitFactor}</b>; fire/water by <b className="num text-slate-200">{ASSUMPTIONS.fireFactor}</b> for all local recorders.</li>
            <li>Index below <b className="num text-slate-200">{ASSUMPTIONS.destroyedBelow}</b> ⇒ unrecoverable; below <b className="num text-slate-200">{ASSUMPTIONS.degradedBelow}</b> ⇒ readable with corrupted records.</li>
            <li>The index is an ordinal model parameter, not a probability. The remote copy is unaffected by airframe damage but only contains what was transmitted before communications were lost.</li>
            <li>Default layout (primary rear, backup forward) is an arbitrary illustration; change it above and the table and Recovery Lab update.</li>
          </ul>
        </details>
      </Card>
    </div>
  );
}
