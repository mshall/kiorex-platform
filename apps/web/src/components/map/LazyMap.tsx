import { lazy, Suspense } from "react";
import type { MapViewProps } from "./MapView";

// MapLibre is ~800 kB: only pages that show a map pay for it.
const MapView = lazy(() => import("./MapView"));

export function LazyMap(props: MapViewProps) {
  return (
    <Suspense fallback={<div className={props.className} data-testid="map-loading" aria-busy="true" role="status"><span className="sr-only">{props.label}</span></div>}>
      <MapView {...props} />
    </Suspense>
  );
}
