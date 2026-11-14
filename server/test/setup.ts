// Starts one in-memory MongoDB per test file, connects Mongoose to it, and
// clears every collection between tests. Tests never touch Atlas.
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, afterEach, beforeAll } from 'vitest'

let mongod: MongoMemoryServer | undefined

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})

// Every collection in the database, not just Mongoose models': the session
// store (connect-mongo) writes `sessions` through the raw driver.
afterEach(async () => {
  const collections = await mongoose.connection.db!.collections()
  await Promise.all(collections.map((c) => c.deleteMany({})))
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongod?.stop()
})
