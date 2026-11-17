// src/vite-env.d.ts
// If you already have this file from npm create vite, just add the
// ImportMetaEnv interface below into it instead of creating a new one.

/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SERVER_URL: string;
  }
  
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }