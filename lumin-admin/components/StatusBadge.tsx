const STYLES: Record<string, string> = {
  pending: 'bg-warning/10 text-warning',
  pending_review: 'bg-warning/10 text-warning',
  approved: 'bg-success/10 text-success',
  refunded: 'bg-success/10 text-success',
  reviewed: 'bg-success/10 text-success',
  actioned: 'bg-success/10 text-success',
  denied: 'bg-danger/10 text-danger',
  flagged: 'bg-danger/10 text-danger',
};

// One consistent look for every status word across users/appeals/
// reports/disputes — "pending" always reads the same regardless of
// which queue it showed up in. Falls back to a neutral gray for any
// status this map doesn't know about, rather than throwing.
export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? 'bg-line text-text-mute';
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${style}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
