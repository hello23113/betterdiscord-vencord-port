/**
 * @name MessageLogger
 * @version 1.1.2
 * @description Logs deleted and edited messages, kept across reloads. BetterDiscord port of the Vencord MessageLogger.
 * @author rushii, Ven, AutumnVN, Nickyux, Kyuuhachi, sadan, f3tch (Vencord), BetterDiscord port
 */

const NAME = "MessageLogger";
const EPHEMERAL = 64;
const VENBOT_USER_ID = "1017176847865352332";
const SUPPORT_CATEGORY_ID = "1108135649699180705";
const REMOVE_HISTORY_ID = "ml-remove-history";
const TOGGLE_DELETE_STYLE_ID = "ml-toggle-style";
const buttonsToRemove = ["edit", "reply", "forward", "thread", "pin", "delete", "mark-unread", "apps", "bookmark", "reminder"];

// Same options, wording and defaults as Vencord's definePluginSettings
const SETTINGS = [
    {type: "dropdown", id: "deleteStyle", name: "Delete style", note: "The style of deleted messages", value: "text",
        options: [{label: "Red text", value: "text"}, {label: "Red overlay", value: "overlay"}]},
    {type: "switch", id: "logDeletes", name: "Log deletes", note: "Whether to log deleted messages", value: true},
    {type: "switch", id: "collapseDeleted", name: "Collapse deleted", note: "Whether to collapse deleted messages, similar to blocked messages", value: false},
    {type: "switch", id: "logEdits", name: "Log edits", note: "Whether to log edited messages", value: true},
    {type: "switch", id: "logDeletedAttachments", name: "Log deleted attachments", note: "Whether to log deleted attachments", value: true},
    {type: "switch", id: "inlineEdits", name: "Inline edits", note: "Whether to display edit history as part of message content", value: true},
    {type: "switch", id: "ignoreBots", name: "Ignore bots", note: "Whether to ignore messages by bots", value: true},
    {type: "switch", id: "ignoreSelf", name: "Ignore self", note: "Whether to ignore messages by yourself", value: false},
    {type: "text", id: "ignoreUsers", name: "Ignore users", note: "Comma-separated list of user IDs to ignore", value: ""},
    {type: "text", id: "ignoreChannels", name: "Ignore channels", note: "Comma-separated list of channel IDs to ignore", value: ""},
    {type: "text", id: "ignoreGuilds", name: "Ignore guilds", note: "Comma-separated list of guild IDs to ignore", value: ""},
];

// messageLogger.css, verbatim
const BASE_CSS = `
.messagelogger-deleted [class*="buttonsInner"] [role="button"]:not([aria-label="Clear history"]),
.messagelogger-deleted [class*="buttonsInner"] [class*="separator"] { display: none; }
.messagelogger-deleted-attachment,
.messagelogger-deleted :is(.emoji, [data-type="sticker"], [class*="embedIframe"], [class*="embedSpotify"], [class*="imageContainer"]) {
    filter: grayscale(1) !important;
    transition: 150ms filter ease-in-out;
    &[class*="hiddenMosaicItem"] { filter: grayscale(1) blur(var(--custom-message-attachment-spoiler-blur-radius, 44px)) !important; }
    &:hover { filter: grayscale(0) !important; }
}
.messagelogger-deleted [class*="spoilerWarning"] { color: var(--status-danger); }
.theme-dark .messagelogger-edited { filter: brightness(80%); }
.theme-light .messagelogger-edited { opacity: 0.5; }
.messagelogger-edit-marker { cursor: pointer; }
.vc-ml-modal-timestamp { cursor: unset; height: unset; }
.vc-ml-modal-tab-bar { display: flex; flex-wrap: wrap; gap: 16px; border-bottom: 1px solid var(--background-modifier-accent); margin-bottom: 20px; }
.vc-ml-modal-tab { background: none; border: none; border-bottom: 2px solid transparent; padding: 4px 0 8px; color: var(--interactive-normal); cursor: pointer; font-size: 14px; }
.vc-ml-modal-tab.selected { border-bottom-color: var(--brand-500, #5865f2); color: var(--interactive-active); }
.vc-ml-modal-tab:disabled { opacity: .5; cursor: not-allowed; }
.ml-collapsed { display: none !important; }
.ml-collapsed-bar { margin: 8px 16px 8px 72px; padding: 4px 8px; font-size: 14px; color: var(--text-muted); border-radius: 4px; background: var(--background-secondary); }
.ml-collapsed-bar span { color: var(--text-link); cursor: pointer; margin-left: 8px; }
.ml-clear-history svg { width: 20px; height: 20px; color: var(--interactive-normal); }
`;
// deleteStyleText.css / deleteStyleOverlay.css, verbatim
const TEXT_CSS = `.messagelogger-deleted {
    --text-default: var(--status-danger, #f04747); --text-normal: var(--status-danger, #f04747);
    --interactive-icon-default: var(--status-danger, #f04747); --text-muted: var(--status-danger, #f04747);
    --embed-title: var(--red-460, #be3535); --text-link: var(--red-460, #be3535); --text-strong: var(--red-460, #be3535);
}`;
const OVERLAY_CSS = `.messagelogger-deleted { background-color: hsl(var(--red-430-hsl, 0 85% 61%) / 15%) !important; }`;
const HISTORY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>';

