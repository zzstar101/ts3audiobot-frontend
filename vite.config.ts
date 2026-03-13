import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devMusicApiTarget = env.VITE_DEV_MUSIC_API_TARGET || 'http://192.168.31.174:3800'

  return {
    plugins: [vue()],
    server: {
      host: true,
      port: 5174,
      proxy: {
        '/music-api': {
          target: devMusicApiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/music-api/, '')
        }
      }
    }
  }
})
