const { test, before } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const Stripe = require('stripe');
const app = require('../server/index');
const { db } = require('../server/db');
const { cancelOrderAndRestoreStock } = require('../server/routes/webhooks');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

before(async () => {
  await app.locals.ready;
});

async function registerUser(role = 'user') {
  const email = `order-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Testeur', email, password: 'motdepasse123' });

  if (role === 'admin') {
    await db.execute({ sql: "UPDATE users SET role = 'admin' WHERE email = ?", args: [email] });
  }
  return res.body.token;
}

async function createProduct(adminToken, stock) {
  const res = await request(app)
    .post('/api/products')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `Produit ${Date.now()}`, priceCents: 1000, stock });
  return res.body;
}

async function getStock(productId) {
  const res = await request(app).get(`/api/products/${productId}`);
  return res.body.stock;
}

function placeOrder(token, items) {
  return request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({ items });
}

async function getOrderStatus(token, orderId) {
  const res = await request(app)
    .get(`/api/orders/${orderId}`)
    .set('Authorization', `Bearer ${token}`);
  return res.body.order.status;
}

test('Une commande valide décrémente le stock', async () => {
  const admin = await registerUser('admin');
  const user = await registerUser();
  const product = await createProduct(admin, 5);

  const res = await placeOrder(user, [{ productId: product.id, quantity: 2 }]);

  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.totalCents, 2000);
  assert.strictEqual(await getStock(product.id), 3);
});

test('Un stock insuffisant annule TOUTE la commande (rollback)', async () => {
  const admin = await registerUser('admin');
  const user = await registerUser();
  const a = await createProduct(admin, 5);
  const b = await createProduct(admin, 1);

  // Le produit A est valide, le produit B manque de stock :
  // le stock de A, déjà décrémenté dans la transaction, doit être restauré
  const res = await placeOrder(user, [
    { productId: a.id, quantity: 2 },
    { productId: b.id, quantity: 5 }
  ]);

  assert.strictEqual(res.status, 400);
  assert.strictEqual(await getStock(a.id), 5);
  assert.strictEqual(await getStock(b.id), 1);
});

test("L'annulation restaure le stock une seule fois (idempotence)", async () => {
  const admin = await registerUser('admin');
  const user = await registerUser();
  const product = await createProduct(admin, 5);

  const order = await placeOrder(user, [{ productId: product.id, quantity: 2 }]);
  const orderId = order.body.orderId;
  assert.strictEqual(await getStock(product.id), 3);

  await cancelOrderAndRestoreStock(orderId);
  assert.strictEqual(await getOrderStatus(user, orderId), 'cancelled');
  assert.strictEqual(await getStock(product.id), 5);

  // Un second appel (Stripe peut renvoyer un événement) ne doit rien changer
  await cancelOrderAndRestoreStock(orderId);
  assert.strictEqual(await getStock(product.id), 5);
});

test("Un utilisateur ne peut pas consulter la commande d'un autre", async () => {
  const admin = await registerUser('admin');
  const owner = await registerUser();
  const stranger = await registerUser();
  const product = await createProduct(admin, 5);

  const order = await placeOrder(owner, [{ productId: product.id, quantity: 1 }]);

  const res = await request(app)
    .get(`/api/orders/${order.body.orderId}`)
    .set('Authorization', `Bearer ${stranger}`);
  assert.strictEqual(res.status, 404);
});

test('Le webhook rejette une signature invalide (400)', async () => {
  const res = await request(app)
    .post('/api/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', 'signature-invalide')
    .send('{}');
  assert.strictEqual(res.status, 400);
});

test('Un webhook correctement signé passe la commande à "paid"', async () => {
  const admin = await registerUser('admin');
  const user = await registerUser();
  const product = await createProduct(admin, 5);
  const order = await placeOrder(user, [{ productId: product.id, quantity: 1 }]);
  const orderId = order.body.orderId;

  const payload = JSON.stringify({
    id: 'evt_test',
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test',
        object: 'checkout.session',
        payment_status: 'paid',
        metadata: { orderId: String(orderId) }
      }
    }
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET
  });

  const res = await request(app)
    .post('/api/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signature)
    .send(payload);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(await getOrderStatus(user, orderId), 'paid');
});
