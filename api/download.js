// Vercel serverless function: streams a Venus download over https.
//
// The build files are served from a plain http:// host with no TLS. A
// direct link from an https:// page works for a top-level navigation, but
// it still leaves the secure origin and can trip browser warnings. This
// endpoint fetches server-side and streams the bytes back over https.
//
//   GET /api/download/external   -> Loader.exe
//
// The file is streamed rather than buffered so a large binary never has
// to fit in memory.

const http = require('http');

// Pull the trailing path segment, e.g. /api/download/external -> "external".
// Vercel exposes this as req.query.slug, but that is not reliably populated
// for plain Node functions, so parse the URL directly as well.
function pathSlug(req) {
    if (req.query && req.query.slug !== undefined) {
        const v = req.query.slug;
        const one = Array.isArray(v) ? v[0] : v;
        if (one) return one;
    }
    const path = (req.url || '').split('?')[0].replace(/\/+$/, '');
    const i = path.lastIndexOf('/');
    return i === -1 ? '' : path.slice(i + 1);
}

const FILES = {
    external: {
        url: 'http://paloma.hidencloud.com:24617/cdn/Loader.exe',
        name: 'Venus-External-Loader.exe'
    }
};

module.exports = (req, res) => {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'method not allowed' });
    }

    // /api/download/<key>
    const key = pathSlug(req);
    const file = FILES[key];

    if (!file) {
        return res.status(404).json({
            error: 'unknown download',
            valid: Object.keys(FILES)
        });
    }

    const upstream = http.get(file.url, { timeout: 30000 }, (up) => {
        // Pass through an upstream failure instead of pretending to serve.
        if (up.statusCode < 200 || up.statusCode >= 300) {
            up.resume();
            return res.status(502).json({ error: 'upstream unavailable', status: up.statusCode });
        }

        res.setHeader('Content-Type', up.headers['content-type'] || 'application/octet-stream');
        // Only forward a real length; an empty value would be an invalid
        // header and break the response.
        if (up.headers['content-length']) {
            res.setHeader('Content-Length', up.headers['content-length']);
        }
        res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
        // Executable: stop the browser or any intermediary caching it.
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');

        up.pipe(res);
    });

    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => {
        if (!res.headersSent) {
            res.status(502).json({ error: 'upstream unreachable' });
        } else {
            res.end();
        }
    });
};
