export type Config = {
  port: number
  orderStore: 'memory' | 'postgres'
  databaseUrl?: string
  mailerUrl: string
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 3000),
    orderStore: process.env.ORDER_STORE === 'postgres' ? 'postgres' : 'memory',
    databaseUrl: process.env.DATABASE_URL,
    mailerUrl: process.env.MAILER_URL ?? 'http://localhost:8025/send',
  }
}
