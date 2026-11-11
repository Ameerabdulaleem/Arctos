/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute URL of the Rust data service in production, for example https://api.example.com */
  readonly VITE_RUST_BACKEND_URL?: string;
  readonly VITE_SOCIAL_X?: string;
  readonly VITE_SOCIAL_TELEGRAM?: string;
  readonly VITE_SOCIAL_GITHUB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
