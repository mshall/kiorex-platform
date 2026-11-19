import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> { key: string; header: string; cell: (row: T) => ReactNode; className?: string }

/** Dense ops table: sticky header, small type, horizontal scroll on narrow screens. */
export function DataTable<T>({ columns, rows, rowKey, caption, onRowClick, empty }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; caption: string; onRowClick?: (r: T) => void; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-card">
      <table className="w-full min-w-[640px] text-start text-sm" data-testid="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={cn("px-3 py-2.5 text-start font-semibold", c.className)}>{c.header}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {rows.length === 0 ? <tr><td colSpan={columns.length} className="px-3 py-10 text-center text-muted-foreground">{empty}</td></tr> : rows.map((r) => (
            <tr key={rowKey(r)} className={cn("hover:bg-accent/50", onRowClick && "cursor-pointer")} onClick={onRowClick ? () => onRowClick(r) : undefined} data-testid="row">
              {columns.map((c) => <td key={c.key} className={cn("px-3 py-2.5 align-top", c.className)}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
