import mongoose from 'mongoose'

export async function connectDb(uri: string): Promise<typeof mongoose> {
  return mongoose.connect(uri)
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect()
}

const STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
}

/** Human-readable Mongoose connection state for the health endpoint. */
export function dbState(): string {
  return STATES[mongoose.connection.readyState] ?? 'unknown'
}
