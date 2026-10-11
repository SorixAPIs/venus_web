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

    // /api/download/<key>  (Vercel gives us the tail via req.query.slug)
    const key = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
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
        res.setHeader('Content-Length', up.headers['content-length'] || '');
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
