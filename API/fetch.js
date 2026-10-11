/* ============================================================
   Venus API helper
   Fetches build data for the Executor (Internal) and External.
   ============================================================ */
(function (global) {
    'use strict';

    // Build endpoints
    var ENDPOINTS = {
        // The executor
        Internal: 'http://paloma.hidencloud.com:24617/api/fetch/Internal',
        // The external
        External: 'http://paloma.hidencloud.com:24617/api/fetch/External'
    };

    // Discord Server Widget JSON API
    var DISCORD_WIDGET = 'https://discord.com/api/guilds/1558510242864566473/widget.json';

    var DEFAULT_INVITE = 'https://discord.gg/xmVuuRhWQP';

    /**
     * Pull the raw JSON for a build.
     * @param {'Internal'|'External'} type
     * @returns {Promise<object|null>}
     */
    function fetchBuild(type) {
        var url = ENDPOINTS[type];
        if (!url) return Promise.resolve(null);

        return fetch(url, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; });
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
