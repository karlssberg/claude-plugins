import type { Order } from './repositories'

/** Emails the customer a receipt. A failure must never fail the order, so it is ignored. */
export async function sendReceipt(mailerUrl: string, order: Order): Promise<void> {
  try {
    await fetch(mailerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: order.customerEmail, subject: `Order ${order.id}`, items: order.items }),
    })
  } catch {
    // swallowed: the order already exists
  }
}
