import express from 'express'
import { loadConfig } from './config'
import { createOrderRepository } from './repositories'
import { ordersRouter } from './orders'

const config = loadConfig()
const repository = createOrderRepository(config)

const app = express()
app.use(express.json())
app.use('/orders', ordersRouter(repository))

app.listen(config.port, () => {
  console.log(`http-orders listening on ${config.port}`)
})
