const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };
  if (event.headers['x-refresh-token'] !== process.env.REFRESH_TOKEN) {
    return { statusCode: 401, body: 'Unauthorized' };
  }
  try {
    const settings = JSON.parse(event.body || '{}');
    const store = getStore({ name: 'dashboard', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });
    await store.set('settings', JSON.stringify(settings));
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch {
    return { statusCode: 400, body: 'Invalid request' };
  }
};
