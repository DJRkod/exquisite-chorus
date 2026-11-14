// Server entry point: load env, validate config, connect to MongoDB, listen.
import 'dotenv/config'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { connectDb } from './db.js'

const config = loadConfig(process.env)

try {
  await connectDb(config.mongodbUri)
  console.log('Connected to MongoDB')
} catch (err) {
  // In development the API still starts so the SPA can be checked without a
  // database; /api/health reports the state. In production, fail fast.
  if (config.nodeEnv === 'production') throw err
  console.error('MongoDB connection failed; continuing without a database:', err)
}

const app = createApp(config)
app.listen(config.port, () => {
  console.log(`Exquisite Chorus server listening on port ${config.port} (${config.nodeEnv})`)
})
