/**
 * @name PlatformIndicators
 * @version 1.0.1
 * @description Adds platform indicators (Desktop, Mobile, Web...) to users
 * @author kemo, TheSun, Nuckyz, Ven (Vencord), BetterDiscord port
 * @source https://github.com/hello23113/betterdiscord-vencord-port
 * @website https://github.com/hello23113/betterdiscord-vencord-port
 * @updateUrl https://raw.githubusercontent.com/hello23113/betterdiscord-vencord-port/main/PlatformIndicators.plugin.js
 */

const NAME = "PlatformIndicators";
const MOBILE_PATCH = NAME + "-colorMobileIndicator";

// Same options, wording and defaults as Vencord's definePluginSettings
const SETTINGS = [
    {type: "switch", id: "list", name: "List", note: "Show indicators in the member list", value: true},
    {type: "switch", id: "badges", name: "Badges", note: "Show indicators in user profiles, as badges", value: true},
    {type: "switch", id: "messages", name: "Messages", note: "Show indicators inside messages", value: true},
    {type: "switch", id: "colorMobileIndicator", name: "Color mobile indicator", note: "Whether to make the mobile indicator match the color of the user status.", value: true},
];

// style.css verbatim, then the MemberListDecorators / MessageDecorations API styles Vencord wraps decorators in
const CSS = `
.vc-platform-indicator {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    vertical-align: top;
    position: relative;
}
.vc-member-list-decorators-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25em;
}
.vc-member-list-decorators-wrapper:not(:empty) {
    margin-left: 0.25em;
}
[class*="withDisplayNameStyles"] [class^="name"] {
    flex: initial;
}
.vc-message-decorations-wrapper {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25em;
}
.vc-message-decorations-wrapper:not(:empty) {
    margin-left: 0.25em;
    position: relative;
    vertical-align: top;
    top: 0.1rem;
    height: calc(1rem + 4px);
    max-height: calc(1rem + 4px);
}
.vc-pi-badges { display: contents; }
`;

const FALLBACK_COLORS = {online: "#23a55a", idle: "#f0b232", dnd: "#f23f43", offline: "#80848e"};

const platformMap = {
    embedded: "Embedded (Console or Game)",
    vr: "VR",
};

const h = (...a) => BdApi.React.createElement(...a);
let S = {}; // Discord stores / functions, filled in start()

const Icons = {
    desktop: Icon("M4 2.5c-1.103 0-2 .897-2 2v11c0 1.104.897 2 2 2h7v2H7v2h10v-2h-4v-2h7c1.103 0 2-.896 2-2v-11c0-1.103-.897-2-2-2H4Zm16 2v9H4v-9h16Z"),
    web: Icon("M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93Zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39Z"),
    mobile: Icon("M 187 0 L 813 0 C 916.277 0 1000 83.723 1000 187 L 1000 1313 C 1000 1416.277 916.277 1500 813 1500 L 187 1500 C 83.723 1500 0 1416.277 0 1313 L 0 187 C 0 83.723 83.723 0 187 0 Z M 125 1000 L 875 1000 L 875 250 L 125 250 Z M 500 1125 C 430.964 1125 375 1180.964 375 1250 C 375 1319.036 430.964 1375 500 1375 C 569.036 1375 625 1319.036 625 1250 C 625 1180.964 569.036 1125 500 1125 Z", {viewBox: "0 0 1000 1500", height: 17, width: 17}),
    embedded: Icon("M3.06 20.4q-1.53 0-2.37-1.065T.06 16.74l1.26-9q.27-1.8 1.605-2.97T6.06 3.6h11.88q1.8 0 3.135 1.17t1.605 2.97l1.26 9q.21 1.53-.63 2.595T20.94 20.4q-.63 0-1.17-.225T18.78 19.5l-2.7-2.7H7.92l-2.7 2.7q-.45.45-.99.675t-1.17.225Zm14.94-7.2q.51 0 .855-.345T19.2 12q0-.51-.345-.855T18 10.8q-.51 0-.855.345T16.8 12q0 .51.345 .855T18 13.2Zm-2.4-3.6q.51 0 .855-.345T16.8 8.4q0-.51-.345-.855T15.6 7.2q-.51 0-.855.345T14.4 8.4q0 .51.345 .855T15.6 9.6ZM6.9 13.2h1.8v-2.1h2.1v-1.8h-2.1v-2.1h-1.8v2.1h-2.1v1.8h2.1v2.1Z", {viewBox: "0 0 24 24", height: 20, width: 20}),
    vr: Icon("M8.46 8.64a1 1 0 0 1 1 1c0 .44-.3.8-.72.92l-.11.07c-.08.06-.2.19-.2.41a.99.99 0 0 1-.98.86h-.06a1 1 0 0 1-.94-1.05l.02-.32c.05-1.06.92-1.9 1.99-1.9ZM15.55 5a5.5 5.5 0 0 1 5.15 3.67h.3a2 2 0 0 1 2 2v3.18a2 2 0 0 1-2 1.99h-.2A4.54 4.54 0 0 1 16.55 19a4.45 4.45 0 0 1-3.6-1.83 1.2 1.2 0 0 0-1.9 0 4.44 4.44 0 0 1-3.9 1.82 4.54 4.54 0 0 1-3.94-3.15H3a2 2 0 0 1-2-2v-3.18c0-1.1.9-1.99 2-1.99h.3A5.5 5.5 0 0 1 8.46 5h7.09Zm-7.1 2C6.6 7 5.06 8.5 4.97 10.41l-.02.66v3.18c0 1.43 1.05 2.66 2.34 2.74.85.06 1.63-.32 2.14-1.01a3.2 3.2 0 0 1 2.57-1.3c1 0 1.97.48 2.57 1.3.5.69 1.3 1.08 2.14 1.01 1.3-.08 2.34-1.31 2.34-2.74l-.02-3.84a3.54 3.54 0 0 0-3.49-3.43H8.45Z", {viewBox: "0 4 24 16", height: 20, width: 20}),
};

