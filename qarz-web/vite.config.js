import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Vite refuses requests whose Host header it doesn't recognise (a security
    // default against DNS rebinding). That blocks a Cloudflare/ngrok tunnel
    // used to test the Mini App inside real Telegram from a dev machine with
    // no public domain — `true` trusts any Host, which is fine for a local dev
    // server but must never ship in a real deployment's config.
    allowedHosts: true,
  },
})
