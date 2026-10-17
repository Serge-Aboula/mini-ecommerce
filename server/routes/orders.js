const express = require('express');
const { db } = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

router.use(requireAuth);

// POST /api/orders -> crée une commande à partir d'un panier
router.post('/', async (req, res) => {
  const items = req.body.items; // [{ productId, quantity }, ...]

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Le panier ne peut pas être vide' });
  }

  const transaction = await db.transaction('write');

  try {
    let totalCents = 0;
    const orderItemsData = [];

    // Étape 1 : vérifier le stock et calculer le total, pour chaque produit
    for (const item of items) {
      const quantity = parseInt(item.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error('Quantité invalide');
      }

      const productResult = await transaction.execute({
        sql: 'SELECT * FROM products WHERE id = ?',
        args: [item.productId]
      });
      const product = productResult.rows[0];

      if (!product) {
        throw new Error(`Produit ${item.productId} introuvable`);
      }
      if (product.stock < quantity) {
        throw new Error(
          `Stock insuffisant pour "${product.name}" (${product.stock} disponible(s))`
        );
      }

      totalCents += product.price_cents * quantity;
      orderItemsData.push({
        productId: product.id,
        quantity,
        unitPriceCents: product.price_cents
      });

      // Étape 2 : décrémenter le stock immédiatement (dans la transaction)
      await transaction.execute({
        sql: 'UPDATE products SET stock = stock - ? WHERE id = ?',
        args: [quantity, product.id]
      });
    }

    // Étape 3 : créer la commande
    const orderResult = await transaction.execute({
      sql: 'INSERT INTO orders (user_id, status, total_cents) VALUES (?, ?, ?)',
      args: [req.userId, 'pending', totalCents]
    });
    const orderId = Number(orderResult.lastInsertRowid);

    // Étape 4 : créer chaque ligne de commande
    for (const item of orderItemsData) {
      await transaction.execute({
        sql: 'INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES (?, ?, ?, ?)',
        args: [orderId, item.productId, item.quantity, item.unitPriceCents]
      });
    }

    // Tout s'est bien passé -> on valide définitivement
    await transaction.commit();

    res.status(201).json({ orderId, totalCents });
  } catch (err) {
    // Quoi qu'il arrive en cas d'erreur -> on annule TOUT
    await transaction.rollback();
    res.status(400).json({ error: err.message || 'Impossible de créer la commande' });
  }
});

// GET /api/orders -> historique des commandes de l'utilisateur connecté
router.get('/', async (req, res) => {
  const orders = await db.execute({
    sql: 'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
    args: [req.userId]
  });

  res.json(orders.rows);
});

// POST /api/orders/:id/checkout -> crée une session de paiement Stripe pour une commande existante
router.post('/:id/checkout', async (req, res) => {
  if (!process.env.APP_BASE_URL || !process.env.APP_BASE_URL.startsWith('http')) {
    console.error('APP_BASE_URL manquante ou invalide (doit commencer par http:// ou https://)');
    return res.status(500).json({ error: 'Configuration serveur invalide' });
  }
  const orderResult = await db.execute({
    sql: 'SELECT * FROM orders WHERE id = ? AND user_id = ?',
    args: [req.params.id, req.userId]
  });
  const order = orderResult.rows[0];

  if (!order) {
    return res.status(404).json({ error: 'Commande introuvable' });
  }
  if (order.status !== 'pending') {
    return res.status(400).json({ error: `Cette commande est déjà "${order.status}"` });
  }

  const itemsResult = await db.execute({
    sql: `
      SELECT oi.*, p.name as product_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `,
    args: [order.id]
  });

  const lineItems = itemsResult.rows.map((item) => ({
    price_data: {
      currency: 'eur',
      product_data: { name: item.product_name },
      unit_amount: item.unit_price_cents
    },
    quantity: item.quantity
  }));

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      //payment_method_types: ['card'], : les API tierces évoluent, une consigne qui fonctionnait il y a quelque temps peut devenir obsolète
      line_items: lineItems,
      metadata: { orderId: String(order.id) },
      expires_at: Math.floor(Date.now() / 1000) + 35 * 60, // marge de 5 minutes (Stripe exige au moins 30 min)
      success_url: `${process.env.APP_BASE_URL}/?orderSuccess=${order.id}`,
      cancel_url: `${process.env.APP_BASE_URL}/?orderCancelled=${order.id}`
    });
  } catch (err) {
    console.error('Erreur Stripe:', err.message);
    return res.status(502).json({ error: 'Impossible de créer la session de paiement' });
  }

  res.json({ checkoutUrl: session.url, sessionId: session.id });
});

// GET /api/orders/:id -> détail d'une commande (avec ses lignes), seulement si elle appartient à l'utilisateur
router.get('/:id', async (req, res) => {
  const orderResult = await db.execute({
    sql: 'SELECT * FROM orders WHERE id = ? AND user_id = ?',
    args: [req.params.id, req.userId]
  });

  if (orderResult.rows.length === 0) {
    return res.status(404).json({ error: 'Commande introuvable' });
  }

  const itemsResult = await db.execute({
    sql: `
      SELECT oi.*, p.name as product_name, p.image_url
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `,
    args: [req.params.id]
  });

  res.json({
    order: orderResult.rows[0],
    items: itemsResult.rows
  });
});

module.exports = router;
