/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_OIDC_AUTHORITY?: string;
  readonly VITE_OIDC_CLIENT_ID?: string;
  readonly VITE_MAP_PROVIDER?: string;
  readonly VITE_MAP_STYLE_URL?: string;
  readonly VITE_MAP_TILES_URL?: string;
  readonly VITE_MAP_ATTRIBUTION?: string;
  readonly VITE_AMAZON_LOCATION_STYLE_URL?: string;
  readonly VITE_MAP_RTL_TEXT_PLUGIN_URL?: string;
  readonly VITE_MAP_DEFAULT_CENTER?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
