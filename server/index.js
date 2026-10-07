const express = require("express");
const path = require("path");
const { initDb } = require("./db");
const authRouter = require("./routes/auth");
const categoriesRouter = require("./routes/categories");
const productsRouter = require("./routes/products");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/api/auth", authRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/products", productsRouter);

async function start() {
  await initDb();
  if (require.main === module) {
    app.listen(PORT, () => {
      console.log(`Serveur démarré sur http://localhost:${PORT}`);
    });
  }
}

app.use((err, _req, res, _next) => {
  if (err.type === "entity.parse.failed") {
    return res
      .status(400)
      .json({ error: "JSON invalide dans le corps de la requête" });
  }
  console.error(err);
  res.status(500).json({ error: "Erreur interne du serveur" });
});

start();

module.exports = app;
