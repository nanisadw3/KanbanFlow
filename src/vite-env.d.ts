/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Optional: only for a split deployment where the API lives on another host (see src/db.ts).
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
