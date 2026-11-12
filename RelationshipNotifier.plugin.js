/**
 * @name RelationshipNotifier
 * @version 1.1.3
 * @description Notifies you when a friend, group chat, or server removes you. BetterDiscord port of the Vencord plugin of the same name.
 * @author nick (Vencord), BetterDiscord port
 * @source https://github.com/hello23113/betterdiscord-vencord-port
 * @website https://github.com/hello23113/betterdiscord-vencord-port
 * @updateUrl https://raw.githubusercontent.com/hello23113/betterdiscord-vencord-port/main/RelationshipNotifier.plugin.js
 */

const NAME = "RelationshipNotifier";
const RelationshipType = {FRIEND: 1, BLOCKED: 2, INCOMING_REQUEST: 3, OUTGOING_REQUEST: 4};
const GROUP_DM = 3;

// Same options, wording and defaults as the Vencord settings.ts
const SETTINGS = [
    {id: "notices", value: false, name: "Notices", note: "Also show a notice at the top of your screen when removed (use this if you don't want to miss any notifications)."},
    {id: "offlineRemovals", value: true, name: "Offline removals", note: "Notify you when starting discord if you were removed while offline."},
    {id: "friends", value: true, name: "Friends", note: "Notify when a friend removes you"},
    {id: "friendRequestCancels", value: true, name: "Friend request cancels", note: "Notify when a friend request is cancelled"},
    {id: "servers", value: true, name: "Servers", note: "Notify when removed from a server"},
    {id: "groups", value: true, name: "Groups", note: "Notify when removed from a group chat"},
];

