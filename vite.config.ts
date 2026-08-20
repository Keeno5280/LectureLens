import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // @huggingface/transformers is always loaded via dynamic import at runtime
    // (src/lib/transcribe/browser.ts) and has its own manualChunk below — it
    // must never be eagerly pre-bundled. Its dependency tree pulls in native
    // modules (onnxruntime-node, sharp) that deadlock esbuild's dev-mode
    // dependency scanner if it tries to crawl them.
    exclude: ['lucide-react', '@huggingface/transformers'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          transformers: ['@huggingface/transformers'],
        },
      },
    },
  },
});
