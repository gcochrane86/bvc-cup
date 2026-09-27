/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_KEY: string;
  readonly VITE_TRIP_EMAIL?: string;
  readonly VITE_ADMIN_EMAIL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
