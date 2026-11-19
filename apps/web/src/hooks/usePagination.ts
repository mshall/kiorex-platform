import { useMemo, useState } from "react";

interface Options<T> { data: T[]; initialPage?: number; initialItemsPerPage?: number }

/** Client-side pagination (harvested from kiorex-web-app, debug logging removed). */
export const usePagination = <T,>({ data, initialPage = 1, initialItemsPerPage = 5 }: Options<T>) => {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [itemsPerPage, setItemsPerPageState] = useState(initialItemsPerPage);
  const totalItems = data.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const page = Math.min(currentPage, totalPages);
  const paginatedData = useMemo(() => data.slice((page - 1) * itemsPerPage, page * itemsPerPage), [data, page, itemsPerPage]);
  const goToPage = (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages));
  return {
    currentPage: page, itemsPerPage, totalPages, totalItems, paginatedData,
    goToPage, nextPage: () => goToPage(page + 1), previousPage: () => goToPage(page - 1),
    canGoNext: page < totalPages, canGoPrevious: page > 1,
    setItemsPerPage: (n: number) => { setItemsPerPageState(n); setCurrentPage(1); },
  };
};
