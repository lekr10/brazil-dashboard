const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };

  if (event.headers['x-refresh-token'] !== process.env.REFRESH_TOKEN) {
    return { statusCode: 401 };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  if (body.signal !== 'ewz') {
    return { statusCode: 400, body: 'Unknown signal' };
  }

  const raw = parseFloat(body.raw);
  if (isNaN(raw) || raw <= 0) {
    return { statusCode: 400, body: 'Invalid value' };
  }

  const store = getStore({ name: 'dashboard', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });
  const existing = (await store.get('snapshot', { type: 'json' }).catch(() => null)) || { data: {} };

  const now = new Date().toISOString();
  existing.data.ewz = {
    key: 'ewz',
    value: `${raw.toFixed(0)}M`,
    raw,
    error: null,
    manual: true,
    lastUpdated: now,
  };
  existing.lastUpdated = now;

  await store.set('snapshot', JSON.stringify(existing));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(existing),
  };
};
