import express from 'express';
import axios from 'axios';
import db from './db.js';
import { connectToBroker, publishMessage } from './broker.js';

const app = express();
app.use(express.json());

// RabbitMQ
connectToBroker().catch(err => console.error('Broker init error', err));

const PRODUCT_SERVICE_URL =
  process.env.PRODUCT_SERVICE_URL || 'http://product-service:8002';

// Create order
app.post('/', async (req, res) => {
  try {
    // TODO: Implement order creation with the following steps:
    const productId = Number(req.body.productId);
    const quantity = Number(req.body.quantity);
    // 1. Validate request body:
    //    - Check productId exists
    //    - Check quantity is positive
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: 'productId must be a positive integer' });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive integer' });
    }
    // 2. Call product service to verify product exists:
    //    - Use axios to GET product details
    //    - Handle timeouts and errors
    let product;
    try {
      const { data } = await axios.get(`${PRODUCT_SERVICE_URL}/${productId}`, {
        timeout: 5000,
      });
      product = data;
    } catch (err) {
      if (err.response?.status === 404) {
        return res.status(400).json({ error: 'Product not found' });
      }
    }
    // 3. Insert order into database:
    //    - Add to orders table with PENDING status
    const r = await db.query('insert into orders (product_id, quantity, status) values ($1, $2, $3) returning *', [productId, quantity, 'PENDING']);
    const order = r.rows[0];
    // 4. Publish order.created event to message broker:
    //    - Include order id, product details, quantity
    try {
      await publishMessage('order.created', {
        event: 'order.created', orderId: order.id, productId: product.id, product, quantity, status: order.status, createdAt: order.createt_at,
      });
    } catch (err) {
      console.error('Publish order.created error:', err.message);
    }
    // 5. Return success response with order details
    res.status(201).json({ ...order, product });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List orders
app.get('/', async (_req, res) => {
  const r = await db.query('SELECT * FROM orders ORDER BY id DESC');
  res.json(r.rows);
});

// Get order by id
app.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const r = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
  res.json(r.rows[0]);
});

const PORT = 8003;
app.listen(PORT, () => console.log(`Order Service running on ${PORT}`));
