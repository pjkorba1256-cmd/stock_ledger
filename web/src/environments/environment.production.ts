export const environment = {
  production: true,
  // Update this to match your Render Web Service URL:
  // e.g. 'https://stock-ledger-api.onrender.com/inventory'
  apiUrl:
    (typeof window !== 'undefined' && (window as any).__API_URL__) ||
    'https://stock-ledger-api.onrender.com/inventory',
};
