import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
  },
  // 👇 This ensures React Router routes work after refresh (on Vercel)
  preview: {
    port: 4173,
  },
})
