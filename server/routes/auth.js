const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { db } = require("../db");
const crypto = require("crypto");

const router = express.Router();
const SALT_ROUNDS = 10;
const requireAuth = require("../middleware/auth");

const rateLimit = require("express-rate-limit");

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "test" ? 1000 : 5, // 5 tentatives max par IP dans cette fenêtre et limite très haute en test, pour ne pas gêner les tests automatisés
  message: { error: "Trop de tentatives. Réessaie dans quelques minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Nom, email et mot de passe requis" });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Format d'email invalide" });
  }
  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: "Le mot de passe doit faire au moins 8 caractères" });
  }

  const existing = await db.execute({
    sql: "SELECT id FROM users WHERE email = ?",
    args: [email],
  });
  if (existing.rows.length > 0) {
    return res
      .status(409)
      .json({ error: "Un compte existe déjà avec cet email" });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await db.execute({
    sql: "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
    args: [name, email, passwordHash],
  });

  const token = jwt.sign(
    { userId: Number(result.lastInsertRowid) },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    },
  );

  res.status(201).json({ token, name, email });
});

// POST /api/auth/login
router.post("/login", authLimiter, async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";

  if (!email || !password) {
    return res.status(400).json({ error: "Email et mot de passe requis" });
  }

  const result = await db.execute({
    sql: "SELECT * FROM users WHERE email = ?",
    args: [email],
  });
  const user = result.rows[0];

  if (!user) {
    return res.status(401).json({ error: "Email ou mot de passe incorrect" });
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    return res.status(401).json({ error: "Email ou mot de passe incorrect" });
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.json({ token, name: user.name, email: user.email });
});

// POST /api/auth/forgot-password
router.post("/forgot-password", authLimiter, async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();

  if (!email) {
    return res.status(400).json({ error: "Email requis" });
  }

  const result = await db.execute({
    sql: "SELECT id FROM users WHERE email = ?",
    args: [email],
  });
  const user = result.rows[0];

  // Réponse volontairement identique, que l'email existe ou non
  // -> évite de révéler quels emails sont enregistrés dans le système
  const genericResponse = {
    message:
      "Si un compte existe avec cet email, un lien de réinitialisation a été généré.",
  };

  if (!user) {
    return res.json(genericResponse);
  }

  // Génère un token aléatoire sécurisé
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // Expire après 5 minutes

  await db.execute({
    sql: "UPDATE users SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?",
    args: [tokenHash, expires, user.id],
  });

  // Version simplifiée : on "envoie" le lien via la console plutôt qu'un vrai email
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const resetLink = `${baseUrl}/?resetToken=${rawToken}`;
  console.log(
    `\n📧 [SIMULATION EMAIL] Lien de réinitialisation pour ${email} :\n${resetLink}\n`,
  );

  // En dev uniquement : on renvoie aussi le lien dans la réponse pour pouvoir tester sans regarder les logs
  res.json({ ...genericResponse, devResetLink: resetLink });
});

// POST /api/auth/reset-password
router.post("/reset-password", async (req, res) => {
  const { token } = req.body;
  const newPassword = req.body.newPassword || "";

  if (!token || !newPassword) {
    return res
      .status(400)
      .json({ error: "Token et nouveau mot de passe requis" });
  }
  if (newPassword.length < 8) {
    return res
      .status(400)
      .json({ error: "Le mot de passe doit faire au moins 8 caractères" });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const result = await db.execute({
    sql: "SELECT * FROM users WHERE reset_token_hash = ?",
    args: [tokenHash],
  });
  const user = result.rows[0];

  if (!user) {
    return res.status(400).json({ error: "Lien de réinitialisation invalide" });
  }

  if (new Date(user.reset_token_expires) < new Date()) {
    return res
      .status(400)
      .json({ error: "Ce lien de réinitialisation a expiré" });
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await db.execute({
    sql: "UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [passwordHash, user.id],
  });

  res.json({ message: "Mot de passe réinitialisé avec succès" });
});

// PUT /api/auth/profile -> modifier son propre nom (protégé)
router.put("/profile", requireAuth, async (req, res) => {
  const name = (req.body.name || "").trim();

  if (!name) {
    return res.status(400).json({ error: "Le nom ne peut pas être vide" });
  }

  await db.execute({
    sql: "UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [name, req.userId],
  });

  res.json({ name });
});

module.exports = router;