const MAX_SAVED = 2000;  // deleted messages / edit histories kept on disk
const MAX_RAW = 10000;   // raw API messages kept in memory so a delete can be saved in its original shape
const cap = (map, n, onEvict) => { while (map.size > n) { const k = map.keys().next().value; map.delete(k); onEvict?.(k); } };
const snowflake = id => { try { return BigInt(id); } catch (_) { return 0n; } };

const toDate = x => x instanceof Date ? x : (x?.toDate ? x.toDate() : new Date(x));
const idList = s => String(s || "").split(",").map(x => x.trim()).filter(Boolean);
const deletedCountText = n => n === 0 ? "No deleted messages" : n === 1 ? "1 deleted message" : `${n} deleted messages`;

// Port of Vencord's @api/ContextMenu findGroupChildrenByChildId
function findGroupChildrenByChildId(id, children) {
    for (const child of children) {
        if (child == null) continue;
        if (Array.isArray(child)) {
            const found = findGroupChildrenByChildId(id, child);
            if (found) return found;
            continue;
        }
        if (child.props?.id === id) return children;
        let next = child.props?.children;
        if (next) {
            if (!Array.isArray(next)) { next = [next]; child.props.children = next; }
            const found = findGroupChildrenByChildId(id, next);
            if (found) return found;
        }
    }
    return null;
}

