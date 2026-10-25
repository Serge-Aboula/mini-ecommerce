// ---------- Éléments du DOM ----------
const views = {
  catalog: document.getElementById('catalog-view'),
  cart: document.getElementById('cart-view'),
  orders: document.getElementById('orders-view'),
  auth: document.getElementById('auth-view')
};
const errorBox = document.getElementById('error-message');
const toastEl = document.getElementById('toast');

const brandLink = document.getElementById('brand-link');
const navCatalog = document.getElementById('nav-catalog');
const navCart = document.getElementById('nav-cart');
const navOrders = document.getElementById('nav-orders');
const navLogin = document.getElementById('nav-login');
const navLogout = document.getElementById('nav-logout');
const userGreeting = document.getElementById('user-greeting');

const categorySelect = document.getElementById('category-select');
const sortSelect = document.getElementById('sort-select');
const spinner = document.getElementById('loading-spinner');
const productGrid = document.getElementById('product-grid');
const paginationControls = document.getElementById('pagination-controls');
const prevPageBtn = document.getElementById('prev-page-btn');
const nextPageBtn = document.getElementById('next-page-btn');
const pageIndicator = document.getElementById('page-indicator');

const cartList = document.getElementById('cart-list');
const cartEmpty = document.getElementById('cart-empty');
const cartSummary = document.getElementById('cart-summary');
const cartTotal = document.getElementById('cart-total');
const checkoutBtn = document.getElementById('checkout-btn');

const ordersList = document.getElementById('orders-list');
const orderBanner = document.getElementById('order-banner');

const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const authForm = document.getElementById('auth-form');
const authName = document.getElementById('auth-name');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authSubmit = document.getElementById('auth-submit');
const rememberWrapper = document.getElementById('remember-me-wrapper');
const rememberMe = document.getElementById('remember-me');
const togglePasswordBtn = document.getElementById('toggle-password');

// ---------- État ----------
let currentPage = 1;
let currentCategory = '';
let currentSort = 'newest';
let authMode = 'login';
let toastTimer;
let postLoginAction = null; // où aller après une connexion (ex. retour au panier)

const STATUS_LABELS = {
  pending: 'En attente de paiement',
  paid: 'Payée',
  cancelled: 'Annulée'
};

// ---------- Utilitaires ----------
// Crée un élément avec textContent (jamais innerHTML : pas d'injection possible)
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.style.display = 'block';
}

function clearError() {
  errorBox.style.display = 'none';
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.style.display = 'none';
  }, 3000);
}

// Les prix sont stockés en centimes : on ne convertit qu'à l'affichage
function formatPrice(cents) {
  return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

// Les dates SQL sont en UTC, sans fuseau : on le précise pour que le navigateur convertisse
function formatDate(value) {
  return new Date(value.replace(' ', 'T') + 'Z').toLocaleString('fr-FR');
}

// ---------- Session ----------
function saveSession(token, name, remember) {
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem('token', token);
  storage.setItem('userName', name);
}

function getToken() {
  return localStorage.getItem('token') || sessionStorage.getItem('token');
}

function getUserName() {
  return localStorage.getItem('userName') || sessionStorage.getItem('userName');
}

function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('userName');
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('userName');
}

function authFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${getToken()}` }
  });
}

// Renvoie true si la session a expiré (et a déjà été traitée)
function handleUnauthorized(res) {
  if (res.status !== 401) return false;
  clearSession();
  postLoginAction = null;
  updateNav();
  showAuthView();
  showToast('Session expirée, reconnecte-toi.');
  return true;
}

// ---------- Panier (localStorage) ----------
function getCart() {
  try {
    return JSON.parse(localStorage.getItem('cart')) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartBadge();
}

function updateCartBadge() {
  const count = getCart().reduce((sum, line) => sum + line.quantity, 0);
  navCart.textContent = `Panier (${count})`;
}

function cartTotalCents(cart) {
  return cart.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
}

function addToCart(product) {
  const cart = getCart();
  const line = cart.find((item) => item.productId === product.id);
  const quantity = line ? line.quantity : 0;

  if (quantity + 1 > product.stock) {
    showToast('Stock maximum atteint pour ce produit');
    return;
  }

  if (line) {
    line.quantity += 1;
  } else {
    cart.push({
      productId: product.id,
      name: product.name,
      priceCents: product.price_cents,
      imageUrl: product.image_url,
      stock: product.stock,
      quantity: 1
    });
  }
  saveCart(cart);
  showToast(`${product.name} ajouté au panier`);
}

function changeQuantity(productId, delta) {
  const cart = getCart();
  const line = cart.find((item) => item.productId === productId);
  if (!line) return;

  const next = line.quantity + delta;
  if (next < 1) {
    removeFromCart(productId);
    return;
  }
  if (next > line.stock) {
    showToast('Stock maximum atteint pour ce produit');
    return;
  }
  line.quantity = next;
  saveCart(cart);
  renderCart();
}

function removeFromCart(productId) {
  saveCart(getCart().filter((item) => item.productId !== productId));
  renderCart();
}

// Met à jour prix et stock depuis le serveur (ils ont pu changer depuis l'ajout)
async function refreshCart() {
  const cart = getCart();
  if (cart.length === 0) return;

  let changed = false;
  const updated = [];

  for (const line of cart) {
    try {
      const res = await fetch(`/api/products/${line.productId}`);
      if (res.status === 404) {
        changed = true;
        continue;
      }
      if (!res.ok) {
        updated.push(line);
        continue;
      }
      const product = await res.json();
      if (product.stock <= 0) {
        changed = true;
        continue;
      }
      const quantity = Math.min(line.quantity, product.stock);
      if (quantity !== line.quantity || product.price_cents !== line.priceCents) changed = true;
      updated.push({
        productId: product.id,
        name: product.name,
        priceCents: product.price_cents,
        imageUrl: product.image_url,
        stock: product.stock,
        quantity
      });
    } catch {
      updated.push(line); // hors ligne : on garde la ligne telle quelle
    }
  }

  saveCart(updated);
  if (changed) showToast('Ton panier a été mis à jour (prix ou stock modifiés).');
}

function buildCartRow(line) {
  const row = el('div', 'cart-row');

  const thumb = el('div', 'cart-thumb');
  if (line.imageUrl) {
    const img = document.createElement('img');
    img.src = line.imageUrl;
    img.alt = line.name;
    img.addEventListener('error', () => img.remove());
    thumb.appendChild(img);
  }

  const info = el('div');
  info.appendChild(el('div', 'cart-name', line.name));
  info.appendChild(el('div', 'cart-unit-price', formatPrice(line.priceCents)));

  const qty = el('div', 'qty-controls');
  const minus = el('button', '', '−');
  minus.addEventListener('click', () => changeQuantity(line.productId, -1));
  const plus = el('button', '', '+');
  plus.addEventListener('click', () => changeQuantity(line.productId, 1));
  qty.appendChild(minus);
  qty.appendChild(el('span', '', String(line.quantity)));
  qty.appendChild(plus);

  const lineTotal = el('div', 'cart-line-total', formatPrice(line.priceCents * line.quantity));

  const remove = el('button', 'remove-btn', '🗑️');
  remove.setAttribute('aria-label', `Retirer ${line.name}`);
  remove.addEventListener('click', () => removeFromCart(line.productId));

  [thumb, info, qty, lineTotal, remove].forEach((node) => row.appendChild(node));
  return row;
}

function renderCart() {
  const cart = getCart();
  cartList.innerHTML = '';
  const isEmpty = cart.length === 0;
  cartEmpty.style.display = isEmpty ? 'block' : 'none';
  cartSummary.style.display = isEmpty ? 'none' : 'flex';
  cart.forEach((line) => cartList.appendChild(buildCartRow(line)));
  cartTotal.textContent = formatPrice(cartTotalCents(cart));
}

// ---------- Commande et paiement ----------
// Crée la session Stripe puis redirige vers la page de paiement
async function startPayment(orderId) {
  const res = await authFetch(`/api/orders/${orderId}/checkout`, { method: 'POST' });
  if (handleUnauthorized(res)) return;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Paiement indisponible');
  window.location.href = data.checkoutUrl;
}

async function placeOrder() {
  const cart = getCart();
  if (cart.length === 0) return;

  if (!getToken()) {
    postLoginAction = showCartView;
    showAuthView();
    showToast('Connecte-toi pour passer commande');
    return;
  }

  checkoutBtn.disabled = true; // empêche un double clic = deux commandes
  clearError();

  try {
    // Seuls les ids et quantités partent au serveur : il recalcule les prix lui-même
    const res = await authFetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart.map((line) => ({ productId: line.productId, quantity: line.quantity }))
      })
    });
    if (handleUnauthorized(res)) return;

    const data = await res.json();
    if (!res.ok) {
      showError(data.error); // ex. stock insuffisant
      await refreshCart();
      renderCart();
      return;
    }

    // La commande existe et le stock est réservé : on vide le panier
    saveCart([]);

    try {
      await startPayment(data.orderId);
    } catch (err) {
      console.error('Erreur de paiement:', err);
      await showOrdersView();
      showError(`${err.message}. Tu peux réessayer depuis cette liste.`);
    }
  } catch (err) {
    console.error('Erreur de commande:', err);
    showError('Erreur de connexion au serveur.');
  } finally {
    checkoutBtn.disabled = false;
  }
}

async function waitForPayment(orderId) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await authFetch(`/api/orders/${orderId}`);
    if (res.status === 401) break;
    if (res.ok) {
      const { order } = await res.json();
      if (order.status !== 'pending') return order.status;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return 'pending';
}

// Retour depuis Stripe. L'URL n'est qu'un indice : seul le statut serveur fait foi.
async function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  const successId = params.get('orderSuccess');
  const cancelledId = params.get('orderCancelled');
  if (!successId && !cancelledId) return false;

  window.history.replaceState({}, '', '/');

  if (cancelledId) {
    await showOrdersView(
      'Paiement annulé : ta commande reste en attente, tu peux la payer ci-dessous.'
    );
    return true;
  }

  await showOrdersView('Paiement reçu, confirmation en cours…');
  const status = await waitForPayment(successId);

  const messages = {
    paid: `Merci ! Ta commande n°${successId} est payée.`,
    cancelled: `Ta commande n°${successId} a été annulée.`,
    pending: 'Ton paiement est en cours de confirmation, actualise cette page dans un instant.'
  };
  await showOrdersView(messages[status]);
  return true;
}

// ---------- Historique des commandes ----------
function setBanner(message) {
  orderBanner.textContent = message || '';
  orderBanner.style.display = message ? 'block' : 'none';
}

async function toggleOrderDetails(orderId, container) {
  if (container.childElementCount > 0) {
    container.innerHTML = ''; // second clic : on referme
    return;
  }
  try {
    const res = await authFetch(`/api/orders/${orderId}`);
    if (handleUnauthorized(res)) return;
    if (!res.ok) throw new Error();
    const { items } = await res.json();
    items.forEach((item) => {
      const line = el('div', 'order-item');
      line.appendChild(el('span', '', `${item.quantity} × ${item.product_name}`));
      line.appendChild(el('span', '', formatPrice(item.unit_price_cents * item.quantity)));
      container.appendChild(line);
    });
  } catch (err) {
    console.error('Erreur de chargement du détail:', err);
    showError('Impossible de charger le détail de la commande.');
  }
}

async function payPendingOrder(orderId, button) {
  button.disabled = true;
  try {
    clearError();
    await startPayment(orderId);
  } catch (err) {
    console.error('Erreur de paiement:', err);
    showError(err.message);
    button.disabled = false;
  }
}

function renderOrders(orders) {
  ordersList.innerHTML = '';

  if (orders.length === 0) {
    ordersList.appendChild(el('p', 'empty-block', 'Aucune commande pour le moment.'));
    return;
  }

  orders.forEach((order) => {
    const card = el('article', 'order-card');

    const header = el('div', 'order-header');
    header.appendChild(el('strong', '', `Commande n°${order.id}`));
    header.appendChild(
      el('span', `status-badge status-${order.status}`, STATUS_LABELS[order.status] || order.status)
    );
    card.appendChild(header);
    card.appendChild(
      el('div', 'order-meta', `${formatDate(order.created_at)} · ${formatPrice(order.total_cents)}`)
    );

    const details = el('div', 'order-items');
    const actions = el('div', 'order-actions');

    const detailsBtn = el('button', '', 'Voir le détail');
    detailsBtn.addEventListener('click', () => toggleOrderDetails(order.id, details));
    actions.appendChild(detailsBtn);

    if (order.status === 'pending') {
      const payBtn = el('button', 'pay-btn', 'Payer');
      payBtn.addEventListener('click', () => payPendingOrder(order.id, payBtn));
      actions.appendChild(payBtn);
    }

    card.appendChild(actions);
    card.appendChild(details);
    ordersList.appendChild(card);
  });
}

async function showOrdersView(bannerMessage) {
  if (!getToken()) {
    postLoginAction = showOrdersView;
    showAuthView();
    showToast('Connecte-toi pour voir tes commandes');
    return;
  }

  showView('orders');
  setBanner(bannerMessage);
  ordersList.innerHTML = '';

  try {
    const res = await authFetch('/api/orders');
    if (handleUnauthorized(res)) return;
    if (!res.ok) throw new Error();
    renderOrders(await res.json());
  } catch (err) {
    console.error('Erreur de chargement des commandes:', err);
    showError('Impossible de charger tes commandes.');
  }
}

// ---------- Vues et navigation ----------
function hideAllViews() {
  clearError();
  Object.values(views).forEach((view) => {
    view.style.display = 'none';
  });
}

function showView(name) {
  hideAllViews();
  views[name].style.display = 'block';
}

function updateNav() {
  const loggedIn = Boolean(getToken());
  navLogin.style.display = loggedIn ? 'none' : 'inline-block';
  navLogout.style.display = loggedIn ? 'inline-block' : 'none';
  navOrders.style.display = loggedIn ? 'inline-block' : 'none';
  userGreeting.style.display = loggedIn ? 'inline' : 'none';
  userGreeting.textContent = loggedIn ? `Bonjour, ${getUserName() || ''}` : '';
}

function showCatalogView() {
  showView('catalog');
  fetchProducts(currentPage);
}

async function showCartView() {
  showView('cart');
  renderCart();
  await refreshCart();
  renderCart();
}

function showAuthView() {
  showView('auth');
}

// ---------- Catalogue ----------
async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    if (!res.ok) throw new Error();
    const categories = await res.json();
    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      categorySelect.appendChild(option);
    });
  } catch (err) {
    console.error('Chargement des catégories impossible:', err);
  }
}

async function fetchProducts(page = 1) {
  try {
    clearError();
    spinner.style.display = 'block';
    productGrid.style.display = 'none';
    paginationControls.style.display = 'none';

    const params = new URLSearchParams({ page, limit: 12, sort: currentSort });
    if (currentCategory) params.set('categoryId', currentCategory);

    const res = await fetch(`/api/products?${params}`);
    if (!res.ok) throw new Error();

    const data = await res.json();
    currentPage = data.pagination.page;
    renderProducts(data.products);
    renderPagination(data.pagination);
  } catch (err) {
    console.error('Erreur de chargement du catalogue:', err);
    showError('Impossible de charger le catalogue.');
    paginationControls.style.display = 'none';
  } finally {
    spinner.style.display = 'none';
    productGrid.style.display = 'grid';
  }
}

function renderProducts(products) {
  productGrid.innerHTML = '';

  if (products.length === 0) {
    productGrid.appendChild(el('p', 'empty-message', 'Aucun produit à afficher.'));
    return;
  }

  products.forEach((product) => {
    const card = el('article', 'product-card');

    const imageBox = el('div', 'product-image');
    if (product.image_url) {
      const img = document.createElement('img');
      img.src = product.image_url;
      img.alt = product.name;
      img.addEventListener('error', () => img.remove());
      imageBox.appendChild(img);
    }

    const body = el('div', 'product-body');
    body.appendChild(el('h3', '', product.name));
    if (product.category_name) {
      body.appendChild(el('span', 'product-category', product.category_name));
    }
    if (product.description) {
      body.appendChild(el('p', 'product-description', product.description));
    }
    body.appendChild(el('div', 'product-price', formatPrice(product.price_cents)));

    const inStock = product.stock > 0;
    body.appendChild(
      el(
        'div',
        inStock ? 'product-stock' : 'product-stock out-of-stock',
        inStock ? `${product.stock} en stock` : 'Rupture de stock'
      )
    );

    const addBtn = el(
      'button',
      'primary-btn add-btn',
      inStock ? 'Ajouter au panier' : 'Indisponible'
    );
    addBtn.disabled = !inStock;
    addBtn.addEventListener('click', () => addToCart(product));
    body.appendChild(addBtn);

    card.appendChild(imageBox);
    card.appendChild(body);
    productGrid.appendChild(card);
  });
}

function renderPagination(pagination) {
  const { page, totalPages } = pagination;

  if (totalPages <= 1) {
    paginationControls.style.display = 'none';
    return;
  }

  paginationControls.style.display = 'flex';
  pageIndicator.textContent = `Page ${page} sur ${totalPages}`;
  prevPageBtn.disabled = page <= 1;
  nextPageBtn.disabled = page >= totalPages;
}

categorySelect.addEventListener('change', () => {
  currentCategory = categorySelect.value;
  fetchProducts(1);
});

sortSelect.addEventListener('change', () => {
  currentSort = sortSelect.value;
  fetchProducts(1);
});

prevPageBtn.addEventListener('click', () => {
  if (currentPage > 1) fetchProducts(currentPage - 1);
});

nextPageBtn.addEventListener('click', () => {
  fetchProducts(currentPage + 1);
});

// ---------- Authentification ----------
function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === 'login';
  tabLogin.classList.toggle('active', isLogin);
  tabRegister.classList.toggle('active', !isLogin);
  authSubmit.textContent = isLogin ? 'Se connecter' : "S'inscrire";
  authName.style.display = isLogin ? 'none' : 'block';
  authName.required = !isLogin;
  rememberWrapper.style.display = isLogin ? 'flex' : 'none';
  clearError();
}

tabLogin.addEventListener('click', () => setAuthMode('login'));
tabRegister.addEventListener('click', () => setAuthMode('register'));

togglePasswordBtn.addEventListener('click', () => {
  const isHidden = authPassword.type === 'password';
  authPassword.type = isHidden ? 'text' : 'password';
  togglePasswordBtn.textContent = isHidden ? '🙈' : '👁️';
});

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();

  const email = authEmail.value.trim();
  const password = authPassword.value;
  const remember = rememberMe.checked;
  const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
  const body =
    authMode === 'register'
      ? { name: authName.value.trim(), email, password }
      : { email, password };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error);
      return;
    }

    saveSession(data.token, data.name, remember);
    authForm.reset();
    updateNav();
    showToast(authMode === 'login' ? 'Connecté(e) !' : 'Compte créé !');

    const next = postLoginAction || showCatalogView;
    postLoginAction = null;
    next();
  } catch (err) {
    console.error("Erreur d'authentification:", err);
    showError('Erreur de connexion au serveur.');
  }
});

// ---------- Navigation ----------
brandLink.addEventListener('click', (event) => {
  event.preventDefault();
  showCatalogView();
});
navCatalog.addEventListener('click', showCatalogView);
navCart.addEventListener('click', showCartView);
navOrders.addEventListener('click', () => showOrdersView());
navLogin.addEventListener('click', showAuthView);
checkoutBtn.addEventListener('click', placeOrder);

navLogout.addEventListener('click', () => {
  clearSession();
  postLoginAction = null;
  updateNav();
  showCatalogView();
  showToast('Déconnecté(e) !');
});

// ---------- Démarrage ----------
loadCategories();
updateNav();
updateCartBadge();
handleStripeReturn().then((handled) => {
  if (!handled) showCatalogView();
});
