/* ============================================================
   Venus API helper
   Fetches build data for the Executor (Internal) and External.
   ============================================================ */
(function (global) {
    'use strict';

    // Proxied endpoints served by the serverless function in /api.
    //
    // The upstream API is plain http:// with no TLS, so a browser on an
    // https:// page cannot call it directly (mixed content). These are
    // same-origin https paths, so they are always safe to fetch.
    var PROXY_ENDPOINTS = {
        Internal: '/api/status?build=Internal',
        External: '/api/status?build=External'
    };

    // Direct upstream URLs. Only reachable when the page itself is served
    // over plain http (e.g. local testing); used as a fallback.
    var DIRECT_ENDPOINTS = {
        Internal: 'http://paloma.hidencloud.com:24617/api/fetch/Internal',
        External: 'http://paloma.hidencloud.com:24617/api/fetch/External'
    };

    // Use the proxy whenever the page is on https (production). On plain
    // http the direct upstream works fine and avoids needing a server.
    var ENDPOINTS = (typeof location !== 'undefined' && location.protocol === 'https:')
        ? PROXY_ENDPOINTS
        : DIRECT_ENDPOINTS;

    // Discord Server Widget JSON API
    var DISCORD_WIDGET = 'https://discord.com/api/guilds/1558510242864566473/widget.json';

    var DEFAULT_INVITE = 'https://discord.gg/xmVuuRhWQP';

    // Direct download links per product. Anything left null falls back to
    // the Discord invite, since that is where builds are handed out.
    var DOWNLOADS = {
        // No direct link for the executor yet -> use Discord.
        Executor: null,
        // The external ships as a loader.
        External: 'http://paloma.hidencloud.com:24617/cdn/Loader.exe'
    };

    // Same files served over https through the download proxy, so an
    // https:// page never has to hand a file off to a plain http:// host.
    var PROXIED_DOWNLOADS = {
        Executor: null,
        External: '/api/download/external'
    };

    /**
     * Resolve the download URL for a product, preferring the https proxy
     * when the page itself is served over https.
     * @param {string} product
     * @returns {string}
     */
    function downloadUrl(product) {
        var onHttps = typeof location !== 'undefined' && location.protocol === 'https:';
        var proxied = onHttps ? PROXIED_DOWNLOADS[product] : null;
        return proxied || DOWNLOADS[product] || DEFAULT_INVITE;
    }

    // Fetch a URL and parse JSON, resolving null on any failure.
    function getJSON(url) {
        return fetch(url, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; });
    }

    /**
     * Pull the raw JSON for a build.
     *
     * Tries the configured endpoint first, then falls back to the other
     * one, so a broken proxy or a blocked direct call still resolves.
     *
     * @param {'Internal'|'External'} type
     * @returns {Promise<object|null>}
     */
    function fetchBuild(type) {
        var primary = ENDPOINTS[type];
        if (!primary) return Promise.resolve(null);

        // The endpoint not currently selected is the natural fallback.
        var isProxy = ENDPOINTS === PROXY_ENDPOINTS;
        var pool = isProxy ? DIRECT_ENDPOINTS : PROXY_ENDPOINTS;
        var fallback = pool[type];

        return getJSON(primary).then(function (data) {
            if (data) return data;
            return fallback ? getJSON(fallback) : null;
        });
    }

    /**
     * The exploit is Operational when the latest build matches the
     * supported build, otherwise it is Down.
     * @param {object|null} data
     * @returns {{online:boolean, label:string}}
     */
    function getStatus(data) {
        if (!data || !data.latest || !data.supported) {
            return { online: false, label: 'Unknown' };
        }
        var online = data.latest === data.supported;
        return { online: online, label: online ? 'Operational' : 'Down' };
    }

    /**
     * Flatten the changelog object into a plain list of strings for
     * the current version.
     * @param {object|null} data
     * @returns {string[]}
     */
    function getChangelogs(data) {
        if (!data || !data.changelogs) return [];

        var version = data.version;
        var logs = data.changelogs[version];

        // Fallback: newest version listed if the current one is missing
        if (!Array.isArray(logs)) {
            var keys = Object.keys(data.changelogs);
            if (!keys.length) return [];
            logs = data.changelogs[keys[keys.length - 1]];
        }

        return Array.isArray(logs) ? logs.slice() : [];
    }

    /**
     * Supported Roblox build, derived from the build id.
     * @param {object|null} data
     * @returns {string}
     */
    function getSupportedBuild(data) {
        return (data && (data.supported || data.latest)) || '';
    }

    /**
     * Members currently online, from the Discord server widget.
     * Note: Discord's widget only exposes online members, never the
     * total roster, so this is an "online now" figure.
     * @returns {Promise<number|null>}
     */
    function fetchMembers() {
        return fetch(DISCORD_WIDGET, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (!d) return null;
                if (typeof d.presence_count === 'number') return d.presence_count;
                return d.members && d.members.length ? d.members.length : null;
            })
            .catch(function () { return null; });
    }

    /**
     * Load every build at once.
     * @returns {Promise<{Internal:object|null, External:object|null}>}
     */
    function fetchAll() {
        return Promise.all([fetchBuild('Internal'), fetchBuild('External')])
            .then(function (res) {
                return { Internal: res[0], External: res[1] };
            });
    }

    var api = {
        ENDPOINTS: ENDPOINTS,
        DISCORD_WIDGET: DISCORD_WIDGET,
        DEFAULT_INVITE: DEFAULT_INVITE,
        DOWNLOADS: DOWNLOADS,
        downloadUrl: downloadUrl,
        fetchBuild: fetchBuild,
        fetchAll: fetchAll,
        getStatus: getStatus,
        getChangelogs: getChangelogs,
        getSupportedBuild: getSupportedBuild,
        fetchMembers: fetchMembers
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    global.VenusAPI = api;
})(typeof window !== 'undefined' ? window : this);
