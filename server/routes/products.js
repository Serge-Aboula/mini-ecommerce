const express = require("express");
const { db } = require("../db");
const requireAuth = require("../middleware/auth");
const requireAdmin = require("../middleware/admin");

const router = express.Router();

// GET /api/products -> catalogue public, avec pagination/tri/filtre par catégorie
router.get("/", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 12));
  const offset = (page - 1) * limit;

  const sortOptions = {
    newest: "p.created_at DESC",
    price_asc: "p.price_cents ASC",
    price_desc: "p.price_cents DESC",
    alpha: "p.name ASC",
  };
  const sort = sortOptions[req.query.sort] || sortOptions.newest;

  const categoryId = parseInt(req.query.categoryId);
  const categoryFilter = Number.isInteger(categoryId)
    ? "AND p.category_id = ?"
    : "";
  const args = Number.isInteger(categoryId)
    ? [categoryId, limit, offset]
    : [limit, offset];
  const countArgs = Number.isInteger(categoryId) ? [categoryId] : [];

  const products = await db.execute({
    sql: `
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE 1=1 ${categoryFilter}
      ORDER BY ${sort}
      LIMIT ? OFFSET ?
    `,
    args,
  });

  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as total FROM products p WHERE 1=1 ${categoryFilter}`,
    args: countArgs,
  });
  const total = countResult.rows[0].total;

  res.json({
    products: products.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// GET /api/products/:id -> détail d'un produit
router.get("/:id", async (req, res) => {
  const result = await db.execute({
    sql: `
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ?
    `,
    args: [req.params.id],
  });

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Produit introuvable" });
  }

  res.json(result.rows[0]);
});

// POST /api/products -> admin uniquement
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const name = (req.body.name || "").trim();
  const description = (req.body.description || "").trim();
  const priceCents = parseInt(req.body.priceCents);
  const imageUrl = (req.body.imageUrl || "").trim();
  const stock = parseInt(req.body.stock) || 0;
  const categoryId = req.body.categoryId ? parseInt(req.body.categoryId) : null;

  if (!name || !Number.isInteger(priceCents) || priceCents < 0) {
    return res
      .status(400)
      .json({ error: "Nom et prix (en centimes, entier positif) requis" });
  }

  const result = await db.execute({
    sql: `
      INSERT INTO products (name, description, price_cents, image_url, stock, category_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    args: [name, description, priceCents, imageUrl, stock, categoryId],
  });

  const newProduct = await db.execute({
    sql: "SELECT * FROM products WHERE id = ?",
    args: [result.lastInsertRowid],
  });

  res.status(201).json(newProduct.rows[0]);
});

// PUT /api/products/:id -> admin uniquement, mise à jour partielle
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;

  const existing = await db.execute({
    sql: "SELECT * FROM products WHERE id = ?",
    args: [id],
  });
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: "Produit introuvable" });
  }
  const current = existing.rows[0];

  const name =
    req.body.name !== undefined ? req.body.name.trim() : current.name;
  const description =
    req.body.description !== undefined
      ? req.body.description.trim()
      : current.description;
  const priceCents =
    req.body.priceCents !== undefined
      ? parseInt(req.body.priceCents)
      : current.price_cents;
  const imageUrl =
    req.body.imageUrl !== undefined
      ? req.body.imageUrl.trim()
      : current.image_url;
  const stock =
    req.body.stock !== undefined ? parseInt(req.body.stock) : current.stock;
  const categoryId =
    req.body.categoryId !== undefined
      ? req.body.categoryId
        ? parseInt(req.body.categoryId)
        : null
      : current.category_id;

  await db.execute({
    sql: `
      UPDATE products
      SET name = ?, description = ?, price_cents = ?, image_url = ?, stock = ?,
          category_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    args: [name, description, priceCents, imageUrl, stock, categoryId, id],
  });

  const updated = await db.execute({
    sql: "SELECT * FROM products WHERE id = ?",
    args: [id],
  });
  res.json(updated.rows[0]);
});

// DELETE /api/products/:id -> admin uniquement
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  await db.execute({
    sql: "DELETE FROM products WHERE id = ?",
    args: [req.params.id],
  });
  res.status(204).send();
});

module.exports = router;
