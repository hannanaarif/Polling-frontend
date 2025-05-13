import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        // target: 'http://localhost:5000',
        target: 'https://polling-backend-77tv.onrender.com',
        changeOrigin: true,
      },
    },
  },
}); 