/**
 * @name ImageZoom
 * @version 1.0.0
 * @description Lets you zoom in to images and gifs. Use scroll wheel to zoom in and shift + scroll wheel to increase lens radius / size
 * @author Aria (Vencord), BetterDiscord port
 * @source https://github.com/hello23113/betterdiscord-vencord-port
 * @website https://github.com/hello23113/betterdiscord-vencord-port
 * @updateUrl https://raw.githubusercontent.com/hello23113/betterdiscord-vencord-port/main/ImageZoom.plugin.js
 */

const NAME = "ImageZoom";

// Same options, wording and defaults as Vencord's definePluginSettings
const SETTINGS = [
    {id: "saveZoomValues", type: "switch", name: "Whether to save zoom and lens size values", value: true},
    {id: "invertScroll", type: "switch", name: "Invert scroll", value: true},
    {id: "nearestNeighbour", type: "switch", name: "Use Nearest Neighbour Interpolation when scaling images", value: false},
    {id: "square", type: "switch", name: "Make the lens square", value: false},
    {id: "zoom", type: "slider", name: "Zoom of the lens", min: 1, max: 50, markers: [1, 5, 10, 20, 30, 40, 50], value: 2},
    {id: "size", type: "slider", name: "Radius / Size of the lens", min: 50, max: 1000, markers: [50, 100, 250, 500, 750, 1000], value: 100},
    {id: "zoomSpeed", type: "slider", name: "How fast the zoom / lens size changes", min: 0.1, max: 5, markers: [0.1, 0.5, 1, 2, 3, 4, 5], value: 0.5},
];

const CSS = `
.vc-imgzoom-lens {
    position: absolute;
    inset: 0;
    z-index: 9999;
    border: 2px solid grey;
    border-radius: 50%;
    overflow: hidden;
    cursor: none;
    box-shadow: inset 0 0 10px 2px grey;
    filter: drop-shadow(0 0 2px grey);
    pointer-events: none;
    margin: -2px;
}
.vc-imgzoom-square { border-radius: 0; }
.vc-imgzoom-nearest-neighbor > .vc-imgzoom-image { image-rendering: pixelated; }
`;

// Vencord patches the media viewer's image component; BD has no code patches, so the image is found in the DOM.
// shortcut: media viewer matched by class name, update MEDIA_VIEWER if Discord renames it.
const MEDIA_VIEWER = '[class*="layerContainer"], [class*="carouselModal"], [class*="mediaViewer"], [role="dialog"]';

const debounce = (fn, ms) => { let t; return v => { clearTimeout(t); t = setTimeout(() => fn(v), ms); }; };

// Same URL rewrite as Vencord's imageSrc memo (full-size, animated)
function imageSrc(src) {
    try {
        const url = new URL(src);
        if (url.protocol !== "http:" && url.protocol !== "https:") return src;
        if (url.pathname.startsWith("/attachments/")) url.hostname = "cdn.discordapp.com";
        url.searchParams.delete("width"); url.searchParams.delete("height"); // DOM src is the resized preview
        url.searchParams.set("animated", "true");
        return url.toString();
    } catch {
        return src;
    }
}

