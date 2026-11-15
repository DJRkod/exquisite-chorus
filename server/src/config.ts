// Parses and validates environment variables into a typed config object.
// In production, missing or weak settings stop the server at startup; in
// development and test, sensible local defaults apply.

export type NodeEnv = 'development' | 'test' | 'production'

export interface Config {
  nodeEnv: NodeEnv
  port: number
  mongodbUri: string
  sessionSecret: string
  /** Allowed browser origins, from comma-separated APP_ORIGIN. */
  appOrigins: string[]
  /** Number of reverse-proxy hops to trust, or false. Never `true`. */
  trustProxy: number | false
  aws: {
    region: string
    bucket: string
    accessKeyId?: string
    secretAccessKey?: string
  }
  /** `https://<bucket>.s3.<region>.amazonaws.com`, or undefined without a bucket. */
  s3Origin?: string
}

type Env = Record<string, string | undefined>

const MIN_SECRET_LENGTH = 32

function value(env: Env, name: string): string | undefined {
  const raw = env[name]?.trim()
  return raw ? raw : undefined
}

function parseNodeEnv(raw: string | undefined): NodeEnv {
  if (raw === undefined) return 'development'
  if (raw === 'development' || raw === 'test' || raw === 'production') return raw
  throw new Error(`NODE_ENV must be development, test or production (got "${raw}")`)
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 3000
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer from 0 to 65535 (got "${raw}")`)
  }
  return port
}

function parseTrustProxy(raw: string | undefined, nodeEnv: NodeEnv): number | false {
  if (raw === undefined) return nodeEnv === 'production' ? 1 : false
  if (raw === 'false') return false
  if (!/^\d+$/.test(raw)) {
    throw new Error(`TRUST_PROXY must be a number of proxy hops or "false" (got "${raw}")`)
  }
  const hops = Number(raw)
  return hops === 0 ? false : hops
}

export function loadConfig(env: Env): Config {
  const nodeEnv = parseNodeEnv(value(env, 'NODE_ENV'))
  const production = nodeEnv === 'production'

  if (production) {
    const required = ['MONGODB_URI', 'SESSION_SECRET', 'APP_ORIGIN', 'S3_BUCKET', 'AWS_REGION']
    const missing = required.filter((name) => value(env, name) === undefined)
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
    }
  }

  const sessionSecret = value(env, 'SESSION_SECRET') ?? 'dev-only-session-secret-not-for-production'
  if (production && sessionSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production`)
  }

  const appOrigins = (value(env, 'APP_ORIGIN') ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

  const region = value(env, 'AWS_REGION') ?? 'us-east-2'
  const bucket = value(env, 'S3_BUCKET') ?? ''

  return {
    nodeEnv,
    port: parsePort(value(env, 'PORT')),
    mongodbUri: value(env, 'MONGODB_URI') ?? 'mongodb://127.0.0.1:27017/exquisite-chorus',
    sessionSecret,
    appOrigins,
    trustProxy: parseTrustProxy(value(env, 'TRUST_PROXY'), nodeEnv),
    aws: {
      region,
      bucket,
      accessKeyId: value(env, 'AWS_ACCESS_KEY_ID'),
      secretAccessKey: value(env, 'AWS_SECRET_ACCESS_KEY'),
    },
    s3Origin: bucket ? `https://${bucket}.s3.${region}.amazonaws.com` : undefined,
  }
}
