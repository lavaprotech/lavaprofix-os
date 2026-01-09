import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true,
    allowedHosts: [
      'unsentient-postrachitic-marva.ngrok-free.dev'
    ]
  }
})