module.exports = class ImageZoom {
    constructor() {
        this.settings = Object.fromEntries(SETTINGS.map(s => [s.id, s.value]));
        this.target = null;
        this.over = false;
        this.down = false;
        this.shift = false;
        this.handlers = {
            keydown: e => { if (e.key === "Shift") this.shift = true; },
            keyup: e => { if (e.key === "Shift") this.shift = false; },
            mouseover: e => { if (this.target) this.over = this.target.contains(e.target); },
            mousemove: e => this.updateMousePosition(e),
            mousedown: e => this.onMouseDown(e),
            mouseup: () => { this.down = false; this.setOpacity(0); },
            wheel: e => this.onWheel(e),
            click: e => { if (this.target?.contains(e.target)) e.stopPropagation(); }, // Vencord: onClick stopPropagation
        };
    }

    start() {
        Object.assign(this.settings, BdApi.Data.load(NAME, "settings"));
        BdApi.DOM.addStyle(NAME, CSS);
        this.dispatcher = BdApi.Webpack.getStore("ChannelStore")?._dispatcher;
        this.SliderControl = BdApi.Webpack.getModule(BdApi.Webpack.Filters.byStrings("sliderContainer", "slider", "handleSize:16"), {searchExports: true});
        this.element = document.createElement("div");
        this.element.classList.add("MagnifierContainer");
        document.body.appendChild(this.element);
        for (const [type, fn] of Object.entries(this.handlers)) document.addEventListener(type, fn, type === "click");
        this.unpatchMenu = BdApi.ContextMenu.patch("image-context", (tree, props) => this.imageContextMenuPatch(tree, props));
    }

    stop() {
        for (const [type, fn] of Object.entries(this.handlers)) document.removeEventListener(type, fn, type === "click");
        this.unpatchMenu?.();
        this.unmountLens();
        this.element?.remove();
        BdApi.DOM.removeStyle(NAME);
        if (this.saveTimer) { clearTimeout(this.saveTimer); BdApi.Data.save(NAME, "settings", this.settings); } // flush pending
    }

    save() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => { this.saveTimer = null; BdApi.Data.save(NAME, "settings", this.settings); }, 300); // wheel fires fast
    }

    set(id, value) {
        this.settings[id] = value;
        this.save();
        this.applyClasses();
    }

    findTarget(el) {
        if (!el || (el.tagName !== "IMG" && el.tagName !== "VIDEO")) return null;
        if (el.classList.contains("emoji") || el.closest('[id^="chat-messages-"], [class*="avatar"]') || !el.closest(MEDIA_VIEWER)) return null;
        const r = el.getBoundingClientRect();
        return r.width >= 100 && r.height >= 100 ? el : null;
    }

    onMouseDown(e) {
        const t = e.button === 0 && this.findTarget(e.target);
        if (!t) return;
        e.preventDefault(); // Vencord: draggable=false
        if (t !== this.target) this.mountLens(t);
        this.over = true;
        this.down = true;
        this.zoom = this.settings.zoom;
        this.size = this.settings.size;
        // close context menu if open
        if (document.getElementById("image-context")) this.dispatcher?.dispatch({type: "CONTEXT_MENU_CLOSE"});
        this.updateMousePosition(e);
        this.setOpacity(1);
    }

    onWheel(e) {
        if (!this.target || !this.over || !this.down) return;
        const dir = this.settings.invertScroll ? -1 : 1;
        if (!this.shift) {
            const val = this.zoom + ((e.deltaY / 100) * dir) * this.settings.zoomSpeed;
            this.zoom = val <= 1 ? 1 : val;
            if (this.settings.saveZoomValues) { this.settings.zoom = this.zoom; this.save(); }
        } else {
            const val = this.size + (e.deltaY * dir) * this.settings.zoomSpeed;
            this.size = val <= 50 ? 50 : val;
            if (this.settings.saveZoomValues) { this.settings.size = this.size; this.save(); }
        }
        this.updateMousePosition(e);
    }

    mountLens(target) {
        this.unmountLens();
        this.target = target;
        const animated = target.tagName === "VIDEO";
        this.lens = document.createElement("div");
        this.inner = document.createElement(animated ? "video" : "img");
        if (animated) {
            Object.assign(this.inner, {src: target.currentSrc || target.src, autoplay: true, loop: true, muted: true});
            this.inner.style.position = "absolute";
            this.sync = () => { this.inner.currentTime = target.currentTime; };
            target.addEventListener("timeupdate", this.sync);
        } else {
            this.inner.className = "vc-imgzoom-image";
            this.inner.alt = "";
            this.inner.style.position = "absolute";
            this.inner.src = imageSrc(target.currentSrc || target.src);
        }
        this.lens.appendChild(this.inner);
        this.element.appendChild(this.lens);
        this.applyClasses();
        this.setOpacity(0);
    }

    unmountLens() {
        if (this.sync) this.target?.removeEventListener("timeupdate", this.sync);
        this.lens?.remove();
        this.lens = this.inner = this.target = this.sync = null;
        this.over = this.down = false;
    }

    applyClasses() {
        if (!this.lens) return;
        this.lens.className = "vc-imgzoom-lens"
            + (this.settings.nearestNeighbour ? " vc-imgzoom-nearest-neighbor" : "")
            + (this.settings.square ? " vc-imgzoom-square" : "");
    }

    setOpacity(o) {
        if (this.lens) this.lens.style.opacity = o;
    }

    updateMousePosition(e) {
        if (!this.target) return;
        if (!this.target.isConnected) return this.unmountLens(); // media viewer closed
        if (!(this.over && this.down)) return this.setOpacity(0);
        const box = this.target.getBoundingClientRect();
        const offset = this.size / 2;
        const x = -((e.pageX - box.left) * this.zoom - offset);
        const y = -((e.pageY - box.top) * this.zoom - offset);
        Object.assign(this.lens.style, {
            width: this.size + "px",
            height: this.size + "px",
            transform: `translate(${e.clientX - offset}px, ${e.clientY - offset}px)`,
            opacity: 1,
        });
        Object.assign(this.inner.style, this.inner.tagName === "VIDEO"
            ? {left: x + "px", top: y + "px"}
            : {transform: `translate(${x}px, ${y}px)`});
        this.inner.width = box.width * this.zoom;
        this.inner.height = box.height * this.zoom;
    }

    imageContextMenuPatch(tree, props) {
        // Discord re-uses the image context menu for links to for the copy and open buttons
        if ("href" in props) return;
        // emojis in user statuses
        if (props.target?.classList?.contains("emoji")) return;
        const children = Array.isArray(tree?.props?.children) ? tree.props.children : null;
        if (!children) return;

        const {React, ContextMenu} = BdApi;
        let rerender = () => {};
        try { rerender = React.useReducer(x => x + 1, 0)[1]; } catch {} // like settings.use: keep checkboxes live
        const toggle = id => () => { this.set(id, !this.settings[id]); rerender(); };
        const h = React.createElement;
        const slider = (id, label, min, max, fmt, menuId = id) => this.SliderControl && h(ContextMenu.ControlItem, {
            id: "vc-" + menuId, label,
            control: (p, ref) => h(this.SliderControl, {
                ref, ...p, minValue: min, maxValue: max, value: this.settings[id],
                onChange: debounce(v => this.set(id, v), 100),
                renderValue: fmt,
            }),
        });
        const fmtX = v => `${v.toFixed(3)}x`;

        children.push(h(ContextMenu.Group, {id: "image-zoom"},
            h(ContextMenu.CheckboxItem, {id: "vc-square", label: "Square Lens", checked: this.settings.square, action: toggle("square")}),
            h(ContextMenu.CheckboxItem, {id: "vc-nearest-neighbour", label: "Nearest Neighbour", checked: this.settings.nearestNeighbour, action: toggle("nearestNeighbour")}),
            slider("zoom", "Zoom", 1, 50, fmtX),
            slider("size", "Lens Size", 50, 1000),
            slider("zoomSpeed", "Zoom Speed", 0.1, 5, fmtX, "zoom-speed"),
        ));
    }

    getSettingsPanel() {
        return BdApi.UI.buildSettingsPanel({
            settings: SETTINGS.map(s => ({...s, value: this.settings[s.id], stickToMarkers: false})),
            onChange: (_, id, value) => this.set(id, value),
        });
    }
};
