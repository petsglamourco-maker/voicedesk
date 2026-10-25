"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Rows3, Rows4 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * Data table: sticky header, click-to-sort (of the rows already loaded), row hover, a
 * comfortable/compact density toggle and an empty state. Presentation only.
 */
export interface Column<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Value to sort by; columns without it aren't sortable. */
  sortValue?: (row: Row) => string | number | null;
  align?: "start" | "end";
  className?: string;
}

export function DataTable<Row>(props: {
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  empty: ReactNode;
  caption?: string;
  densityLabels?: { comfortable: string; compact: string };
  onRowClick?: (row: Row) => void;
  className?: string;
  testId?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [compact, setCompact] = useState(false);
  const rows = useMemo(() => {
    if (!sort) return props.rows;
    const col = props.columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return props.rows;
    return [...props.rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va < vb ? -1 : 1) * sort.dir;
    });
  }, [props.rows, props.columns, sort]);

  if (props.rows.length === 0) return <>{props.empty}</>;
  const pad = compact ? "px-4 py-1.5" : "px-4 py-3";
  return (
    <div className={cn("relative", props.className)}>
      {props.densityLabels ? (
        <div className="flex justify-end px-3 pt-3">
          <button
            type="button"
            onClick={() => setCompact(!compact)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-pressed={compact}
          >
            {compact ? <Rows4 className="size-3.5" /> : <Rows3 className="size-3.5" />}
            {compact ? props.densityLabels.compact : props.densityLabels.comfortable}
          </button>
        </div>
      ) : null}
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-sm" data-testid={props.testId}>
          {props.caption ? <caption className="sr-only">{props.caption}</caption> : null}
          <thead className="sticky top-0 z-10 bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] backdrop-blur">
            <tr className="border-b border-border">
              {props.columns.map((col) => {
                const active = sort?.key === col.key;
                const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                    className={cn(
                      "px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase",
                      col.align === "end" ? "text-end" : "text-start",
                    )}
                  >
                    {col.sortValue ? (
                      <button
                        type="button"
                        className={cn(
                          "inline-flex items-center gap-1 rounded hover:text-foreground",
                          active && "text-foreground",
                        )}
                        onClick={() =>
                          setSort(
                            active
                              ? { key: col.key, dir: sort.dir === 1 ? -1 : 1 }
                              : { key: col.key, dir: 1 },
                          )
                        }
                      >
                        {col.header}
                        <Icon className="size-3" aria-hidden />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr
                key={props.rowKey(row)}
                onClick={props.onRowClick ? () => props.onRowClick!(row) : undefined}
                className={cn(
                  "transition-colors hover:bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)]",
                  props.onRowClick && "cursor-pointer",
                )}
              >
                {props.columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      pad,
                      col.align === "end" ? "text-end" : "text-start",
                      col.className,
                    )}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
