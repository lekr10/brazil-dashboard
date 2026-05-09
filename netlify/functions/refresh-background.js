const { getStore } = require('@netlify/blobs');

const METRICS = [
  {
    key: 'selic',
    defaultUrl: 'https://tradingeconomics.com/brazil/interest-rate',
    prompt: 'This page shows Brazil interest rate data. Find the current SELIC rate. It will be a number like 14.50 or 13.25. Return ONLY the number — no percent sign, no other text.',
    validate: (n) => n > 0 && n < 50,
    format: (n) => `${n.toFixed(2)}%`,
  },
  {
    key: 'ipca',
    defaultUrl: 'https://tradingeconomics.com/brazil/inflation-cpi',
    prompt: 'This page shows Brazil inflation data. Find the current IPCA year-over-year inflation rate. It will be a number like 4.14 or 5.49. Return ONLY the number — no percent sign, no other text.',
    validate: (n) => n > -5 && n < 30,
    format: (n) => `${n.toFixed(2)}%`,
  },
  {
    key: 'fx',
    defaultUrl: 'https://tradingeconomics.com/usdbrl:cur',
    prompt: 'This page shows the USD to BRL exchange rate. Find the current rate. It will be a number like 4.95 or 5.13. Return ONLY the number — no other text.',
    validate: (n) => n > 1 && n < 20,
    format: (n) => n.toFixed(2),
  },
  {
    key: 'ewz',
    defaultUrl: 'https://www.ishares.com/us/products/239612/ishares-msci-brazil-etf',
    prompt: 'This is an iShares ETF page for EWZ. Find the Shares Outstanding figure. It may appear as "291,800,000" or "291.8M". Convert to millions and return ONLY the number — for example if shares outstanding is 291,800,000 return "291.8". No units, no other text.',
    validate: (n) => n > 50 && n < 5000,
    format: (n) => `${n.toFixed(0)}M`,
  },
  {
    key: 'ibov',
    defaultUrl: 'https://tradingeconomics.com/brazil/stock-market',
    prompt: 'This page shows the Brazilian stock market index (IBOVESPA). Find the current index value. It will be a large number like 184090 or 182500. Return ONLY the number with no commas or other text.',
    validate: (n) => n > 10000 && n < 1000000,
    format: (n) => Math.round(n).toLocaleString('en-US'),
  },
  {
    key: 'debt',
    defaultUrl: 'https://tradingeconomics.com/brazil/government-debt-to-gdp',
    prompt: 'This page shows Brazil government debt as a percentage of GDP. Find the current value. It will be a number like 79.0 or 88.5. Return ONLY the number — no percent sign, no other text.',
    validate: (n) => n > 30 && n < 200,
    format: (n) => `${n.toFixed(1)}%`,
  },
  {
    key: 'unemp',
    defaultUrl: 'https://tradingeconomics.com/brazil/unemployment-rate',
    prompt: 'This page shows Brazil unemployment rate data. Find the current unemployment rate. It will be a number like 5.6 or 7.0. Return ONLY the number — no percent sign, no other text.',
    validate: (n) => n > 0 && n < 30,
    format: (n) => `${n.toFixed(1)}%`,
  },
];

async function jinaFetch(url) {
  const resp = await fetch(`https://r.jina.ai/${url}`, {
    headers: { Accept: 'text/plain', 'X-Return-Format': 'text' },
    signal: AbortSignal.timeout(40000),
  });
  if (!resp.ok) throw new Error(`Jina HTTP ${resp.status}`);
  return resp.text();
}

async function extractWithHaiku(prompt, pageText, apiKey) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 32,
      messages: [{
        role: 'user',
        content: `${prompt}\n\n---BEGIN PAGE---\n${pageText.slice(0, 5000)}\n---END PAGE---\n\nReturn ONLY the number, nothing else.`,
      }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`Anthropic HTTP ${resp.status}`);
  const data = await resp.json();
  return data.content[0].text.trim();
}

exports.handler = async (event) => {
  if (event.headers['x-refresh-token'] !== process.env.REFRESH_TOKEN) {
    console.log('Auth failed — bad token');
    return { statusCode: 401 };
  }
  console.log('Auth passed');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set');
    return { statusCode: 500 };
  }
  console.log('API key present, starting fetches');

  let store;
  try {
    store = getStore('dashboard');
    console.log('Blobs store initialised');
  } catch (err) {
    console.error('Blobs init failed:', err.message);
    return { statusCode: 500 };
  }

  const settings = (await store.get('settings', { type: 'json' }).catch(() => null)) || {};

  const results = await Promise.allSettled(
    METRICS.map(async (metric) => {
      const url = settings[metric.key] || metric.defaultUrl;
      console.log(`[${metric.key}] fetching ${url}`);
      const pageText = await jinaFetch(url);
      console.log(`[${metric.key}] Jina OK, ${pageText.length} chars`);
      const extracted = await extractWithHaiku(metric.prompt, pageText, apiKey);
      console.log(`[${metric.key}] Haiku returned: "${extracted}"`);
      const raw = parseFloat(extracted.replace(/[,%$\s]/g, ''));
      if (isNaN(raw) || !metric.validate(raw)) {
        throw new Error(`Validation failed: "${extracted}" → ${raw}`);
      }
      return { key: metric.key, value: metric.format(raw), raw, error: null };
    })
  );

  const snapshot = {
    lastUpdated: new Date().toISOString(),
    data: {},
  };

  results.forEach((result, i) => {
    const key = METRICS[i].key;
    if (result.status === 'fulfilled') {
      console.log(`[${key}] success: ${result.value.value}`);
      snapshot.data[key] = result.value;
    } else {
      console.error(`[${key}] failed: ${result.reason.message}`);
      snapshot.data[key] = { key, value: null, raw: null, error: result.reason.message };
    }
  });

  // Preserve previous snapshot for rollback
  try {
    const prev = await store.get('snapshot').catch(() => null);
    if (prev) await store.set('snapshot-previous', prev).catch(() => null);
    await store.set('snapshot', JSON.stringify(snapshot));
    console.log('Snapshot written to Blobs OK');
  } catch (err) {
    console.error('Blobs write failed:', err.message);
  }

  return { statusCode: 200 };
};
