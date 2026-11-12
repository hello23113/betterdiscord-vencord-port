/**
 * @name AvatarDownloader
 * @version 1.3.0
 * @description Right-click a user (or yourself) to download their avatar at 1024, 2048 or 4096px.
 * @author BetterDiscord port
 * @source https://github.com/hello23113/betterdiscord-vencord-port
 * @website https://github.com/hello23113/betterdiscord-vencord-port
 * @updateUrl https://raw.githubusercontent.com/hello23113/betterdiscord-vencord-port/main/AvatarDownloader.plugin.js
 */

// Discord CDN only serves powers of 2; above the upload size it is upscaled
const SIZES = [[1024, "HD, about 1080p"], [2048, "about 2K"], [4096, "about 4K"]];

const avatarUrl = (path, hash, size) => `https://cdn.discordapp.com/${path}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=${size}`;

module.exports = class AvatarDownloader {
    start() {
        this.unpatch = BdApi.ContextMenu.patch("user-context", (tree, props) => this.patch(tree, props));
        for (const k of ["editorMenu", "debug"]) BdApi.Data.delete?.("AvatarDownloader", k); // leftovers from v1.1.0 and the debug build
        // BdApi.ContextMenu.patch did not reach the profile editor avatar menu when tried (v1.1.0), so rows are added in the DOM.
        this.observer = new MutationObserver(() => { this.raf ||= requestAnimationFrame(() => { this.raf = 0; this.addEditorRows(); }); });
        this.observer.observe(document.body, {childList: true, subtree: true});
    }

    stop() {
        this.unpatch?.();
        this.observer?.disconnect();
        cancelAnimationFrame(this.raf);
        document.querySelectorAll("[data-avatar-download]").forEach(e => e.remove());
    }

    // Discord's ids for the profile editor's avatar menu; same in every language
    addEditorRows() {
        const row = document.getElementById("avatar-edit-context-change-avatar");
        const list = row?.parentElement;
        if (!list || list.querySelector("[data-avatar-download]")) return;
        const labelText = row.textContent;
        const user = BdApi.Webpack.getStore("UserStore").getCurrentUser();
        const [[, path, hash] = []] = this.avatars(user);
        if (!hash) return;
        for (const [size, note] of SIZES) {
            const item = row.cloneNode(true); // copies Discord's look; React handlers are not copied
            item.className = item.className.replace(/\S*focused\S*/g, "").trim(); // clone must not start highlighted
            item.dataset.avatarDownload = size;
            item.id = "avatar-edit-context-download-" + size;
            [...item.querySelectorAll("*")].concat(item).find(e => e.childElementCount === 0 && e.textContent === labelText).textContent = `Download ${size}px (${note})`;
            item.addEventListener("mouseenter", () => this.focusRow(list, item));
            item.addEventListener("mouseleave", () => this.focusRow(list, null));
            item.addEventListener("click", e => {
                e.stopPropagation();
                document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", keyCode: 27, bubbles: true})); // close popout
                this.download(avatarUrl(path, hash, size), `${user.username}_${size}.${hash.startsWith("a_") ? "gif" : "png"}`);
            });
            list.appendChild(item);
        }
    }

    // [label, cdn path, hash] for each avatar the user has
    avatars(user, guildId) {
        const list = [];
        const member = guildId && BdApi.Webpack.getStore("GuildMemberStore")?.getMember(guildId, user.id);
        if (member?.avatar) list.push(["Server Avatar", `guilds/${guildId}/users/${user.id}/avatars`, member.avatar]);
        if (user.avatar) list.push(["Avatar", `avatars/${user.id}`, user.avatar]);
        return list;
    }

    patch(tree, props) {
        const user = props.user;
        if (!user || !tree?.props) return;
        if (!Array.isArray(tree.props.children)) tree.props.children = [tree.props.children]; // single child is not an array
        const children = tree.props.children;
        const avatars = this.avatars(user, props.guildId);
        if (!avatars.length) return; // default avatar: no hash, nothing big to download
        const items = avatars.flatMap(([label, path, hash]) => SIZES.map(([size, note]) => ({
            label: `${label} ${size}px (${note})`,
            action: () => this.download(avatarUrl(path, hash, size), `${user.username}_${size}.${hash.startsWith("a_") ? "gif" : "png"}`),
        })));
        children.push(BdApi.ContextMenu.buildItem({type: "submenu", id: "download-avatar", label: "Download Avatar", items}));
    }

    // One highlight at a time: take Discord's "focused" class off the real rows and put it on ours
    focusRow(list, item) {
        for (const r of list.children) {
            const cls = [...r.classList].find(c => c.includes("focused"));
            if (cls) { this.focusedClass = cls; r.classList.remove(cls); }
            r.style.background = "";
        }
        if (!item) return;
        if (this.focusedClass) item.classList.add(this.focusedClass);
        else item.style.background = "var(--background-modifier-hover)"; // Discord's class not seen yet
    }

    async download(url, filename) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error("HTTP " + res.status);
            const data = new Uint8Array(await res.arrayBuffer());
            // Discord's Electron ignores <a download>; its own save dialog is how it downloads attachments
            if (window.DiscordNative?.fileManager?.saveWithDialog) await DiscordNative.fileManager.saveWithDialog(data, filename);
            else {
                const blobUrl = URL.createObjectURL(new Blob([data]));
                const a = Object.assign(document.createElement("a"), {href: blobUrl, download: filename});
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            }
        } catch (e) {
            BdApi.UI.showToast("Avatar download failed: " + e.message, {type: "error"});
        }
    }
};