const NoTooltip = ({children}) => children({});

function Icon(path, opts) {
    return ({color, tooltip, small}) => h(BdApi.Components.Tooltip ?? NoTooltip, {text: tooltip}, tooltipProps =>
        h("svg", {
            ...tooltipProps,
            height: (opts?.height ?? 20) - (small ? 3 : 0),
            width: (opts?.width ?? 20) - (small ? 3 : 0),
            viewBox: opts?.viewBox ?? "0 0 24 24",
            fill: color,
        }, h("path", {d: path})));
}

function getPlatformTooltip(platform) {
    return platformMap[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
}

// Discord's useStatusFillColor is a hook; S.useStatusFillColor never changes while running, so hook order is stable
function useStatusFillColor(status) {
    return S.useStatusFillColor ? S.useStatusFillColor(status) : FALLBACK_COLORS[status] ?? FALLBACK_COLORS.offline;
}

function PlatformIcon({platform, status, small}) {
    const tooltip = getPlatformTooltip(platform);
    const Icon = Icons[platform] ?? Icons.desktop;
    return h(Icon, {color: useStatusFillColor(status), tooltip, small});
}

function getOwnStatus() {
    const sessions = S.SessionsStore.getSessions();
    if (typeof sessions !== "object" || !sessions) return null;

    const sortedSessions = Object.values(sessions).sort(({status: a}, {status: b}) => {
        if (a === b) return 0;
        if (a === "online") return 1;
        if (b === "online") return -1;
        if (a === "idle") return 1;
        if (b === "idle") return -1;
        return 0;
    });

    return Object.values(sortedSessions).reduce((acc, curr) => {
        if (curr.clientInfo.client !== "unknown")
            acc[curr.clientInfo.client] = curr.status;
        return acc;
    }, {});
}

// badge: Vencord's ProfileBadge getBadges(), one <span class="vc-platform-indicator"> per platform
function PlatformIndicators({statusMap, small, badge}) {
    const entries = Object.entries(statusMap);
    if (badge) return entries.map(([platform, status]) =>
        h("span", {key: platform, className: "vc-platform-indicator"}, h(PlatformIcon, {platform, status, small: false})));

    const icons = entries.map(([platform, status]) => h(PlatformIcon, {key: platform, platform, status, small}));
    if (!icons.length) return null;
    return h("span", {className: "vc-platform-indicator", style: {gap: "2px"}}, icons);
}

function renderPlatformIndicators(user, small, badge = false) {
    if (!user || user.bot) return null;
    if (user.id === S.AuthenticationStore.getId()) return h(CurrentUserPlatformIndicators, {small, badge});
    return h(OtherUserPlatformIndicators, {user, small, badge});
}

function CurrentUserPlatformIndicators({small, badge}) {
    const statusMap = BdApi.Hooks.useStateFromStores([S.SessionsStore], getOwnStatus);
    return statusMap ? h(PlatformIndicators, {statusMap, small, badge}) : null;
}

function OtherUserPlatformIndicators({user, small = false, badge}) {
    const statusMap = BdApi.Hooks.useStateFromStores([S.PresenceStore], () => S.PresenceStore.getClientStatus(user.id));
    return statusMap ? h(PlatformIndicators, {statusMap, small, badge}) : null;
}

// Vencord wraps every decorator/badge in an ErrorBoundary with noop: render nothing on error
class Boundary extends BdApi.React.Component {
    state = {failed: false};
    static getDerivedStateFromError() { return {failed: true}; }
    componentDidCatch(e) { console.error(`[${NAME}] render failed`, e); }
    render() { return this.state.failed ? null : this.props.children; }
}

// Walks up the React fiber from a DOM node until pick(props) returns something other than undefined
function fiberProp(el, pick) {
    let f = BdApi.ReactUtils.getInternalInstance(el);
    for (let i = 0; f && i < 30; i++, f = f.return) {
        const p = f.memoizedProps;
        if (p && typeof p === "object") {
            const r = pick(p);
            if (r !== undefined) return r;
        }
    }
    return null;
}

// Where Vencord's APIs render, found in the DOM. Selectors and fiber prop names are Discord internals.
const LOCATIONS = {
    // MemberListDecorators: guild member list (props.user) and DM list (PrivateChannel props.user), right after the name
    list: {
        selector: '[class*="members_"] [class*="nameAndDecorators"], [class*="privateChannels"] [class*="nameAndDecorators"]',
        getUser: el => fiberProp(el, p => "user" in p ? p.user ?? null : undefined), // group DMs carry user: undefined
        tag: "div", className: "vc-member-list-decorators-wrapper",
        place: (host, box) => host.firstElementChild ? host.firstElementChild.after(box) : host.append(box),
        render: user => renderPlatformIndicators(user, true),
    },
    // MessageDecorations: after the author name in the message header (not in reply previews)
    messages: {
        selector: '[class*="headerText"]',
        // only the header component (props usernameSpanId): forward/embed/card headerTexts inside a message would also reach props.message
        getUser: el => el.closest('[class*="repliedMessage"]') ? null : fiberProp(el, p => "usernameSpanId" in p ? p.message?.author ?? null : undefined),
        tag: "div", className: "vc-message-decorations-wrapper",
        place: (host, box) => host.append(box),
        render: user => renderPlatformIndicators(user, false),
    },
    // ProfileBadge with BadgePosition.START: the badge list is the `trailing` of the profile's username row
    badges: {
        selector: '[class*="usernameAndPronounsRow_"] [class*="container_"]',
        getUser: el => {
            if (el.parentElement?.closest(LOCATIONS.badges.selector)) return null; // only the outermost match
            if (el.previousElementSibling?.className === el.className) return null; // badges are chunked into sibling rows: first row only
            // the badge list component ({badges, displayProfile}); other containers in the row (guild tag...) don't have it
            const id = fiberProp(el, p => Array.isArray(p.badges) && "displayProfile" in p ? p.displayProfile?.userId ?? null : undefined);
            return id ? S.UserStore.getUser(id) : null;
        },
        tag: "span", className: "vc-pi-badges",
        place: (host, box) => host.prepend(box),
        render: user => renderPlatformIndicators(user, false, true),
    },
};

module.exports = class PlatformIndicators {
    start() {
        const W = BdApi.Webpack;
        this.settings = Object.fromEntries(SETTINGS.map(s => [s.id, s.value]));
        Object.assign(this.settings, BdApi.Data.load(NAME, "settings"));

        S = {
            PresenceStore: W.getStore("PresenceStore"),
            SessionsStore: W.getStore("SessionsStore"),
            AuthenticationStore: W.getStore("AuthenticationStore"),
            UserStore: W.getStore("UserStore"),
            mask: {},
        };
        try {
            // Vencord: mapMangledModuleLazy([".5625*", "translate"], {useStatusFillColor: byCode(".hex")}); same module holds the status mask helpers
            const F = W.Filters;
            S.mask = W.getMangled([".5625*", "translate"], {
                useStatusFillColor: F.byStrings(".hex"),
                getStatusMask: F.byStrings("STATUS_ONLINE_MOBILE", "STATUS_TYPING"),
                getStatusSize: F.byStrings("width:2.5*"),
            }) || {};
        } catch (e) { console.warn(`[${NAME}] status color module not found, using fixed colors`, e); }
        S.useStatusFillColor = S.mask.useStatusFillColor;
        if (!S.PresenceStore || !S.SessionsStore || !S.AuthenticationStore || !S.UserStore)
            return BdApi.UI.showToast(NAME + ": Discord internals not found, plugin inactive", {type: "error"});

        this.entries = new Map(); // host element -> {kind, id, box, root}; box null = host has no user. Null while inactive.
        BdApi.DOM.addStyle(NAME, CSS);
        this.patchMobile();
        this.observer = new MutationObserver(() => this.scheduleRefresh());
        this.observer.observe(document.body, {childList: true, subtree: true});
        this.scheduleRefresh();
    }

    stop() {
        BdApi.Patcher.unpatchAll(MOBILE_PATCH);
        try { S.PresenceStore?.emitChange?.(); } catch (_) {} // avatars re-read the unpatched isMobileOnline
        this.observer?.disconnect();
        this.observer = null;
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        for (const host of [...(this.entries?.keys() || [])]) this.drop(host);
        this.entries = null;
        BdApi.DOM.removeStyle(NAME);
    }

    getSettingsPanel() {
        return BdApi.UI.buildSettingsPanel({
            settings: SETTINGS.map(s => ({...s, value: this.settings[s.id]})),
            onChange: (_, id, value) => {
                this.settings[id] = value;
                BdApi.Data.save(NAME, "settings", this.settings);
                if (!this.entries) return;
                if (id === "colorMobileIndicator") this.patchMobile();
                this.scheduleRefresh();
            },
        });
    }

    // Vencord's three colorMobileIndicator regex patches, as far as exported functions allow
    patchMobile() {
        BdApi.Patcher.unpatchAll(MOBILE_PATCH);
        const P = S.PresenceStore, M = S.mask;
        if (this.settings.colorMobileIndicator) {
            // "}isMobileOnline(": `[MOBILE]===ONLINE` -> `!= null`; the rest is Discord's own isMobileOnline body
            if (typeof P.isMobileOnline === "function") BdApi.Patcher.instead(MOBILE_PATCH, P, "isMobileOnline", (self, args, orig) => {
                try {
                    const cs = P.getClientStatus(args[0]);
                    return cs != null && cs.mobile != null && cs.desktop !== "online" && cs.vr !== "online";
                } catch (e) { return orig.apply(self, args); }
            });
            // ".Masks.STATUS_ONLINE_MOBILE": return the mobile mask for a mobile user whatever the status
            if (typeof M.getStatusMask === "function") BdApi.Patcher.instead(MOBILE_PATCH, M, "getStatusMask", (self, args, orig) =>
                args[1]?.isMobile ? orig.call(self, "online", ...args.slice(1)) : orig.apply(self, args));
            // ".AVATAR_STATUS_MOBILE_16;": size the status as mobile-online when isMobile
            if (typeof M.getStatusSize === "function") BdApi.Patcher.instead(MOBILE_PATCH, M, "getStatusSize", (self, args, orig) =>
                args[2]?.isMobile ? orig.call(self, args[0], "online", ...args.slice(2)) : orig.apply(self, args));
        }
        try { P.emitChange?.(); } catch (_) {} // re-render avatars now instead of on the next presence update
    }

    // ---------- DOM layer (Vencord's decorator / badge API patches) ----------

    scheduleRefresh() {
        if (this.raf) return;
        this.raf = requestAnimationFrame(() => { this.raf = 0; try { this.refresh(); } catch (e) { console.error(`[${NAME}] refresh`, e); } });
    }

    refresh() {
        for (const [kind, loc] of Object.entries(LOCATIONS)) {
            if (!this.settings[kind]) continue;
            for (const host of document.querySelectorAll(loc.selector)) {
                try {
                    // re-read the user every time: React can re-render the same DOM node for another user (profile panels)
                    const user = loc.getUser(host);
                    const cur = this.entries.get(host);
                    if (cur && cur.id === user?.id && (!cur.box || (cur.box.isConnected && cur.box.parentElement === host))) continue;
                    this.inject(kind, loc, host, user);
                } catch (e) { console.error(`[${NAME}] ${kind}`, e); }
            }
        }
        for (const [host, e] of this.entries)
            if (!host.isConnected || (e.box && !e.box.isConnected) || !this.settings[e.kind]) this.drop(host);
    }

    // a fresh root per user: BD's useStateFromStores without deps keeps the first user's value until a store changes
    inject(kind, loc, host, user) {
        this.drop(host);
        if (!user) return this.entries.set(host, {kind, box: null});
        const box = document.createElement(loc.tag);
        box.className = loc.className;
        loc.place(host, box);
        const root = BdApi.ReactDOM.createRoot(box);
        this.entries.set(host, {kind, id: user.id, box, root});
        root.render(h(Boundary, null, loc.render(user)));
    }

    drop(host) {
        const e = this.entries.get(host);
        if (!e) return;
        this.entries.delete(host);
        try { e.root?.unmount(); } catch (_) {}
        e.box?.remove();
    }
};
