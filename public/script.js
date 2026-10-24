// ---------- Éléments du DOM ----------
const catalogView = document.getElementById('catalog-view');
const authView = document.getElementById('auth-view');
const errorBox = document.getElementById('error-message');
const toastEl = document.getElementById('toast');

const brandLink = document.getElementById('brand-link');
const navCatalog = document.getElementById('nav-catalog');
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

// ---------- Utilitaires ----------
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

// ---------- Vues ----------
function hideAllViews() {
  clearError();
  catalogView.style.display = 'none';
  authView.style.display = 'none';
}

function updateNav() {
  const loggedIn = Boolean(getToken());
  navLogin.style.display = loggedIn ? 'none' : 'inline-block';
  navLogout.style.display = loggedIn ? 'inline-block' : 'none';
  userGreeting.style.display = loggedIn ? 'inline' : 'none';
  userGreeting.textContent = loggedIn ? `Bienvenue, ${getUserName() || ''}` : '';
}

function showCatalogView() {
  hideAllViews();
  catalogView.style.display = 'block';
  fetchProducts(currentPage);
}

function showAuthView() {
  hideAllViews();
  authView.style.display = 'block';
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
    paginationControls.style.display = 'none'; // masquée pendant tout le chargement

    const params = new URLSearchParams({ page, limit: 12, sort: currentSort });
    if (currentCategory) params.set('categoryId', currentCategory);

    const res = await fetch(`/api/products?${params}`);
    if (!res.ok) throw new Error();

    const data = await res.json();
    currentPage = data.pagination.page;
    renderProducts(data.products);
    renderPagination(data.pagination); // réaffichée seulement si elle est utile
  } catch (err) {
    console.error('Erreur de chargement du catalogue:', err);
    showError('Impossible de charger le catalogue.');
    paginationControls.style.display = 'none'; // rien à paginer si le chargement échoue
  } finally {
    spinner.style.display = 'none';
    productGrid.style.display = 'grid';
  }
}

function renderProducts(products) {
  productGrid.innerHTML = '';

  if (products.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = 'Aucun produit à afficher.';
    productGrid.appendChild(empty);
    return;
  }

  products.forEach((product) => {
    const card = document.createElement('article');
    card.className = 'product-card';

    const imageBox = document.createElement('div');
    imageBox.className = 'product-image';
    if (product.image_url) {
      const img = document.createElement('img');
      img.src = product.image_url;
      img.alt = product.name;
      img.loading = 'lazy';
      // Lien d'image cassé : on retire l'image, le fond gris sert de repli
      img.addEventListener('error', () => img.remove());
      imageBox.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'product-body';

    const name = document.createElement('h3');
    name.textContent = product.name;
    body.appendChild(name);

    if (product.category_name) {
      const category = document.createElement('span');
      category.className = 'product-category';
      category.textContent = product.category_name;
      body.appendChild(category);
    }

    if (product.description) {
      const description = document.createElement('p');
      description.className = 'product-description';
      description.textContent = product.description;
      body.appendChild(description);
    }

    const price = document.createElement('div');
    price.className = 'product-price';
    price.textContent = formatPrice(product.price_cents);
    body.appendChild(price);

    const stock = document.createElement('div');
    stock.className = 'product-stock';
    if (product.stock > 0) {
      stock.textContent = `${product.stock} en stock`;
    } else {
      stock.textContent = 'Rupture de stock';
      stock.classList.add('out-of-stock');
    }
    body.appendChild(stock);

    card.appendChild(imageBox);
    card.appendChild(body);
    productGrid.appendChild(card);
  });
}

function renderPagination(pagination) {
  const { page, totalPages } = pagination;

  // Aucun produit (totalPages vaut 0) ou tout tient sur une seule page : rien à paginer
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
  fetchProducts(1); // un nouveau filtre repart de la page 1
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
    showCatalogView();
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
navLogin.addEventListener('click', showAuthView);

navLogout.addEventListener('click', () => {
  clearSession();
  updateNav();
  showCatalogView();
  showToast('Déconnecté(e) !');
});

// ---------- Démarrage ----------
loadCategories();
updateNav();
showCatalogView();
