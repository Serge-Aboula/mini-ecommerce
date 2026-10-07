const express = require("express");
const { db } = require("../db");
const requireAuth = require("../middleware/auth");
const requireAdmin = require("../middleware/admin");

const router = express.Router();

// GET /api/categories -> liste publique, pas besoin d'être connecté
router.get("/", async (req, res) => {
  const result = await db.execute("SELECT * FROM categories ORDER BY name ASC");
  res.json(result.rows);
});

// POST /api/categories -> admin uniquement
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "Le nom de la catégorie est requis" });
  }

  const existing = await db.execute({
    sql: "SELECT id FROM categories WHERE name = ?",
    args: [name],
  });
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: "Cette catégorie existe déjà" });
  }

  const result = await db.execute({
    sql: "INSERT INTO categories (name) VALUES (?)",
    args: [name],
  });

  res.status(201).json({ id: Number(result.lastInsertRowid), name });
});

// DELETE /api/categories/:id -> admin uniquement
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  await db.execute({ sql: "DELETE FROM categories WHERE id = ?", args: [id] });
  res.status(204).send();
});

module.exports = router;
