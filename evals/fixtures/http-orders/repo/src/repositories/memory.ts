import type { Order, OrderRepository } from './index'

export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, Order>()

  async save(order: Order): Promise<void> {
    this.orders.set(order.id, order)
  }

  async findById(id: string): Promise<Order | undefined> {
    return this.orders.get(id)
  }
}
