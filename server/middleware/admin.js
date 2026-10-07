const { db } = require("../db");

async function requireAdmin(req, res, next) {
  const result = await db.execute({
    sql: "SELECT role FROM users WHERE id = ?",
    args: [req.userId],
  });

  const user = result.rows[0];

  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Accès réservé aux administrateurs" });
  }

  next();
}

module.exports = requireAdmin;
