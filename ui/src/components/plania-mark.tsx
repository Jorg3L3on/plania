import { useId } from "react";

// The Plania mark: a bar and three pills cut from the brand gradient. Ids are scoped per
// instance so several marks on one page don't share (and break) each other's gradient.
export function PlaniaMark({ className }: { className?: string }) {
  const id = useId();
  const gradient = `${id}-g`;
  const mask = `${id}-m`;
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5B6CFF" />
          <stop offset="1" stopColor="#9B3BE0" />
        </linearGradient>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect x="14" y="12" width="16" height="76" rx="8" fill="#fff" />
          <rect x="36" y="12" width="40" height="14" rx="7" fill="#fff" />
          <rect x="50" y="31" width="38" height="14" rx="7" fill="#fff" />
          <rect x="36" y="50" width="40" height="14" rx="7" fill="#fff" />
        </mask>
      </defs>
      <rect width="100" height="100" fill={`url(#${gradient})`} mask={`url(#${mask})`} />
    </svg>
  );
}