module.exports = class RelationshipNotifier {
    start() {
        const W = BdApi.Webpack;
        this.settings = Object.fromEntries(SETTINGS.map(s => [s.id, s.value]));
        Object.assign(this.settings, BdApi.Data.load(NAME, "settings"));

        this.UserStore = W.getStore("UserStore");
        this.GuildStore = W.getStore("GuildStore");
        this.GuildMemberStore = W.getStore("GuildMemberStore");
        this.ChannelStore = W.getStore("ChannelStore");
        this.RelationshipStore = W.getStore("RelationshipStore");
        this.GuildAvailabilityStore = W.getStore("GuildAvailabilityStore") || {isUnavailable: () => false};
        this.UserUtils = W.getByKeys("getUser", "fetchCurrentUser");
        this.ProfileActions = W.getByKeys("openUserProfileModal");
        this.Dispatcher = this.ChannelStore?._dispatcher || W.getByKeys("dispatch", "subscribe", "_subscriptions");
        if (!this.Dispatcher || !this.UserStore) return BdApi.UI.showToast(NAME + ": Discord internals not found", {type: "error"});

        this.guilds = new Map();
        this.groups = new Map();
        this.friends = {friends: [], requests: []};
        this.manuallyRemovedFriend = this.manuallyRemovedGuild = this.manuallyRemovedGroup = undefined;

        // Vencord regex-patches these three actions to remember removals you did yourself; same idea via Patcher.before
        const patch = (mod, fn, cb) => {
            if (mod && typeof mod[fn] === "function") BdApi.Patcher.before(NAME, mod, fn, (_, args) => cb(args[0]));
            else console.warn(`[${NAME}] could not patch ${fn}; your own removals may notify too`);
        };
        patch(W.getByKeys("removeRelationship", "addRelationship"), "removeRelationship", id => this.manuallyRemovedFriend = id);
        patch(W.getByKeys("leaveGuild"), "leaveGuild", id => this.manuallyRemovedGuild = id);
        patch(W.getByKeys("closePrivateChannel"), "closePrivateChannel", id => this.manuallyRemovedGroup = id);

        this.flux = {
            GUILD_CREATE: () => this.syncGuilds(),
            GUILD_DELETE: e => this.onGuildDelete(e),
            CHANNEL_CREATE: () => this.syncGroups(),
            CHANNEL_DELETE: e => this.onChannelDelete(e),
            RELATIONSHIP_ADD: () => this.syncFriends(),
            RELATIONSHIP_UPDATE: () => this.syncFriends(),
            RELATIONSHIP_REMOVE: e => { this.onRelationshipRemove(e); this.syncFriends(); },
            CONNECTION_OPEN: () => this.syncAndRunChecks(),
        };
        for (const [ev, fn] of Object.entries(this.flux)) this.Dispatcher.subscribe(ev, fn);

        this.timer = setTimeout(() => this.syncAndRunChecks(), 5000);
    }

    stop() {
        clearTimeout(this.timer);
        BdApi.Patcher.unpatchAll(NAME);
        if (this.flux) for (const [ev, fn] of Object.entries(this.flux)) this.Dispatcher?.unsubscribe(ev, fn);
        this.flux = null;
        this.closeNotifications();
    }

    getSettingsPanel() {
        const h = BdApi.React.createElement;
        return h("div", null,
            BdApi.UI.buildSettingsPanel({
                settings: SETTINGS.map(s => ({type: "switch", ...s, value: this.settings[s.id]})),
                onChange: (_, id, value) => { this.settings[id] = value; BdApi.Data.save(NAME, "settings", this.settings); },
            }),
            // not in Vencord: lets you check notifications work without waiting for a real removal
            h("button", {
                className: "bd-button bd-button-filled bd-button-color-brand",
                style: {marginTop: 16, padding: "8px 16px"},
                onClick: () => {
                    const me = this.UserStore.getCurrentUser();
                    this.notify("This is a test notification.", avatar(me), () => this.openProfile(me.id));
                },
            }, "Send test notification"));
    }

    // ---------- functions.ts ----------

    async onRelationshipRemove({relationship: {type, id}}) {
        if (this.manuallyRemovedFriend === id) {
            this.manuallyRemovedFriend = undefined;
            return;
        }
        const user = await this.getUser(id);
        if (!user) return;

        switch (type) {
            case RelationshipType.FRIEND:
                if (this.settings.friends)
                    this.notify(`${uniqueName(user)} removed you as a friend.`, avatar(user), () => this.openProfile(user.id));
                break;
            case RelationshipType.INCOMING_REQUEST:
                if (this.settings.friendRequestCancels)
                    this.notify(`A friend request from ${uniqueName(user)} has been removed.`, avatar(user), () => this.openProfile(user.id));
                break;
        }
    }

    onGuildDelete({guild: {id, unavailable}}) {
        if (unavailable || this.GuildAvailabilityStore.isUnavailable(id)) return;

        // checked before the setting (unlike Vencord) so a leave while the toggle is off can't suppress a later kick
        if (this.manuallyRemovedGuild === id) {
            this.deleteGuild(id);
            this.manuallyRemovedGuild = undefined;
            return;
        }
        if (!this.settings.servers) return;
        const guild = this.guilds.get(id);
        if (guild) {
            this.deleteGuild(id);
            this.notify(`You were removed from the server ${guild.name}.`, guild.iconURL);
        }
    }

    onChannelDelete({channel: {id, type}}) {
        if (type !== GROUP_DM) return;

        if (this.manuallyRemovedGroup === id) { // before the setting, see onGuildDelete
            this.deleteGroup(id);
            this.manuallyRemovedGroup = undefined;
            return;
        }
        if (!this.settings.groups) return;
        const group = this.groups.get(id);
        if (group) {
            this.deleteGroup(id);
            this.notify(`You were removed from the group ${group.name}.`, group.iconURL);
        }
    }

    // ---------- utils.ts ----------

    key(kind) { return `relationship-notifier-${kind}-${this.UserStore.getCurrentUser().id}`; }

    async syncAndRunChecks() {
        if (this.UserStore.getCurrentUser() == null) return;

        const oldGuilds = toMap(BdApi.Data.load(NAME, this.key("guilds")));
        const oldGroups = toMap(BdApi.Data.load(NAME, this.key("groups")));
        const oldFriends = BdApi.Data.load(NAME, this.key("friends"));

        await Promise.all([this.syncGuilds(), this.syncGroups(), this.syncFriends()]);

        if (!this.settings.offlineRemovals) return;

        if (this.settings.groups && oldGroups.size) {
            for (const [id, group] of oldGroups)
                if (!this.groups.has(id)) this.notify(`You are no longer in the group ${group.name}.`, group.iconURL);
        }

        if (this.settings.servers && oldGuilds.size) {
            for (const [id, guild] of oldGuilds)
                if (!this.guilds.has(id) && !this.GuildAvailabilityStore.isUnavailable(id))
                    this.notify(`You are no longer in the server ${guild.name}.`, guild.iconURL);
        }

        if (this.settings.friends && oldFriends?.friends?.length) {
            for (const id of oldFriends.friends) {
                if (this.friends.friends.includes(id)) continue;
                const user = await this.getUser(id);
                if (user) this.notify(`You are no longer friends with ${uniqueName(user)}.`, avatar(user), () => this.openProfile(user.id));
            }
        }

        if (this.settings.friendRequestCancels && oldFriends?.requests?.length) {
            for (const id of oldFriends.requests) {
                if (this.friends.requests.includes(id) ||
                    [RelationshipType.FRIEND, RelationshipType.BLOCKED, RelationshipType.OUTGOING_REQUEST].includes(this.RelationshipStore.getRelationshipType(id))) continue;
                const user = await this.getUser(id);
                if (user) this.notify(`Friend request from ${uniqueName(user)} has been revoked.`, avatar(user), () => this.openProfile(user.id));
            }
        }
    }

    notify(text, icon, onClick) {
        if (!this.flux) return; // stopped while awaiting a user fetch
        if (this.settings.notices)
            BdApi.UI.showNotice(text, {buttons: [{label: "OK", onClick: close => close()}]});

        this.showNotification({title: "Relationship Notifier", body: text, icon, onClick});
    }

    // ---------- @api/Notifications (Vencord defaults: timeout 5000, bottom-right, native when not focused) ----------

    showNotification(data) {
        console.log(`[${NAME}] ${data.body}`);
        // Discord's desktop app can block or silently drop web notifications (and the permission prompt can hang),
        // so unlike Vencord the card is always queued too; its timer only runs while Discord is focused.
        (this.queue ||= []).push(data);
        if (!this.current) this.showNext();
        if (typeof Notification === "function" && !document.hasFocus()) {
            Promise.race([requestPermission(), new Promise(r => setTimeout(() => r(false), 1000))])
                .then(ok => {
                    if (!ok) return;
                    const n = new Notification(data.title, {body: data.body, icon: data.icon});
                    n.onclick = data.onClick || null;
                })
                .catch(e => console.warn(`[${NAME}] desktop notification failed`, e));
        }
    }

    // NotificationQueue: one card at a time, the next one appears when the current one closes
    showNext() {
        const data = this.queue?.shift();
        this.current = null;
        if (!data) return;
        const RD = BdApi.ReactDOM;
        if (!RD?.createRoot) { // very old BD: fall back to its own notification
            BdApi.UI.showNotification({title: data.title, content: data.body});
            return this.showNext();
        }
        BdApi.DOM.addStyle(NAME + "-notifications", NOTIFICATION_CSS);
        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = RD.createRoot(host);
        let closed = false;
        const onClose = () => {
            if (closed) return;
            closed = true;
            try { root.unmount(); } catch (_) {}
            host.remove();
            this.showNext();
        };
        this.current = {onClose};
        try {
            const h = BdApi.React.createElement;
            root.render(h(CardBoundary, {onError: e => { console.error(`[${NAME}] card crashed`, e); onClose(); BdApi.UI.showNotification({title: data.title, content: data.body}); }},
                h(NotificationComponent, {...data, onClose})));
        } catch (e) { // never lose a notification to a render problem
            console.error(`[${NAME}] card failed, using BetterDiscord notification`, e);
            onClose();
            BdApi.UI.showNotification({title: data.title, content: data.body});
        }
    }

    closeNotifications() {
        if (this.queue) this.queue.length = 0;
        this.current?.onClose();
        BdApi.DOM.removeStyle(NAME + "-notifications");
    }

    deleteGuild(id) { this.guilds.delete(id); this.syncGuilds(); }
    deleteGroup(id) { this.groups.delete(id); this.syncGroups(); }

    async syncGuilds() {
        this.guilds.clear();
        const me = this.UserStore.getCurrentUser().id;
        for (const [id, {name, icon}] of Object.entries(this.GuildStore.getGuilds())) {
            if (this.GuildMemberStore.isMember(id, me))
                this.guilds.set(id, {id, name, iconURL: icon && `https://cdn.discordapp.com/icons/${id}/${icon}.png`});
        }
        BdApi.Data.save(NAME, this.key("guilds"), [...this.guilds]);
    }

    async syncGroups() {
        this.groups.clear();
        for (const {type, id, name, rawRecipients, icon} of this.ChannelStore.getSortedPrivateChannels()) {
            if (type === GROUP_DM)
                this.groups.set(id, {
                    id,
                    name: name || (rawRecipients || []).map(r => r.username).join(", "),
                    iconURL: icon && `https://cdn.discordapp.com/channel-icons/${id}/${icon}.png`,
                });
        }
        BdApi.Data.save(NAME, this.key("groups"), [...this.groups]);
    }

    async syncFriends() {
        this.friends.friends = [];
        this.friends.requests = [];
        const rel = this.RelationshipStore.getMutableRelationships?.() ?? this.RelationshipStore.getRelationships?.() ?? {};
        for (const [id, raw] of (rel instanceof Map ? rel : Object.entries(rel))) {
            const type = typeof raw === "object" && raw ? raw.type : raw; // newer builds store {type, ...}
            if (type === RelationshipType.FRIEND) this.friends.friends.push(id);
            else if (type === RelationshipType.INCOMING_REQUEST) this.friends.requests.push(id);
        }
        // copy: BdApi.Data keeps the object by reference, so saving this.friends itself made the next offline check compare it to itself
        BdApi.Data.save(NAME, this.key("friends"), {...this.friends});
    }

    // ---------- @utils/discord equivalents ----------

    async getUser(id) {
        try { return this.UserStore.getUser(id) || await this.UserUtils?.getUser(id) || null; } catch (_) { return null; }
    }

    openProfile(userId) {
        try { this.ProfileActions?.openUserProfileModal({userId}); } catch (e) { console.error(`[${NAME}]`, e); }
    }
};

