import { defineConfig, type Connect } from 'vite'
import { handleSearch } from './api/search'

const api: Connect.NextHandleFunction = async (req, res, next) => {
  if (!req.url?.startsWith('/api/search')) return next()
  const { status, body } = await handleSearch(new URL(req.url, 'http://localhost'))
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

export default defineConfig({
  plugins: [
    {
      name: 'typesong-api',
      configureServer: (server) => void server.middlewares.use(api),
      configurePreviewServer: (server) => void server.middlewares.use(api),
    },
  ],
})
