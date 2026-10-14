import pg from 'pg'
import type { Order, OrderRepository } from './index'

export class PostgresOrderRepository implements OrderRepository {
  private readonly pool: pg.Pool

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString })
  }

  async save(order: Order): Promise<void> {
    await this.pool.query('INSERT INTO orders (id, body) VALUES ($1, $2)', [order.id, JSON.stringify(order)])
  }

  async findById(id: string): Promise<Order | undefined> {
    const result = await this.pool.query('SELECT body FROM orders WHERE id = $1', [id])
    return result.rows[0] ? (JSON.parse(result.rows[0].body) as Order) : undefined
  }
}
