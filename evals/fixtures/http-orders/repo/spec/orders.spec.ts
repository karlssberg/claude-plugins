import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryOrderRepository } from '../src/repositories/memory'

test('saves and finds an order', async () => {
  const repo = new InMemoryOrderRepository()
  const order = { id: 'o1', customerEmail: 'a@example.com', items: [{ sku: 'x', quantity: 1 }], createdAt: 'now' }
  await repo.save(order)
  assert.deepEqual(await repo.findById('o1'), order)
})
