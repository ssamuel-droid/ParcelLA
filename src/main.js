/**
 * ParceLLA — App Entry Point
 *
 * Bootstraps the app:
 *   1. Load config from window.__PARCELLA_CONFIG__
 *   2. Check API connectivity
 *   3. Restore session if user was logged in
 *   4. Mount the main UI
 *   5. Signal loading screen to dismiss
 *
 * The UI itself lives in src/App.js (imports the widget HTML/CSS/JS)
 * For now, injects the full app HTML into #root directly.
 * When migrating to React: replace with ReactDOM.createRoot(root).render(<App/>)
 */

import { api, setAuthToken, store, actions } from './api/client.js';

const CONFIG = window.__PARCELLA_CONFIG__ ?? {
  apiUrl: 'http://localhost:3001',
  env:    'development',
};

// Override API base URL from config
if (CONFIG.apiUrl) {
  window.__PARCELLA_API_URL__ = CONFIG.apiUrl;
}

async function boot() {
  // 1. Check API health
  let apiOnline = false;
  try {
    const health = await fetch(`${CONFIG.apiUrl}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (health.ok) {
      apiOnline = true;
      const data = await health.json();
      console.log('[parcella] API connected —', data.version, data.services);
    }
  } catch {
    console.warn('[parcella] API offline — running in mock mode');
  }

  store.set({ apiOnline });

  // 2. Restore auth session from localStorage
  const savedToken = localStorage.getItem('parcella_token');
  if (savedToken && apiOnline) {
    try {
      setAuthToken(savedToken);
      const me = await api.auth.me();
      if (me.user) {
        store.set({
          user:     me.user,
          savedIds: new Set(me.savedSiteIds ?? []),
        });
        console.log('[parcella] Session restored for', me.user.email);
      }
    } catch {
      localStorage.removeItem('parcella_token');
      setAuthToken(null);
    }
  }

  // 3. Mount app
  mountApp();

  // 4. Dismiss loading screen
  setTimeout(() => {
    if (window.__parcella_ready) window.__parcella_ready();
  }, 200);
}

function mountApp() {
  const root = document.getElementById('root');
  if (!root) return;

  // The full app UI — in production this would be a React component tree.
  // For now we inject the app HTML directly and initialize the ParceLLA JS.
  root.innerHTML = `
    <div id="parcella-app" style="height:100vh;display:flex;flex-direction:column;font-family:'Inter',system-ui,sans-serif">
      <!-- App renders here via parcella-ui.js -->
    </div>
  `;

  // Load the main UI script
  const script = document.createElement('script');
  script.type  = 'module';
  script.src   = '/src/ui/App.js';
  document.body.appendChild(script);
}

// ── Auth token persistence ─────────────────────────────────────────────────────
store.sub(state => {
  if (state.user?.session?.access_token) {
    localStorage.setItem('parcella_token', state.user.session.access_token);
  }
});

// ── Handle share link ─────────────────────────────────────────────────────────
function handleShareLink() {
  const params = new URLSearchParams(window.location.search);
  const token  = window.location.pathname.match(/^\/deal\/([a-z0-9]{10})$/)?.[1];

  if (token) {
    // Resolve share token and open that site
    api.sites.get(parseInt(params.get('site') ?? '0')).then(data => {
      if (data.site) store.set({ openSiteId: data.site.id });
    }).catch(() => {});
  }

  const siteId = params.get('site');
  if (siteId) {
    store.set({ openSiteId: +siteId });
  }
}

handleShareLink();
boot();