const TIMEOUT = 5000;

// React 18 reports render errors asynchronously, so a try/catch around render() never sees them and the queue would stall.
// Vencord wraps the card in ErrorBoundary with onError -> onClose; same here, created lazily because BdApi.React is only safe at runtime.
let CardBoundaryClass;
function CardBoundary(props) {
    CardBoundaryClass ||= class extends BdApi.React.Component {
        constructor(p) { super(p); this.state = {failed: false}; }
        static getDerivedStateFromError() { return {failed: true}; }
        componentDidCatch(e) { this.props.onError(e); }
        render() { return this.state.failed ? null : this.props.children; }
    };
    return BdApi.React.createElement(CardBoundaryClass, props);
}

async function requestPermission() {
    return Notification.permission === "granted" ||
        (Notification.permission !== "denied" && (await Notification.requestPermission()) === "granted");
}

// Vencord NotificationComponent.tsx, same markup, timing and behaviour
function NotificationComponent({title, body, icon, onClick, onClose}) {
    const {createElement: h, useState, useEffect, useMemo} = BdApi.React;
    const [isHover, setIsHover] = useState(false);
    const [hasFocus, setHasFocus] = useState(document.hasFocus());
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const on = () => setHasFocus(true), off = () => setHasFocus(false);
        window.addEventListener("focus", on);
        window.addEventListener("blur", off);
        return () => { window.removeEventListener("focus", on); window.removeEventListener("blur", off); };
    }, []);

    const start = useMemo(() => Date.now(), [isHover, hasFocus]);

    useEffect(() => {
        if (isHover || !hasFocus) return void setElapsed(0);
        const intervalId = setInterval(() => {
            const elapsed = Date.now() - start;
            if (elapsed >= TIMEOUT) onClose();
            else setElapsed(elapsed);
        }, 10);
        return () => clearInterval(intervalId);
    }, [isHover, hasFocus]);

    const timeoutProgress = elapsed / TIMEOUT;
    const stop = e => { e.preventDefault(); e.stopPropagation(); onClose(); };

    return h("button", {
        className: "vc-notification-root",
        style: {bottom: "1rem"},
        onClick: () => { onClick?.(); onClose(); },
        onContextMenu: stop,
        onMouseEnter: () => setIsHover(true),
        onMouseLeave: () => setIsHover(false),
    },
        h("div", {className: "vc-notification"},
            icon && h("img", {className: "vc-notification-icon", src: icon, alt: ""}),
            h("div", {className: "vc-notification-content"},
                h("div", {className: "vc-notification-header"},
                    h("h2", {className: "vc-notification-title"}, title),
                    h("button", {className: "vc-notification-close-btn", onClick: stop},
                        h("svg", {width: 24, height: 24, viewBox: "0 0 24 24", role: "img", "aria-label": "Dismiss Notification"},
                            h("path", {fill: "currentColor", d: "M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z"})))),
                h("p", {className: "vc-notification-p"}, body))),
        h("div", {className: "vc-notification-progressbar", style: {width: `${(1 - timeoutProgress) * 100}%`, backgroundColor: "var(--brand-500, #5865f2)"}}));
}