module.exports = class MessageLogger {
    constructor() {
        this.intercept = this.intercept.bind(this);
        this.onClick = this.onClick.bind(this);
        this.flush = this.flush.bind(this);
    }

    // ---------- lifecycle ----------

    start() {
        const W = BdApi.Webpack;
        this.settings = Object.fromEntries(SETTINGS.map(s => [s.id, s.value]));
        Object.assign(this.settings, BdApi.Data.load(NAME, "settings"));

        // Vencord stores these as fields on Message records (deleted, editHistory, firstEditTimestamp).
        // Records get rebuilt by Discord, so keep the source of truth here, keyed by message id.
        this.deleted = new Map();            // messageId -> channelId
        this.history = new Map();            // messageId -> {editHistory: [{timestamp, content}], firstEditTimestamp}
        this.deletedAttachments = new Map(); // attachmentId -> messageId
        this.unhighlighted = new Set();      // "Toggle Deleted Highlight"
        this.expanded = new Set();           // collapsed deleted groups the user opened
        this.roots = new Map();              // inline-edit box element -> React root
        this.saved = new Map();              // messageId -> raw message of a deleted message (persisted)
        this.raw = new Map();                // messageId -> raw message as Discord sent it (memory only)
        // a plugin reload/update calls stop() then start(): cancel the pending "really delete" replay
        clearTimeout(window.__messageLoggerReplay);
        this.load();

        this.MessageStore = W.getStore("MessageStore");
        this.ChannelStore = W.getStore("ChannelStore");
        this.UserStore = W.getStore("UserStore");
        this.SelectedChannelStore = W.getStore("SelectedChannelStore");
        this.Dispatcher = this.ChannelStore?._dispatcher || this.MessageStore?._dispatcher;
        if (!this.Dispatcher?.addInterceptor || !this.MessageStore) {
            return BdApi.UI.showToast(NAME + ": Discord internals not found, plugin inactive", {type: "error"});
        }
        this.Parser = W.getByKeys("parse", "parseTopic");
        this.MarkupClasses = W.getByKeys("markup", "codeContainer") || {};
        this.MiscClasses = W.getByKeys("messageContent", "markupRtl") || {};
        this.MessageClasses = W.getByKeys("edited", "communicationDisabled", "isSystemMessage") || {};

        // patch: MessageStore MESSAGE_DELETE / MESSAGE_DELETE_BULK / MESSAGE_UPDATE + ReferencedMessageStore deletes
        this.Dispatcher.addInterceptor(this.intercept);

        // patch: getLastEditableMessage skips deleted messages
        const safePatch = (what, fn) => { try { fn(); } catch (e) { console.warn(`[${NAME}] ${what} patch failed`, e); } };
        safePatch("getLastEditableMessage", () => BdApi.Patcher.after(NAME, this.MessageStore, "getLastEditableMessage", (_, [channelId], ret) => {
            if (!ret || !this.deleted.has(ret.id)) return ret;
            const me = this.UserStore.getCurrentUser()?.id;
            const arr = this.MessageStore.getMessages(channelId)?._array || [];
            for (let i = arr.length - 1; i >= 0; i--) {
                const m = arr[i];
                if (m.author?.id === me && !this.deleted.has(m.id) && (m.state == null || m.state === "SENT") && (m.type === 0 || m.type === 19)) return m;
            }
            return undefined;
        }));

        // patches: normalizeNonce in receiveMessage, getReactionTarget for `+:emoji:`
        let ChannelMessages = null;
        try {
            ChannelMessages = W.getByPrototypeKeys?.("receiveMessage", "truncateTop", {searchExports: true})
                || this.MessageStore.getMessages(this.SelectedChannelStore?.getChannelId?.() || "0")?.constructor;
        } catch (_) {}
        if (ChannelMessages?.prototype?.receiveMessage) {
            safePatch("receiveMessage", () => BdApi.Patcher.before(NAME, ChannelMessages.prototype, "receiveMessage", (_, [msg]) => this.normalizeNonce(msg)));
            // `+:emoji:` reacts to .last(); never let that be a ghost
            if (typeof ChannelMessages.prototype.last === "function") safePatch("last", () => BdApi.Patcher.after(NAME, ChannelMessages.prototype, "last", (self, _, ret) => {
                if (!ret || !this.deleted.has(ret.id)) return ret;
                return (self._array || []).findLast(m => !this.deleted.has(m.id));
            }));
        } else console.warn(`[${NAME}] ChannelMessages not found: nonce bypass fix and reaction-target fix inactive`);

        // contextMenus
        this.menuUnpatches = [
            BdApi.ContextMenu.patch("message", (tree, props) => this.patchMessageContextMenu(tree, props)),
            ...["channel-context", "thread-context", "user-context", "gdm-context"]
                .map(nav => BdApi.ContextMenu.patch(nav, (tree, props) => this.patchChannelContextMenu(tree, props))),
        ];

        // DOM side: classes, inline edits, popover button, edit marker, collapsing
        this.addDeleteStyle();
        document.addEventListener("click", this.onClick, true);
        window.addEventListener?.("beforeunload", this.flush); // Ctrl+R/quit never call stop(): write the last <500ms too
        this.observer = new MutationObserver(() => this.scheduleRefresh());
        this.observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ["class"]});
        this.scheduleRefresh();
    }

    stop() {
        const D = this.Dispatcher;
        if (D?._interceptors) D._interceptors = D._interceptors.filter(f => f !== this.intercept);
        BdApi.Patcher.unpatchAll(NAME);
        for (const u of this.menuUnpatches || []) try { u?.(); } catch (_) {}
        this.menuUnpatches = [];
        this.observer?.disconnect();
        document.removeEventListener("click", this.onClick, true);
        window.removeEventListener?.("beforeunload", this.flush);
        cancelAnimationFrame(this.raf); this.raf = 0;
        BdApi.DOM.removeStyle(NAME);
        for (const root of this.roots?.values() || []) try { root.unmount(); } catch (_) {}
        for (const el of document.querySelectorAll(".ml-edits, .ml-collapsed-bar, .ml-clear-history")) el.remove();
        for (const el of document.querySelectorAll(".messagelogger-deleted, .ml-collapsed, .messagelogger-edit-marker"))
            el.classList.remove("messagelogger-deleted", "ml-collapsed", "messagelogger-edit-marker");
        this.flush();
        // Really disabled: after a moment let Discord remove the kept messages, or they linger looking like live ones.
        // Reloaded/updated: start() runs first and cancels this, so the messages stay. The log on disk is kept either way.
        const pending = [...(this.deleted || [])];
        if (D && pending.length) window.__messageLoggerReplay = setTimeout(() => {
            for (const [id, channelId] of pending) try { D.dispatch({type: "MESSAGE_DELETE", id, channelId, mlDeleted: true}); } catch (_) {}
        }, 3000);
        this.deleted?.clear(); this.history?.clear(); this.deletedAttachments?.clear(); this.roots?.clear(); this.saved?.clear(); this.raw?.clear();
    }

    getSettingsPanel() {
        return BdApi.UI.buildSettingsPanel({
            settings: SETTINGS.map(s => ({...s, value: this.settings[s.id]})),
            onChange: (_, id, value) => {
                this.settings[id] = value;
                BdApi.Data.save(NAME, "settings", this.settings);
                if (id === "deleteStyle") this.addDeleteStyle();
                this.scheduleRefresh();
            },
        });
    }

    // ---------- persistence (not in Vencord: its log is memory-only) ----------

    load() {
        const s = BdApi.Data.load(NAME, "log") || {};
        try {
            // a damaged file must not load junk (a string iterates as characters) that the next save writes back
            const entries = v => Array.isArray(v) ? v.filter(e => Array.isArray(e) && typeof e[0] === "string" && e[1] != null) : [];
            for (const [id, ch] of entries(s.deleted)) this.deleted.set(id, ch);
            for (const [id, m] of entries(s.saved)) this.saved.set(id, m);
            for (const [id, h] of entries(s.history))
                this.history.set(id, {
                    editHistory: (h.editHistory || []).map(x => ({timestamp: new Date(x.timestamp), content: x.content})),
                    firstEditTimestamp: new Date(h.firstEditTimestamp),
                });
            for (const [att, mid] of entries(s.deletedAttachments)) this.deletedAttachments.set(att, mid);
        } catch (e) { console.error(`[${NAME}] saved log unreadable, starting fresh`, e); }
    }

    save() {
        // throttle, not debounce: busy servers never go quiet for 500ms, and Ctrl+R/quit never calls stop()
        this.saveTimer ||= setTimeout(() => this.flush(), 500);
    }

    flush() {
        clearTimeout(this.saveTimer); this.saveTimer = 0;
        if (!this.deleted) return;
        // cap only what goes to disk: evicting from memory would turn kept messages into live-looking ones
        const deleted = [...this.deleted].slice(-MAX_SAVED);
        const keep = new Set(deleted.map(([id]) => id));
        for (const id of this.saved.keys()) if (!keep.has(id)) this.saved.delete(id);
        cap(this.deletedAttachments, MAX_SAVED * 4);
        try {
            BdApi.Data.save(NAME, "log", {
                deleted, saved: [...this.saved], history: [...this.history].slice(-MAX_SAVED), deletedAttachments: [...this.deletedAttachments],
            });
        } catch (e) { console.error(`[${NAME}] could not save log`, e); }
    }

    remember(m) {
        if (!m?.id) return;
        this.raw.delete(m.id);
        this.raw.set(m.id, m);
        cap(this.raw, MAX_RAW);
    }

    // After Ctrl+R Discord refetches channels without the deleted messages; put saved ones back into the batch.
    onLoadMessages(e) {
        const list = e.messages;
        if (!Array.isArray(list)) return;
        for (const m of list) this.remember(m);
        const have = new Set(list.map(m => m.id));
        const ids = list.map(m => snowflake(m.id));
        const lo = ids.length ? ids.reduce((a, b) => b < a ? b : a) : null;
        const hi = ids.length ? ids.reduce((a, b) => b > a ? b : a) : null;
        const add = [];
        for (const [id, m] of this.saved) {
            if (m.channel_id !== e.channelId || have.has(id) || !this.deleted.has(id)) continue;
            const n = snowflake(id);
            // only inside the loaded window, or past its edge when that edge is the start/end of the channel.
            // A before-page's newer edge (and an after-page's older edge) is already loaded: hasMore* is meaningless there.
            if ((lo === null || n >= lo || !(e.hasMoreBefore || e.isAfter)) && (hi === null || n <= hi || !(e.hasMoreAfter || e.isBefore))) add.push(m);
        }
        if (!add.length) return;
        list.push(...add);
        list.sort((a, b) => { const x = snowflake(a.id), y = snowflake(b.id); return x > y ? -1 : x < y ? 1 : 0; }); // newest first, like the API
        this.scheduleRefresh();
    }

    // Fallback when the raw message was never seen (e.g. loaded before the plugin started)
    toRaw(m) {
        const a = m.author || {};
        const iso = x => { try { return toDate(x).toISOString(); } catch (_) { return null; } };
        return {
            id: m.id, channel_id: m.channel_id, type: m.type ?? 0, content: m.content || "", flags: m.flags || 0,
            author: {id: a.id, username: a.username, global_name: a.globalName ?? a.global_name ?? null, avatar: a.avatar ?? null, discriminator: a.discriminator ?? "0", bot: !!a.bot},
            timestamp: iso(m.timestamp), edited_timestamp: m.editedTimestamp ? iso(m.editedTimestamp) : null,
            attachments: [...(m.attachments || [])].map(x => ({...x})),
            embeds: [], mentions: [], mention_roles: [], mention_everyone: false, pinned: false, tts: false, components: [],
        };
    }

    addDeleteStyle() {
        const rules = [...this.deletedAttachments.keys()]
            .map(id => `[class*="mosaicItem"]:has(:is(img,video,a)[src*="/${id}/"], a[href*="/${id}/"])`).join(",");
        BdApi.DOM.addStyle(NAME, BASE_CSS + (this.settings.deleteStyle === "text" ? TEXT_CSS : OVERLAY_CSS) +
            (rules ? `${rules}{filter:grayscale(1)!important;transition:150ms filter ease-in-out}:is(${rules}):hover{filter:grayscale(0)!important}` : ""));
    }

    // ---------- store-level behaviour (Vencord's MessageStore patches) ----------

    // Returning true stops the event before any store sees it.
    intercept(e) {
        try {
            switch (e?.type) {
                case "MESSAGE_CREATE": if (!e.optimistic) this.remember(e.message); return false;
                case "LOAD_MESSAGES_SUCCESS": this.onLoadMessages(e); return false;
                case "MESSAGE_DELETE": return this.handleDelete(e, false);
                case "MESSAGE_DELETE_BULK": return this.handleDelete(e, true);
                case "MESSAGE_UPDATE": this.handleUpdate(e); return false;
            }
        } catch (err) { console.error(`[${NAME}] Error during intercept`, err); }
        return false;
    }

    handleDelete(data, isBulk) {
        const ids = isBulk ? (data.ids || []) : [data.id];
        if (data.mlDeleted) {
            for (const id of ids) this.forget(id);
            this.scheduleRefresh();
            return false;
        }
        const pass = []; // ids Discord should really remove
        let kept = false;
        for (const id of ids) {
            const msg = this.MessageStore.getMessage(data.channelId, id);
            if (!msg) { pass.push(id); continue; }
            if (this.deleted.has(id)) { kept = true; continue; }               // duplicate event
            if (msg.state && msg.state !== "SENT") { pass.push(id); continue; } // failed/pending sends stay removable
            if ((msg.flags & EPHEMERAL) === EPHEMERAL || this.shouldIgnore(msg)) { pass.push(id); continue; }

            this.deleted.set(id, data.channelId || msg.channel_id);
            this.saved.set(id, this.raw.get(id) || this.toRaw(msg));
            for (const a of msg.attachments || []) { try { a.deleted = true; } catch (_) {} }
            try { msg.deleted = true; } catch (_) {}
            kept = true;
        }
        if (kept) { this.scheduleRefresh(); this.save(); }
        if (!pass.length) return kept;
        if (isBulk && kept) data.ids = pass; // remove only the ignored ones
        return false;
    }

    handleUpdate(e) {
        const m = e.message;
        if (!m?.id || e.mlClear) return;
        const old = this.MessageStore.getMessage(m.channel_id, m.id);
        if (!old) return; // Vencord only touches cached messages
        const asIgnore = Object.assign({author: old.author, channel_id: old.channel_id}, m);
        const ignoredEdit = this.shouldIgnore(asIgnore, true);

        if (!((m.flags & EPHEMERAL) === EPHEMERAL || ignoredEdit) && m.edited_timestamp && typeof m.content === "string" && m.content !== old.content) {
            const h = this.history.get(m.id) || {editHistory: [], firstEditTimestamp: toDate(old.editedTimestamp || old.timestamp)};
            h.editHistory = [...h.editHistory, this.makeEdit(m, old)];
            this.history.set(m.id, h);
            try { old.editHistory = h.editHistory; old.firstEditTimestamp = h.firstEditTimestamp; } catch (_) {}
            this.scheduleRefresh();
            this.save();
        }
        // only full payloads carry attachments; embed-only updates must not mark everything deleted
        if (this.settings.logDeletedAttachments && "attachments" in m && !ignoredEdit) {
            m.attachments = this.handleUpdateAttachments(m, old);
        }
        if (this.raw.has(m.id)) this.remember(Object.assign({}, this.raw.get(m.id), m)); // updates can be partial
    }

    makeEdit(newMessage, oldMessage) {
        return {timestamp: new Date(newMessage.edited_timestamp), content: oldMessage.content};
    }

    handleUpdateAttachments(newMessage, oldMessage) {
        const oldAtt = [...(oldMessage.attachments || [])];
        let added = false; // only rebuild the (large) CSS when something is newly deleted
        const mark = a => { added ||= !this.deletedAttachments.has(a.id); this.deletedAttachments.set(a.id, newMessage.id); return {...a, deleted: true}; };
        let result;
        if (!newMessage.attachments?.length) result = oldAtt.map(mark);
        else result = oldAtt
            .map(o => newMessage.attachments.find(a => a.id === o.id) ?? mark(o))
            .concat(newMessage.attachments.filter(a => !oldAtt.some(o => o.id === a.id)));
        if (added) { this.addDeleteStyle(); this.save(); }
        return result;
    }

    shouldIgnore(message, isEdit = false) {
        try {
            const {ignoreBots, ignoreSelf, ignoreUsers, ignoreChannels, ignoreGuilds, logEdits, logDeletes} = this.settings;
            const myId = this.UserStore.getCurrentUser().id;
            const channel = this.ChannelStore.getChannel(message.channel_id);
            return ignoreBots && message.author?.bot ||
                ignoreSelf && message.author?.id === myId ||
                idList(ignoreUsers).includes(message.author?.id) ||
                idList(ignoreChannels).includes(message.channel_id) ||
                idList(ignoreChannels).includes(channel?.parent_id) ||
                (isEdit ? !logEdits : !logDeletes) ||
                idList(ignoreGuilds).includes(channel?.guild_id) ||
                (message.author?.id === VENBOT_USER_ID && channel?.parent_id === SUPPORT_CATEGORY_ID);
        } catch (e) {
            return false;
        }
    }

    // Replacing a message via a reused nonce is not an edit, so it would bypass logging. Vencord strips the nonce.
    normalizeNonce(msg) {
        try {
            if (!msg?.nonce || msg.author?.id === this.UserStore.getCurrentUser()?.id) return;
            const prev = this.MessageStore.getMessage(msg.channel_id, msg.nonce);
            if (!prev || prev.state !== "SENT") return;
            if (prev.id !== msg.id) delete msg.nonce;
        } catch (e) {
            console.error(`[${NAME}] Error normalizing nonce`);
        }
    }

    // ---------- history helpers ----------

    isDeleted(msg) { return !!msg && this.deleted.has(msg.id); }
    editHistory(msg) { return this.history.get(msg?.id)?.editHistory || []; }

    doesMessageHaveHistory(msg) {
        return this.isDeleted(msg) || this.editHistory(msg).length > 0 || (msg?.attachments || []).some(a => this.deletedAttachments.has(a.id));
    }

    forget(id) {
        this.deleted.delete(id); this.history.delete(id); this.unhighlighted.delete(id); this.saved.delete(id);
        for (const [att, mid] of this.deletedAttachments) if (mid === id) this.deletedAttachments.delete(att);
        this.save();
    }

    clearMessageHistory(msg) {
        if (this.isDeleted(msg)) {
            this.Dispatcher.dispatch({type: "MESSAGE_DELETE", channelId: msg.channel_id, id: msg.id, mlDeleted: true});
            return;
        }
        const attachments = (msg.attachments || []).filter(a => !this.deletedAttachments.has(a.id));
        const hadDeletedAttachments = attachments.length !== (msg.attachments || []).length;
        this.forget(msg.id);
        if (hadDeletedAttachments) {
            this.addDeleteStyle();
            try { this.Dispatcher.dispatch({type: "MESSAGE_UPDATE", mlClear: true, message: {id: msg.id, channel_id: msg.channel_id, attachments}}); } catch (e) { console.error(`[${NAME}]`, e); }
        }
        this.scheduleRefresh();
    }

    parseEditContent(content, message) {
        if (!this.Parser) return content;
        return this.Parser.parse(content, true, {
            channelId: message.channel_id,
            messageId: message.id,
            allowLinks: true,
            allowHeading: true,
            allowList: true,
            allowEmojiLinks: true,
            viewingChannelId: this.SelectedChannelStore?.getChannelId(),
        });
    }

    // ---------- context menus ----------

    patchMessageContextMenu(tree, {message} = {}) {
        if (!message || !this.doesMessageHaveHistory(message)) return;
        const {id, channel_id} = message;
        const deleted = this.isDeleted(message);
        const children = this.menuChildren(tree);
        if (!children) return;

        if (deleted) {
            for (const bid of buttonsToRemove) {
                const group = findGroupChildrenByChildId(bid, children);
                if (group) {
                    const index = group.findIndex(c => c?.props?.id === bid);
                    if (index !== -1) group.splice(index, 1);
                }
            }
            // Vencord empties the first section (quick reactions) of a deleted message's menu
            for (const rid of ["add-reaction", "quick-reactions"]) {
                const group = findGroupChildrenByChildId(rid, children);
                if (group) group.splice(0, group.length);
            }

            const domElement = document.getElementById(`chat-messages-${channel_id}-${id}`);
            if (domElement) children.push(BdApi.ContextMenu.buildItem({
                id: TOGGLE_DELETE_STYLE_ID,
                label: "Toggle Deleted Highlight",
                action: () => {
                    if (this.unhighlighted.has(id)) this.unhighlighted.delete(id); else this.unhighlighted.add(id);
                    this.scheduleRefresh();
                },
            }));
        }

        children.push(BdApi.ContextMenu.buildItem({
            id: REMOVE_HISTORY_ID,
            label: "Clear Message History",
            danger: true,
            action: () => this.clearMessageHistory(message),
        }));
    }

    patchChannelContextMenu(tree, {channel} = {}) {
        const messages = this.MessageStore.getMessages(channel?.id)?._array;
        if (!messages?.some(msg => this.doesMessageHaveHistory(msg))) return;
        const children = this.menuChildren(tree);
        if (!children) return;
        const group = findGroupChildrenByChildId("mark-channel-read", children) ?? children;
        group.push(BdApi.ContextMenu.buildItem({
            id: "vc-ml-clear-channel",
            label: "Clear Message Log",
            danger: true,
            action: () => messages.forEach(msg => this.clearMessageHistory(msg)),
        }));
    }

    menuChildren(tree) {
        if (!tree?.props) return null;
        if (!Array.isArray(tree.props.children)) tree.props.children = [tree.props.children];
        return tree.props.children;
    }

    // ---------- DOM layer (Vencord's React patches) ----------

    scheduleRefresh() {
        if (this.raf) return;
        this.raf = requestAnimationFrame(() => { this.raf = 0; try { this.refresh(); } catch (e) { console.error(`[${NAME}] refresh`, e); } });
    }

    refresh() {
        const lis = [...document.querySelectorAll('li[id^="chat-messages-"]')];
        const editedClass = this.MessageClasses.edited?.split(" ")[0];
        for (const li of lis) {
            const [, , channelId, id] = li.id.split("-");
            const isDel = this.deleted.has(id);

            // "Message must not be a thread starter message" patch: messagelogger-deleted class on the <li>
            const want = isDel && !this.unhighlighted.has(id);
            if (li.classList.contains("messagelogger-deleted") !== want) li.classList.toggle("messagelogger-deleted", want);

            // "#{intl::MESSAGE_EDITED}" patch: the (edited) marker opens the history modal
            if (editedClass) for (const el of li.querySelectorAll("." + editedClass))
                if (!el.closest(".ml-edits") && !el.classList.contains("messagelogger-edit-marker")) el.classList.add("messagelogger-edit-marker");

            this.renderInlineEdits(li, channelId, id);
            this.renderPopoverButton(li, channelId, id);
        }
        // messages scrolled out of view: Discord removed the box, the root would leak
        for (const [box, root] of this.roots) if (!box.isConnected) { try { root.unmount(); } catch (_) {} this.roots.delete(box); }
        this.renderCollapsed(lis);
    }

    // ".SEND_FAILED," patch: edit history rendered above the message content
    renderInlineEdits(li, channelId, id) {
        const content = li.querySelector(`[id="message-content-${id}"]`);
        const existing = li.querySelector(".ml-edits");
        const edits = this.history.get(id)?.editHistory || [];
        const drop = box => { this.roots.get(box)?.unmount?.(); this.roots.delete(box); box.remove(); };
        if (!this.settings.inlineEdits || !edits.length || !content) {
            if (existing) drop(existing);
            return;
        }
        if (existing && existing.dataset.count === String(edits.length) && content.contains(existing)) return;
        if (existing) drop(existing);

        const box = document.createElement("div");
        box.className = "ml-edits";
        box.dataset.count = String(edits.length);
        content.prepend(box);
        const message = this.MessageStore.getMessage(channelId, id) || {id, channel_id: channelId};
        const h = BdApi.React.createElement;
        const editedClass = this.MessageClasses.edited || "";
        const tree = h(BdApi.React.Fragment, null, edits.map((edit, idx) =>
            h("div", {key: idx, className: "messagelogger-edited"},
                this.parseEditContent(edit.content, message),
                h("time", {title: edit.timestamp.toLocaleString(), dateTime: edit.timestamp.toISOString()},
                    h("span", {className: editedClass}, " (edited)")))));
        const RD = BdApi.ReactDOM;
        if (RD?.createRoot) { const root = RD.createRoot(box); root.render(tree); this.roots.set(box, root); }
        else if (RD?.render) RD.render(tree, box);
        else box.textContent = edits.map(x => x.content + " (edited)").join("\n");
    }

    // messagePopoverButton: "Clear history" in the hover toolbar
    renderPopoverButton(li, channelId, id) {
        const inner = li.querySelector('[class*="buttonsInner"]');
        if (!inner) return;
        const msg = this.MessageStore.getMessage(channelId, id);
        const existing = inner.querySelector(".ml-clear-history");
        if (!msg || !this.doesMessageHaveHistory(msg)) { existing?.remove(); return; }
        if (existing) return;
        const sibling = inner.querySelector('[role="button"]');
        const btn = document.createElement("div");
        btn.className = ((sibling?.className || "") + " ml-clear-history").trim();
        btn.setAttribute("role", "button");
        btn.setAttribute("aria-label", "Clear history");
        btn.title = "Clear history";
        btn.tabIndex = 0;
        btn.innerHTML = HISTORY_ICON;
        btn.addEventListener("click", ev => {
            ev.stopPropagation();
            const latest = this.MessageStore.getMessage(channelId, id);
            if (latest) this.clearMessageHistory(latest);
        });
        inner.prepend(btn);
    }

    // collapseDeleted: MESSAGE_GROUP_DELETED, rendered like blocked-message groups
    renderCollapsed(lis) {
        const runs = [];
        if (this.settings.collapseDeleted) {
            let run = null;
            for (const li of lis) {
                const id = li.id.split("-")[3];
                const prev = run && run.items[run.items.length - 1];
                const adjacent = prev && prev.parentElement === li.parentElement && this.nextLi(prev) === li;
                if (this.deleted.has(id)) {
                    if (run && adjacent) run.items.push(li);
                    else runs.push(run = {key: id, items: [li]});
                } else run = null;
            }
        }
        const live = new Set(runs.map(r => r.key));
        for (const bar of document.querySelectorAll(".ml-collapsed-bar")) if (!live.has(bar.dataset.key)) bar.remove();
        for (const li of document.querySelectorAll(".ml-collapsed")) {
            if (!runs.some(r => r.items.includes(li) && !this.expanded.has(r.key))) li.classList.remove("ml-collapsed");
        }
        for (const r of runs) {
            const open = this.expanded.has(r.key);
            for (const li of r.items) if (li.classList.contains("ml-collapsed") === open) li.classList.toggle("ml-collapsed", !open);
            let bar = r.items[0].parentElement.querySelector(`.ml-collapsed-bar[data-key="${r.key}"]`);
            if (!bar) {
                bar = document.createElement("div");
                bar.className = "ml-collapsed-bar";
                bar.dataset.key = r.key;
                bar.addEventListener("click", ev => {
                    if (!ev.target.matches("span")) return;
                    if (this.expanded.has(r.key)) this.expanded.delete(r.key); else this.expanded.add(r.key);
                    this.scheduleRefresh();
                });
            }
            if (bar.nextElementSibling !== r.items[0]) r.items[0].before(bar);
            const text = deletedCountText(r.items.length) + "—" + (open ? "Hide messages" : "Show messages");
            if (bar.dataset.text !== text) {
                bar.dataset.text = text;
                bar.textContent = deletedCountText(r.items.length) + " ";
                const toggle = document.createElement("span");
                toggle.textContent = open ? "Hide messages" : "Show messages";
                bar.appendChild(toggle);
            }
        }
    }

    // next sibling, skipping our own bars; date dividers etc. break a run
    nextLi(li) {
        let n = li.nextElementSibling;
        while (n?.classList.contains("ml-collapsed-bar")) n = n.nextElementSibling;
        return n;
    }

    // EditMarker: clicking (edited) opens the history modal
    onClick(ev) {
        const marker = ev.target?.closest?.(".messagelogger-edit-marker");
        if (!marker) return;
        const li = marker.closest('li[id^="chat-messages-"]');
        if (!li) return;
        const [, , channelId, id] = li.id.split("-");
        const message = this.MessageStore.getMessage(channelId, id);
        if (!message) return;
        ev.preventDefault();
        ev.stopPropagation();
        this.openHistoryModal(message);
    }

    // ---------- HistoryModal.tsx ----------

    openHistoryModal(message) {
        const h = BdApi.React.createElement;
        const editHistory = this.editHistory(message);
        const timestamp = toDate(message.timestamp);
        const firstEditTimestamp = this.history.get(message.id)?.firstEditTimestamp || toDate(message.editedTimestamp || message.timestamp);
        const timestamps = [firstEditTimestamp, ...editHistory.map(m => m.timestamp)];
        const contents = [...editHistory.map(m => m.content), message.content];
        const self = this;

        function HistoryModal() {
            const [currentTab, setCurrentTab] = BdApi.React.useState(editHistory.length);
            const tab = (id, ts, disabled, title) => h("button", {
                key: id,
                className: "vc-ml-modal-tab vc-ml-modal-timestamp" + (currentTab === id ? " selected" : ""),
                disabled, title,
                onClick: () => setCurrentTab(id),
            }, ts.toLocaleString());
            return h("div", null,
                h("div", {className: "vc-ml-modal-tab-bar"},
                    firstEditTimestamp.getTime() !== timestamp.getTime() &&
                        tab(-1, timestamp, true, "This edit state was not logged so it can't be displayed."),
                    timestamps.map((ts, index) => tab(index, ts, false))),
                h("div", {className: [self.MarkupClasses.markup, self.MiscClasses.messageContent].filter(Boolean).join(" ")},
                    self.parseEditContent(contents[currentTab] ?? "", message)));
        }
        BdApi.UI.alert("Message Edit History", h(HistoryModal));
    }
};
