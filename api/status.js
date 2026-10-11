// Vercel serverless function: proxies the Venus build API.
//
// Why this exists: the upstream API is plain http:// on a non-standard
// port and has no TLS listener. The website is served over https://, so
// fetching it directly from the browser is blocked as mixed content.
// Proxying it server-side keeps every browser request on HTTPS.
//
//   GET /api/status?build=Internal   -> executor build JSON
//   GET /api/status?build=External   -> external build JSON
//   GET /api/status                  -> both builds in one response

const http = require('http');

const ENDPOINTS = {
    Internal: 'http://paloma.hidencloud.com:24617/api/fetch/Internal',
    External: 'http://paloma.hidencloud.com:24617/api/fetch/External'
};

// Fetch one upstream URL over plain HTTP, with a hard timeout.
function fetchUpstream(url) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: 8000 }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return resolve({ ok: false, status: res.statusCode });
                }
                try {
                    resolve({ ok: true, data: JSON.parse(body) });
                } catch (e) {
                    resolve({ ok: false, status: 'bad-json' });
                }
            });
        });

        req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 'timeout' }); });
        req.on('error', () => { resolve({ ok: false, status: 'error' }); });
    });
}

// Read a query value off the raw URL. Vercel's runtime does not always
// populate req.query for plain Node functions, so parse it ourselves.
function queryParam(req, name) {
    // Prefer req.query when the platform did populate it.
    if (req.query && req.query[name] !== undefined) {
        const v = req.query[name];
        return Array.isArray(v) ? v[0] : v;
    }
    if (!req.url) return undefined;
    const qs = req.url.split('?')[1];
    if (!qs) return undefined;
    for (const pair of qs.split('&')) {
        const eq = pair.indexOf('=');
        const key = eq === -1 ? pair : pair.slice(0, eq);
        if (key === name) {
            const raw = eq === -1 ? '' : pair.slice(eq + 1);
            try { return decodeURIComponent(raw.replace(/\+/g, ' ')); }
            catch (e) { return raw; }
        }
    }
    return undefined;
}

module.exports = async (req, res) => {
    // Only GET makes sense here.
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'method not allowed' });
    }

    // Same-origin endpoint, but allow cross-origin just in case.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

    const build = queryParam(req, 'build') || '';

    // Unknown build name -> return everything.
    if (build && !Object.prototype.hasOwnProperty.call(ENDPOINTS, build)) {
        return res.status(400).json({ error: 'unknown build', valid: Object.keys(ENDPOINTS) });
    }

    const keys = build ? [build] : Object.keys(ENDPOINTS);
    const results = await Promise.all(
        keys.map(async (key) => {
            const r = await fetchUpstream(ENDPOINTS[key]);
            return { key, ok: r.ok, data: r.ok ? r.data : null, status: r.status };
        })
    );

    // Single-build request -> return that build's payload flat.
    if (build) {
        const only = results[0];
        // Short cache: the site polls every 30s, and upstream data is
        // versioned, so a little CDN caching is safe and cuts load.
        res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
        if (!only.ok) {
            return res.status(502).json({ error: 'upstream unavailable', status: only.status });
        }
        return res.status(200).json(only.data);
    }

    // Multi-build request -> { Internal: {...}, External: {...} }
    const out = {};
    results.forEach((r) => {
        out[r.key] = r.ok ? r.data : null;
    });
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    return res.status(200).json(out);
};
