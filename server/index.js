const express = require('express');
const path = require('path');
const { initDb } = require('./db');
const authRouter = require('./routes/auth');
const categoriesRouter = require('./routes/categories');
const productsRouter = require('./routes/products');
const ordersRouter = require('./routes/orders');
const webhooksRouter = require('./routes/webhooks');

const app = express();
// Render place un proxy devant l'application : on lui fait confiance pour lire
// l'adresse réelle du visiteur (utilisée par le rate limiting)
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Le webhook DOIT être monté AVANT express.json()
app.use('/api/webhooks', webhooksRouter);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api/auth', authRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);

async function start() {
  await initDb();
  if (require.main === module) {
    app.listen(PORT, () => {
      console.log(`Serveur démarré sur http://localhost:${PORT}`);
    });
  }
}

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON invalide dans le corps de la requête' });
  }
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

// Les tests attendent cette promesse avant d'envoyer leurs requêtes
app.locals.ready = start();
module.exports = app;
