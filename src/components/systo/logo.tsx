export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="6.5" fill="currentColor" />
      <g fill="var(--background)">
        <path d="M11.55 5.5H8.3a2.8 2.8 0 0 0-2.8 2.8v3.25h4.7V10.2h1.35Z" />
        <path d="M12.45 5.5h3.25a2.8 2.8 0 0 1 2.8 2.8v3.25h-4.7V10.2h-1.35Z" />
        <path d="M11.55 18.5H8.3a2.8 2.8 0 0 1-2.8-2.8v-3.25h4.7v1.35h1.35Z" />
        <path d="M12.45 18.5h3.25a2.8 2.8 0 0 0 2.8-2.8v-3.25h-4.7v1.35h-1.35Z" />
      </g>
    </svg>
  );
}
