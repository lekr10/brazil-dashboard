const { getStore } = require('@netlify/blobs');

exports.handler = async () => {
  try {
    const store = getStore({ name: 'dashboard', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });
    const [snapshot, settings, history] = await Promise.all([
      store.get('snapshot', { type: 'json' }).catch(() => null),
      store.get('settings', { type: 'json' }).catch(() => null),
      store.get('history', { type: 'json' }).catch(() => null),
    ]);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ snapshot: snapshot || null, settings: settings || {}, history: history || [] }),
    };
  } catch {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ snapshot: null, settings: {} }),
    };
  }
};
