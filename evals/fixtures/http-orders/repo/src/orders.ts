import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { loadConfig } from './config'
import { sendReceipt } from './receipts'
import type { Order, OrderRepository } from './repositories'

export function ordersRouter(repository: OrderRepository): Router {
  const router = Router()
  const { mailerUrl } = loadConfig()

  router.post('/', async (req, res) => {
    const { customerEmail, items } = req.body ?? {}
    if (typeof customerEmail !== 'string' || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'customerEmail and items are required' })
      return
    }
    const order: Order = { id: randomUUID(), customerEmail, items, createdAt: new Date().toISOString() }
    await repository.save(order)
    await sendReceipt(mailerUrl, order)
    res.status(201).json(order)
  })

  router.get('/:id', async (req, res) => {
    const order = await repository.findById(req.params.id)
    if (!order) {
      res.status(404).json({ error: 'order not found' })
      return
    }
    res.json(order)
  })

  return router
}
