const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { db } = require('../db');

const router = express.Router();

// express.raw : Stripe signe le corps BRUT de la requête. Si le JSON était déjà parsé,
// la vérification de signature échouerait.
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Échec vérification signature webhook:', err.message);
    return res.status(400).send(`Signature de webhook invalide : ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderId = session.metadata && session.metadata.orderId;
      if (!orderId) {
        return res.json({ received: true }); // événement qui ne vient pas de notre flux de commande
      }

      if (session.payment_status === 'paid') {
        // "AND status = 'pending'" rend l'opération idempotente :
        // Stripe peut renvoyer le même événement plusieurs fois
        await db.execute({
          sql: "UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'pending'",
          args: [orderId]
        });
      }
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const orderId = session.metadata && session.metadata.orderId;
      if (!orderId) {
        return res.json({ received: true }); // événement qui ne vient pas de notre flux de commande
      }
      await cancelOrderAndRestoreStock(orderId);
    }
  } catch (err) {
    console.error('Erreur traitement webhook:', err);
    // 500 -> Stripe réessaiera automatiquement plus tard
    return res.status(500).send('Erreur interne');
  }

  res.json({ received: true });
});

async function cancelOrderAndRestoreStock(orderId) {
  const transaction = await db.transaction('write');
  try {
    const update = await transaction.execute({
      sql: "UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'",
      args: [orderId]
    });

    // Si aucune ligne modifiée, la commande était déjà traitée (payée ou déjà annulée) :
    // on ne restaure surtout pas le stock une seconde fois
    if (update.rowsAffected === 0) {
      await transaction.rollback();
      return;
    }

    const items = await transaction.execute({
      sql: 'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
      args: [orderId]
    });

    for (const item of items.rows) {
      await transaction.execute({
        sql: 'UPDATE products SET stock = stock + ? WHERE id = ?',
        args: [item.quantity, item.product_id]
      });
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = router;
module.exports.cancelOrderAndRestoreStock = cancelOrderAndRestoreStock;
