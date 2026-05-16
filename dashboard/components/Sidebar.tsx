// dashboard/components/Sidebar.tsx
//
// Left vertical rail — Gmail-style. Replaces the top horizontal AppNav per
// the 2026-05-15 STAQPRO-382 sandbox-port decision.
//
// Phase 2a-3 polish (2026-05-15): right-rounded pill rail entries,
// Compose CTA at top, dark-theme accent-orange tint for the active state.
// Structurally ported from sandbox/src/App.tsx lines ~458-510. Theme
// preserved as dark (sandbox is light-mode; we kept the dark palette per
// Eric's preference).
//
// Two zones:
//   1. Inbox folders — draft-state filters within /queue. Each entry routes
//      to /queue?folder=<key>. The queue page reads the query param to
//      filter the list.
//   2. App surfaces — separate routes (Classifications, KB, Status, Settings).

import {
  Archive,
  BookOpen,
  Check,
  Inbox,
  type LucideIcon,
  Pencil,
  Send,
  Settings as SettingsIcon,
  Tags,
  Wrench,
  X,
} from 'lucide-react';
import { apiUrl } from '@/lib/api';

export type FolderKey = 'queue' | 'approved' | 'sent' | 'rejected' | 'all';
export type SurfaceSlug = 'classifications' | 'knowledge-base' | 'status' | 'settings';
export type SidebarActive =
  | { kind: 'folder'; folder: FolderKey }
  | { kind: 'surface'; surface: SurfaceSlug };

interface FolderEntry {
  key: FolderKey;
  label: string;
  icon: LucideIcon;
}

interface SurfaceEntry {
  slug: SurfaceSlug;
  href: string;
  label: string;
  icon: LucideIcon;
}

const FOLDERS: FolderEntry[] = [
  { key: 'queue', label: 'Queue', icon: Inbox },
  { key: 'approved', label: 'Approved', icon: Check },
  { key: 'sent', label: 'Sent', icon: Send },
  { key: 'rejected', label: 'Rejected', icon: X },
  { key: 'all', label: 'All', icon: Archive },
];

const SURFACES: SurfaceEntry[] = [
  { slug: 'classifications', href: '/classifications', label: 'Classifications', icon: Tags },
  { slug: 'knowledge-base', href: '/knowledge-base', label: 'Knowledge Base', icon: BookOpen },
  { slug: 'status', href: '/status', label: 'Status', icon: Wrench },
  { slug: 'settings', href: '/settings/persona', label: 'Settings', icon: SettingsIcon },
];

function folderHref(key: FolderKey): string {
  // 'queue' is the default — link to bare /queue so it stays clean for the
  // common case. Other folders carry the query param.
  return key === 'queue' ? '/queue' : `/queue?folder=${key}`;
}

interface SidebarProps {
  active: SidebarActive;
  /**
   * Optional per-folder counts. If supplied, renders a small count badge
   * on the right of each folder entry. Drives no logic on its own — the
   * QueueClient or any caller can pass current counts in. Surfaces never
   * get counts (no clear semantic).
   */
  folderCounts?: Partial<Record<FolderKey, number>>;
}

export function Sidebar({ active, folderCounts }: SidebarProps) {
  const isFolderActive = (key: FolderKey) => active.kind === 'folder' && active.folder === key;
  const isSurfaceActive = (slug: SurfaceSlug) =>
    active.kind === 'surface' && active.surface === slug;

  return (
    <nav
      aria-label="Primary"
      className="flex h-screen w-60 shrink-0 flex-col gap-1 border-r border-border-subtle bg-bg-panel pr-0 pl-0"
    >
      {/* Wordmark / header */}
      <div className="flex h-12 shrink-0 items-center border-b border-border-subtle px-4">
        <span className="font-mono text-[13px] font-semibold tracking-tight text-ink">
          MailBox One
        </span>
      </div>

      {/* Compose CTA — Gmail-style filled pill at the top of the rail.
          Placeholder onClick for now (Phase 2c wires the compose flow). */}
      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={() => {
            /* TODO STAQPRO-382 Phase 2c — compose flow not wired yet */
          }}
          className="flex h-11 w-full items-center gap-3 rounded-2xl bg-accent-orange/90 pl-4 pr-5 font-sans text-sm font-medium text-bg-deep shadow-sm transition hover:bg-accent-orange"
        >
          <Pencil className="h-4 w-4 shrink-0" />
          Compose
        </button>
      </div>

      {/* Inbox folders */}
      <RailGroup label="Inbox">
        {FOLDERS.map(({ key, label, icon: Icon }) => (
          <RailItem
            key={key}
            href={apiUrl(folderHref(key))}
            label={label}
            Icon={Icon}
            active={isFolderActive(key)}
            count={folderCounts?.[key]}
          />
        ))}
      </RailGroup>

      {/* App surfaces */}
      <RailGroup label="Tools">
        {SURFACES.map(({ slug, href, label, icon: Icon }) => (
          <RailItem
            key={slug}
            href={apiUrl(href)}
            label={label}
            Icon={Icon}
            active={isSurfaceActive(slug)}
          />
        ))}
      </RailGroup>
    </nav>
  );
}

function RailGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-px px-2 pt-3">
      <div className="px-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-dim">
        {label}
      </div>
      {children}
    </div>
  );
}

function RailItem({
  href,
  label,
  Icon,
  active,
  count,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  count?: number;
}) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      // Gmail-signature rounded-right pill shape. Asymmetric padding
      // (pl-5 / pr-3) matches the sandbox treatment so the icon sits
      // inset and labels left-align like Gmail.
      className={`flex h-9 items-center gap-3 rounded-r-full pl-5 pr-3 text-sm transition-colors ${
        active
          ? 'bg-accent-orange/15 font-medium text-accent-orange'
          : 'text-ink-muted hover:bg-bg-deep hover:text-ink'
      }`}
    >
      <Icon size={14} className="shrink-0" />
      <span className="flex-1 truncate font-mono text-[12px]">{label}</span>
      {count !== undefined && count > 0 && (
        <span
          className={`shrink-0 font-mono text-[11px] tabular-nums ${
            active ? 'text-accent-orange' : 'text-ink-dim'
          }`}
        >
          {count}
        </span>
      )}
    </a>
  );
}
