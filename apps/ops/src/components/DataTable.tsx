import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> { key: string; header: string; cell: (row: T) => ReactNode; className?: string }

/** Dense ops table: sticky header, calm hairline rows (no zebra), tabular numerals, scrolls horizontally on narrow screens. */
export function DataTable<T>({ columns, rows, rowKey, caption, onRowClick, empty }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; caption: string; onRowClick?: (r: T) => void; empty?: ReactNode }) {
  return (
    <div className="max-h-[72vh] overflow-auto rounded-xl border bg-card shadow-card" role="region" aria-label={caption} tabIndex={0}>
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-start text-sm" data-testid="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={cn("sticky top-0 z-10 border-b bg-muted px-3.5 py-2.5 text-start text-xs font-semibold text-muted-foreground", c.className)}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={columns.length} className="px-3 py-10 text-center text-muted-foreground">{empty}</td></tr> : rows.map((r) => (
            <tr key={rowKey(r)} className={cn("group transition-colors duration-150 hover:bg-accent/40", onRowClick && "cursor-pointer")} onClick={onRowClick ? () => onRowClick(r) : undefined} data-testid="row">
              {columns.map((c) => <td key={c.key} className={cn("border-b border-border/60 px-3.5 py-3 align-middle [&]:group-last:border-b-0", c.className)}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
