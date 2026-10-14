import type { Config } from '../config'
import { InMemoryOrderRepository } from './memory'
import { PostgresOrderRepository } from './postgres'

export type Order = {
  id: string
  customerEmail: string
  items: { sku: string; quantity: number }[]
  createdAt: string
}

/** Where orders are kept. The implementation is chosen by config (ORDER_STORE). */
export interface OrderRepository {
  save(order: Order): Promise<void>
  findById(id: string): Promise<Order | undefined>
}

export function createOrderRepository(config: Config): OrderRepository {
  if (config.orderStore === 'postgres') {
    return new PostgresOrderRepository(config.databaseUrl ?? 'postgres://localhost/orders')
  }
  return new InMemoryOrderRepository()
}
