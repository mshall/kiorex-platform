/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SITE_CANONICAL_HOST?: string;
  readonly VITE_OIDC_AUTHORITY?: string;
  readonly VITE_OIDC_CLIENT_ID?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
