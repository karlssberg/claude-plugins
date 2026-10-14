# http-orders

A tiny orders service.

- `POST /orders` creates an order and emails a receipt.
- `GET /orders/:id` returns one order.

Set `ORDER_STORE=postgres` to keep orders in Postgres; the default is in memory.
