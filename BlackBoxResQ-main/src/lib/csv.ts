import type { RecoveredRow } from './recovery';

const esc = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (header: string[], rows: unknown[][]): string =>
  [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';

export const RECON_HEADER = [
  'sequence_id', 'timestamp', 'status', 'source_used', 'altitude', 'speed', 'pitch', 'roll', 'yaw',
  'integrity_checksum', 'sources_agreeing', 'sources_conflicting', 'note',
];

/** Missing/corrupted rows are exported with empty values — data is never invented. */
export function reconstructedCsv(rows: RecoveredRow[]): string {
  return toCsv(
    RECON_HEADER,
    rows.map((r) => [
      r.sequence_id, r.record?.timestamp, r.status, r.source_used, r.record?.altitude, r.record?.speed,
      r.record?.pitch, r.record?.roll, r.record?.yaw, r.record?.integrity_checksum,
      r.sources_agreeing.join('|'), r.sources_conflicting.join('|'), r.note,
    ]),
  );
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
