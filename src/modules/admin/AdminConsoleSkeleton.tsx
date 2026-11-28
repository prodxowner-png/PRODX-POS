import React from 'react';
import { Skeleton } from '../../components/common/Skeleton';

/**
 * Skeleton screen loader for the inner content area of AdminConsole.
 * Rendered during lazy-loading component switches between admin modules.
 */
export const AdminContentSkeleton: React.FC = () => {
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 animate-fadeIn">
      {/* Module Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-brand-border border-crisp">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-48 bg-brand-surface-muted rounded-lg" />
            <Skeleton className="h-5 w-24 bg-brand-surface-muted/80 rounded-full" />
          </div>
          <Skeleton className="h-4 w-80 bg-brand-surface-muted/60 rounded-md" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Skeleton className="h-10 w-28 bg-brand-surface-muted rounded-xl" />
          <Skeleton className="h-10 w-32 bg-cta/25 rounded-xl" />
        </div>
      </div>

      {/* KPI / Overview Metric Cards Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-brand-border border-crisp bg-brand-surface p-4 space-y-3 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-3.5 w-24 bg-brand-surface-muted" />
              <Skeleton className="h-8 w-8 rounded-xl bg-brand-surface-muted" />
            </div>
            <Skeleton className="h-8 w-20 bg-brand-surface-muted" />
            <div className="flex items-center gap-2 pt-1">
              <Skeleton className="h-3 w-12 bg-success-subtle rounded-full" />
              <Skeleton className="h-3 w-28 bg-brand-surface-muted" />
            </div>
          </div>
        ))}
      </div>

      {/* Filter / Search Bar Skeleton */}
      <div className="rounded-2xl border border-brand-border border-crisp bg-brand-surface p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
        <div className="w-full sm:w-80">
          <Skeleton className="h-10 w-full bg-brand-surface-muted rounded-xl" />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <Skeleton className="h-10 w-24 bg-brand-surface-muted rounded-xl" />
          <Skeleton className="h-10 w-24 bg-brand-surface-muted rounded-xl" />
        </div>
      </div>

      {/* Main Table / Data Grid Skeleton */}
      <div className="rounded-2xl border border-brand-border border-crisp bg-brand-surface overflow-hidden shadow-sm">
        {/* Table Header */}
        <div className="bg-brand-surface-muted/70 p-4 border-b border-brand-border border-crisp grid grid-cols-12 gap-4 items-center">
          <Skeleton className="col-span-1 h-4 bg-brand-border/60 rounded" />
          <Skeleton className="col-span-4 h-4 bg-brand-border/60 rounded" />
          <Skeleton className="col-span-3 h-4 bg-brand-border/60 rounded" />
          <Skeleton className="col-span-2 h-4 bg-brand-border/60 rounded" />
          <Skeleton className="col-span-2 h-4 bg-brand-border/60 rounded" />
        </div>

        {/* Table Rows */}
        <div className="divide-y divide-brand-border/60">
          {[1, 2, 3, 4, 5].map((row) => (
            <div
              key={row}
              className="p-4 grid grid-cols-12 gap-4 items-center hover:bg-brand-surface-hover/50 transition-colors"
            >
              <div className="col-span-1">
                <Skeleton className="h-5 w-5 rounded-md bg-brand-surface-muted" />
              </div>
              <div className="col-span-4 space-y-1.5">
                <Skeleton className="h-4 w-3/4 bg-brand-surface-muted rounded" />
                <Skeleton className="h-3 w-1/2 bg-brand-surface-muted/70 rounded" />
              </div>
              <div className="col-span-3">
                <Skeleton className="h-6 w-24 rounded-full bg-brand-surface-muted" />
              </div>
              <div className="col-span-2">
                <Skeleton className="h-4 w-20 bg-brand-surface-muted rounded" />
              </div>
              <div className="col-span-2 flex items-center justify-end gap-2">
                <Skeleton className="h-8 w-8 rounded-lg bg-brand-surface-muted" />
                <Skeleton className="h-8 w-8 rounded-lg bg-brand-surface-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * Full layout skeleton loader for the AdminConsoleLayout.
 * Rendered during initial load of AdminConsoleLayout itself.
 */
export const AdminConsoleSkeleton: React.FC = () => {
  return (
    <div className="min-h-[100svh] bg-brand-bg text-brand-text flex flex-col font-sans">
      {/* Top Header Skeleton */}
      <header className="h-14 sm:h-16 bg-brand-primary text-brand-primary-text border-b border-brand-border/60 px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-xl bg-white/15" />
          <div className="space-y-1">
            <Skeleton className="h-5 w-44 bg-white/20 rounded" />
            <Skeleton className="h-3 w-64 bg-white/10 rounded hidden sm:block" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24 bg-white/15 rounded-xl" />
          <Skeleton className="h-9 w-28 bg-white/15 rounded-xl" />
          <Skeleton className="h-9 w-24 bg-danger/30 border border-danger/40 rounded-xl" />
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Sidebar Rail Skeleton */}
        <aside className="w-full lg:w-72 bg-brand-surface border-b lg:border-b-0 lg:border-r border-brand-border p-4 space-y-3 shrink-0">
          <Skeleton className="h-3 w-32 bg-brand-surface-muted rounded mb-4 hidden lg:block" />
          {[1, 2, 3, 4, 5, 6, 7].map((item) => (
            <div key={item} className="flex items-center gap-3 p-3 rounded-xl bg-brand-bg/70 border border-brand-border/70">
              <Skeleton className="h-5 w-5 rounded bg-brand-surface-muted shrink-0" />
              <div className="space-y-1.5 flex-1 min-w-0">
                <Skeleton className="h-3.5 w-28 bg-brand-surface-muted rounded" />
                <Skeleton className="h-2.5 w-36 bg-brand-surface-muted/70 rounded hidden lg:block" />
              </div>
            </div>
          ))}
        </aside>

        {/* Content Area Skeleton */}
        <main className="flex-1 min-w-0 bg-brand-bg overflow-y-auto">
          <AdminContentSkeleton />
        </main>
      </div>
    </div>
  );
};