// Vencord api/Notifications/styles.css (fallbacks added for older Discord colour names)
const NOTIFICATION_CSS = `
.vc-notification-root {
    all: unset; display: flex; flex-direction: column;
    color: var(--text-default, var(--text-normal)); background-color: var(--background-base-low, var(--background-floating, #2b2d31));
    border-radius: 6px; overflow: hidden; cursor: pointer;
    position: fixed; z-index: 2147483647; right: 1rem; width: min(25vw, 400px); min-height: 10vh;
}
.vc-notification { display: flex; flex-direction: row; padding: 1.25rem; gap: 1.25rem; }
.vc-notification-content { width: 100%; overflow: hidden; }
.vc-notification-header { display: flex; justify-content: space-between; }
.vc-notification-title { color: var(--text-strong, var(--header-primary)); font-size: 1rem; font-weight: 600; line-height: 1.25rem; text-transform: uppercase; margin: 0; }
.vc-notification-close-btn { all: unset; cursor: pointer; color: var(--interactive-icon-default, var(--interactive-normal)); opacity: 0.5; transition: opacity 0.2s ease-in-out, color 0.2s ease-in-out; }
.vc-notification-close-btn:hover { color: var(--interactive-icon-hover, var(--interactive-hover)); opacity: 1; }
.vc-notification-icon { height: 4rem; width: 4rem; border-radius: 6px; }
.vc-notification-progressbar { height: 0.25rem; border-radius: 5px; margin-top: auto; }
.vc-notification-p { margin: 0.5rem 0 0; line-height: 140%; }
`;

const uniqueName = u => (!u.discriminator || u.discriminator === "0") ? u.username : `${u.username}#${u.discriminator}`;
const avatar = u => { try { return u.getAvatarURL(undefined, undefined, false); } catch (_) { return undefined; } };
const toMap = v => new Map(Array.isArray(v) ? v : []);
