// Vercel serverless function: serves Venus downloads over https.
//
// Route: /api/download/<product>   (catch-all, via api/download/[...slug].js)
//   /api/download/external   -> Loader.exe
//
// Why this exists: the build files are served from a plain http:// host with
// no TLS. Opening that URL from an https:// page makes Chrome abort the
// request (ERR_FAILED) as an insecure download - the tab opens and nothing
// is saved. Filing it through this endpoint keeps the transfer on https, so
// the browser accepts it.
//
// The bytes are passed through untouched. This endpoint only changes the
// transport scheme; it never modifies, re-signs or re-packs the file. The
// upstream name (Loader.exe) is preserved so the download is identical to
// fetching the URL directly.
//
// The body is buffered rather than streamed so Content-Length is always
// exact and a truncated response can never be mistaken for a complete .exe.

const http = require('http');

// Cap the buffer so a misbehaving upstream can't exhaust function memory.
// The loader is ~450 KB, so 25 MB is a very generous ceiling.
const MAX_BYTES = 25 * 1024 * 1024;

const FILES = {
    external: {
        url: 'http://paloma.hidencloud.com:24617/cdn/Loader.exe',
        // Keep the upstream filename so the saved file matches a direct fetch.
        name: 'Loader.exe'
    }
};

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

// Fetch the whole upstream body into a Buffer, with a size cap.
function fetchBuffer(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout: 60000 }, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                return reject(new Error('upstream status ' + res.statusCode));
            }

            const chunks = [];
            let total = 0;

            res.on('data', (chunk) => {
                total += chunk.length;
                if (total > MAX_BYTES) {
                    req.destroy();
                    return reject(new Error('upstream too large'));
                }
                chunks.push(chunk);
            });

            res.on('end', () => resolve(Buffer.concat(chunks, total)));
            res.on('error', reject);
        });

        req.on('timeout', () => req.destroy(new Error('upstream timeout')));
        req.on('error', reject);
    });
}

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'method not allowed' });
    }

    const key = pathSlug(req);
    const file = FILES[key];

    if (!file) {
        return res.status(404).json({
            error: 'unknown download',
            valid: Object.keys(FILES)
        });
    }

    let buf;
    try {
        buf = await fetchBuffer(file.url);
    } catch (e) {
        return res.status(502).json({ error: 'upstream unavailable', detail: e.message });
    }

    // attachment + filename is what actually makes the browser save the file
    // rather than trying to render it.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    // Executable: never let a browser or intermediary cache it.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Lets anyone verify the served bytes match the upstream file.
    res.setHeader('X-Content-SHA256', require('crypto').createHash('sha256').update(buf).digest('hex'));

    return res.status(200).end(buf);
};
