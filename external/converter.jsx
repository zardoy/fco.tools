import { useState, useEffect, useRef, useCallback } from "react";
import JSZip from "jszip";
import {
  Zap, Image as LucideImage, Video, Music, FileText, Archive,
  PenLine, File as FileIcon, FolderOpen, Download,
  RotateCcw, Settings, ArrowRight, CheckCircle2, X, AlertCircle,
  Layers, Command, FolderInput, PackageOpen, Share2, GripHorizontal
} from "lucide-react";
import {
  loadCachedFormats, initializeFormats, getFormats, findFormatByExtension, findFormatByMime,
  tryConvertByTraversing, downloadFile
} from "./conversionService.ts";

// ─── CATEGORY CONFIG ─────────────────────────────────────────────────────────

const CATEGORY_STYLES = {
  image:   { label: "Images",    color: "#FF6B9D", Icon: LucideImage },
  video:   { label: "Video",     color: "#C77DFF", Icon: Video },
  audio:   { label: "Audio",     color: "#4CC9F0", Icon: Music },
  text:    { label: "Documents", color: "#F8B500", Icon: FileText },
  archive: { label: "Archives",  color: "#06FFB4", Icon: Archive },
  vector:  { label: "Vector",    color: "#FF9F43", Icon: PenLine },
  other:   { label: "Other",     color: "#888888", Icon: FileIcon },
};

function getCategoryStyle(category) {
  const cat = Array.isArray(category) ? category[0] : category;
  return CATEGORY_STYLES[cat?.toLowerCase()] || CATEGORY_STYLES.other;
}

function normalizeCategory(raw) {
  const cat = Array.isArray(raw) ? raw[0] : raw;
  return CATEGORY_STYLES[cat?.toLowerCase()] ? cat.toLowerCase() : "other";
}

function getFileCategory(ext, formats) {
  const extUpper = ext?.toUpperCase();
  const format = formats?.find(f => f.format.extension.toUpperCase() === extUpper);
  if (format) {
    const cat = Array.isArray(format.format.category) ? format.format.category[0] : format.format.category;
    return cat?.toLowerCase() || "other";
  }
  return null;
}

function deduplicateFormats(formats) {
  const seen = new Set();
  return formats.filter(f => {
    const key = f.format.format.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const fmtBytes = b => {
  if (!b) return "0 B";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(2) + " MB";
};
const fmtSec = s => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

/** Truncate middle of long filenames: "very-long-nam…xt" */
const truncateMid = (str, max = 30) => {
  if (str.length <= max) return str;
  const half = Math.floor((max - 1) / 2);
  return str.slice(0, half) + "…" + str.slice(-half);
};

// Shared muted text — change here to keep all secondary/hint text in sync
const MUTED_TEXT_COLOR = "#ffffff44";
const MUTED_TEXT_COLOR_BRIGHTER = "#ffffff66"; // footer, key hints

// ─── RECENTLY USED FORMATS ────────────────────────────────────────────────────
const RECENT_FORMATS_KEY = "fco_recent_formats";
const RECENT_MAX = 8;

function loadRecentFormats() {
  try {
    const raw = localStorage.getItem(RECENT_FORMATS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveRecentFormat(category, formatKey) {
  try {
    const map = loadRecentFormats();
    const list = map[category] ? map[category].filter(k => k !== formatKey) : [];
    list.unshift(formatKey);
    map[category] = list.slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_FORMATS_KEY, JSON.stringify(map));
  } catch {}
}

const features = [
  { Icon: Zap,          color: "#F8B500", title: "Secure & Unlimited",         desc: "Convert as many files as you want, fully offline. Your files never leave your device." },
  { Icon: Share2,       color: "#FF6B9D", title: "Work in Comfort",             desc: "Most flexible next-era converter — share anywhere, work your way for advanced users." },
  { Icon: Layers,       color: "#4CC9F0", title: "All-in-One Converter",        desc: "Images, video, audio, docs, archives — every converter, powered by the best open-source tools." },
];

// ─── SETTINGS HOOK ────────────────────────────────────────────────────────────

function useSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem("convertr_settings");
      return saved ? { autoDownload: true, ...JSON.parse(saved) } : { autoDownload: true };
    } catch { return { autoDownload: true }; }
  });
  const updateSetting = useCallback((key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem("convertr_settings", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  return [settings, updateSetting];
}


// ─── PILL BADGE ───────────────────────────────────────────────────────────────

function Pill({ label, color, selected, onClick, tiny }) {
  const [hov, setHov] = useState(false);
  return (
    <span onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "inline-block", padding: tiny ? "2px 7px" : "5px 12px",
        borderRadius: 7, fontSize: tiny ? 10 : 12, fontFamily: "'JetBrains Mono',monospace",
        fontWeight: 700, letterSpacing: 1, cursor: "pointer", userSelect: "none", transition: "all 0.15s",
        color: selected ? "#111" : color,
        background: selected ? color : hov ? `${color}28` : `${color}0f`,
        border: `1px solid ${color}${selected ? "dd" : hov ? "88" : "33"}`,
        boxShadow: selected ? `0 0 18px ${color}aa` : hov ? `0 0 12px ${color}55` : `0 0 6px ${color}1a`,
      }}>{label}</span>
  );
}

// ─── SETTINGS TOGGLE ─────────────────────────────────────────────────────────

function SettingsToggle({ label, checked, onChange, desc }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
      <div onClick={() => onChange(!checked)} style={{
        width: 36, height: 20, borderRadius: 10, flexShrink: 0, marginTop: 1,
        background: checked ? "linear-gradient(90deg,#06FFB4,#4CC9F0)" : "#ffffff15",
        border: `1px solid ${checked ? "#06FFB4" : "#ffffff20"}`,
        position: "relative", transition: "all 0.2s", cursor: "pointer",
        boxShadow: checked ? "0 0 12px #06FFB455" : "none",
      }}>
        <div style={{
          width: 14, height: 14, borderRadius: "50%", background: "#fff",
          position: "absolute", top: 2, left: checked ? 18 : 2,
          transition: "left 0.2s", boxShadow: "0 1px 4px #00000044",
        }} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: "#ffffffcc", fontWeight: 600 }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: MUTED_TEXT_COLOR, marginTop: 2, lineHeight: 1.5 }}>{desc}</div>}
      </div>
    </label>
  );
}

// ─── FORMAT COLUMNS ───────────────────────────────────────────────────────────

function FormatColumn({ side, query, formats, selected, onSelect }) {
  const filtered = query
    ? formats.filter(f =>
        f.format.format.toLowerCase().includes(query.toLowerCase()) ||
        f.format.name.toLowerCase().includes(query.toLowerCase()) ||
        f.format.extension.toLowerCase().includes(query.toLowerCase()))
    : formats;

  const grouped = {};
  const seenKeys = new Set();
  filtered.forEach(f => {
    const rawCat = Array.isArray(f.format.category) ? f.format.category[0] : f.format.category;
    const cat = normalizeCategory(rawCat);
    const dedupeKey = `${cat}:${f.format.format.toUpperCase()}`;
    if (seenKeys.has(dedupeKey)) return;
    seenKeys.add(dedupeKey);
    const style = getCategoryStyle(cat);
    if (!grouped[cat]) grouped[cat] = { ...style, formats: [] };
    grouped[cat].formats.push(f);
  });

  const entries = Object.entries(grouped);
  if (!entries.length) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#ffffff22", fontSize: 12, fontFamily: "'JetBrains Mono',monospace" }}>
      No matches
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", scrollbarWidth: "thin", scrollbarColor: "#ffffff1a transparent" }}>
      <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#ffffff33", letterSpacing: 2, marginBottom: 14, textTransform: "uppercase" }}>
        {side === "from" ? "FROM" : "TO"}
      </div>
      {entries.map(([cat, data]) => {
        const { Icon } = data;
        return (
          <div key={cat} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: data.color, letterSpacing: 1, marginBottom: 8, fontFamily: "'JetBrains Mono',monospace", display: "flex", alignItems: "center", gap: 5, textShadow: `0 0 8px ${data.color}` }}>
              <Icon size={11} color={data.color} /> {data.label.toUpperCase()}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {data.formats.map(f => {
                const isSelected = selected && selected.format.format === f.format.format && selected.format.mime === f.format.mime;
                return (
                  <Pill key={`${f.format.format}-${f.index}`} label={f.format.format.toUpperCase()} color={data.color} tiny
                    selected={isSelected} onClick={() => onSelect(isSelected ? null : f)} />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── FILE ICON BOX ────────────────────────────────────────────────────────────

function FileIconBox({ ext, cat, size = 64, formats }) {
  const fileCat = cat || getFileCategory(ext, formats);
  const style = getCategoryStyle(fileCat);
  const { color, Icon } = style;
  const iconSize = Math.max(Math.floor(size * 0.36), 12);
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.18, background: `${color}15`,
      border: `2px solid ${color}55`, boxShadow: `0 0 ${size * 0.5}px ${color}33`,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, flexShrink: 0,
    }}>
      <Icon size={iconSize} color={color} />
      {size > 28 && <span style={{ fontSize: Math.max(size * 0.13, 8), fontFamily: "'JetBrains Mono',monospace", fontWeight: 900, color, letterSpacing: 0.5 }}>.{ext?.toUpperCase()}</span>}
    </div>
  );
}

// ─── DONE SCREEN ─────────────────────────────────────────────────────────────

function DoneScreen({ resultFiles, targetFormat, elapsed, total, totSize, onDone, settings, updateSetting, isSingleFile, savedToDir }) {
  const [shareState, setShareState] = useState("idle"); // idle | sharing | done | error | unsupported
  const [zipState, setZipState]     = useState("idle");
  const dragUrlRef = useRef(null);

  const canShare = typeof navigator.share === "function";

  const BIG_BTN_BASE = {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 10, width: 148, height: 128, borderRadius: 24,
    background: "transparent", cursor: "pointer",
    fontFamily: "'JetBrains Mono',monospace",
    transition: "transform 0.15s, box-shadow 0.15s",
  };

  // Build an object-URL once per result file and keep it for drag
  useEffect(() => {
    const rf = resultFiles[0];
    if (!rf) return;
    const blob = new Blob([rf.bytes], { type: rf.mime });
    const url = URL.createObjectURL(blob);
    dragUrlRef.current = { url, name: rf.name, mime: rf.mime };
    return () => URL.revokeObjectURL(url);
  }, [resultFiles]);

  async function handleShare() {
    const rf = resultFiles[0];
    if (!rf || !canShare) return;
    setShareState("sharing");
    try {
      const blob = new Blob([rf.bytes], { type: rf.mime });
      const file = new File([blob], rf.name, { type: rf.mime });
      const shareData = { files: [file] };
      // Check if the browser can share this file type
      if (navigator.canShare && !navigator.canShare(shareData)) {
        // Fall back to URL-only share (mobile without file support)
        const url = URL.createObjectURL(blob);
        await navigator.share({ title: rf.name, url });
        URL.revokeObjectURL(url);
      } else {
        await navigator.share(shareData);
      }
      setShareState("done");
      setTimeout(() => setShareState("idle"), 3000);
    } catch (err) {
      if (err.name === "AbortError") {
        setShareState("idle"); // user dismissed — not an error
      } else {
        console.error("[Share] failed:", err);
        setShareState("error");
        setTimeout(() => setShareState("idle"), 3000);
      }
    }
  }

  async function handleZip() {
    if (zipState === "zipping") return;
    setZipState("zipping");
    try {
      const zip = new JSZip();
      for (const rf of resultFiles) zip.file(rf.name, rf.bytes);
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `converted-${targetFormat?.format.extension || "files"}.zip`;
      a.click();
      setZipState("done");
      setTimeout(() => setZipState("idle"), 3000);
    } catch (err) {
      console.error("[Zip] failed:", err);
      setZipState("error");
      setTimeout(() => setZipState("idle"), 3000);
    }
  }

  function handleDownload(rf) { downloadFile(rf.bytes, rf.name, rf.mime); }
  function handleDownloadAll() { resultFiles.forEach(rf => handleDownload(rf)); }

  // Drag the converted file out of the browser window
  function handleDragStart(e) {
    const d = dragUrlRef.current;
    if (!d) return;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("DownloadURL", `${d.mime}:${d.name}:${d.url}`);
  }

  return (
    <div style={{ padding: "28px 24px", maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <CheckCircle2 size={28} color="#06FFB4" />
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>All Done!</div>
            <div style={{ fontSize: 12, color: "#ffffff44", fontFamily: "'JetBrains Mono',monospace", marginTop: 2 }}>
              {total} file{total !== 1 ? "s" : ""} · {fmtBytes(totSize)} · Completed in {fmtSec(elapsed)}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 42, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1, background: "linear-gradient(90deg,#06FFB4,#4CC9F0)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>100%</div>
      </div>

      {/* Progress bar full */}
      <div style={{ height: 6, background: "#ffffff08", borderRadius: 3, marginBottom: 24, overflow: "hidden" }}>
        <div style={{ height: "100%", width: "100%", borderRadius: 3, background: "linear-gradient(90deg,#06FFB4,#4CC9F0)", boxShadow: "0 0 14px #06FFB4" }} />
      </div>

      {/* ── SINGLE FILE: Download + Share + Drag ── */}
      {isSingleFile && resultFiles.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", marginBottom: 16 }}>

            {/* Drag-out handle — highlighted first */}
            <div
              draggable
              onDragStart={handleDragStart}
              title="Drag to save the file anywhere on your desktop"
              style={{
                ...BIG_BTN_BASE, border: "2px solid #C77DFF", color: "#C77DFF",
                boxShadow: "0 0 32px #C77DFF55", cursor: "grab", userSelect: "none",
                animation: "dragGlow 2s ease-in-out infinite",
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.background = "#C77DFF10"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.background = "transparent"; }}>
              <GripHorizontal size={38} strokeWidth={2.2} />
              <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1 }}>DRAG OUT</span>
            </div>

            {/* Download */}
            <button onClick={() => handleDownload(resultFiles[0])} style={{
              ...BIG_BTN_BASE, border: "2px solid #06FFB4", color: "#06FFB4",
              boxShadow: "0 0 24px #06FFB433",
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 0 40px #06FFB466"; e.currentTarget.style.background = "#06FFB410"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 0 24px #06FFB433"; e.currentTarget.style.background = "transparent"; }}>
              <Download size={34} strokeWidth={2.2} />
              <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1 }}>DOWNLOAD</span>
            </button>

            {/* Share (Web Share API) */}
            <button onClick={canShare ? handleShare : undefined}
              disabled={!canShare}
              title={!canShare ? "Web Share API not available in this browser" : "Share / send file"}
              style={{
                ...BIG_BTN_BASE,
                border: `2px solid ${shareState === "done" ? "#06FFB4" : shareState === "error" ? "#ff4444" : canShare ? "#FF6B9D" : "#ffffff18"}`,
                color: shareState === "done" ? "#06FFB4" : shareState === "error" ? "#ff4444" : canShare ? "#FF6B9D" : "#ffffff22",
                cursor: canShare ? "pointer" : "not-allowed",
                boxShadow: canShare ? `0 0 24px ${shareState === "done" ? "#06FFB433" : "#FF6B9D33"}` : "none",
              }}
              onMouseEnter={e => { if (canShare) { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.background = "#FF6B9D10"; } }}
              onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.background = "transparent"; }}>
              {shareState === "done" ? <CheckCircle2 size={34} strokeWidth={2.2} /> :
               shareState === "error" ? <AlertCircle size={34} strokeWidth={2.2} /> :
               <Share2 size={34} strokeWidth={2.2} />}
              <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1 }}>
                {shareState === "done" ? "SHARED!" : shareState === "error" ? "FAILED" : shareState === "sharing" ? "SHARING…" : "SHARE"}
              </span>
            </button>

          </div>

          <p style={{ textAlign: "center", fontSize: 11, color: MUTED_TEXT_COLOR, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.6, maxWidth: 380, margin: "0 auto" }}>
            Don't waste time with download-move — drag the file directly into the folder you need
          </p>
        </div>
      )}

      {/* ── MULTI FILE: saved to dir notice OR download + zip buttons ── */}
      {!isSingleFile && resultFiles.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          {savedToDir ? (
            <div style={{ textAlign: "center", padding: "16px 24px", background: "#06FFB410", border: "1px solid #06FFB433", borderRadius: 16, marginBottom: 16 }}>
              <FolderInput size={28} color="#06FFB4" style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 14, fontWeight: 700, color: "#06FFB4", fontFamily: "'JetBrains Mono',monospace" }}>Saved directly to folder</div>
              <div style={{ fontSize: 11, color: "#06FFB466", marginTop: 4, fontFamily: "'JetBrains Mono',monospace" }}>{resultFiles.length} file{resultFiles.length !== 1 ? "s" : ""} written</div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
              {/* Download all */}
              <button onClick={handleDownloadAll} style={{
                ...BIG_BTN_BASE, border: "2px solid #06FFB4", color: "#06FFB4",
                boxShadow: "0 0 24px #06FFB433",
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 0 40px #06FFB466"; e.currentTarget.style.background = "#06FFB410"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 0 24px #06FFB433"; e.currentTarget.style.background = "transparent"; }}>
                <Download size={34} strokeWidth={2.2} />
                <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1 }}>DOWNLOAD {resultFiles.length} FILES</span>
              </button>

              {/* ZIP download */}
              <button onClick={handleZip} style={{
                ...BIG_BTN_BASE, border: "2px solid #F8B500", color: "#F8B500",
                boxShadow: "0 0 24px #F8B50033",
                animation: zipState === "idle" ? "none" : "none",
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 0 40px #F8B50066"; e.currentTarget.style.background = "#F8B50010"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 0 24px #F8B50033"; e.currentTarget.style.background = "transparent"; }}>
                <PackageOpen size={34} strokeWidth={2.2} />
                <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1 }}>
                  {zipState === "zipping" ? "ZIPPING…" : zipState === "done" ? "DOWNLOADED!" : zipState === "error" ? "ZIP FAILED" : "DOWNLOAD ZIP"}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Settings inline */}
      <div style={{ background: "#0C0D1A", border: "1px solid #ffffff0a", borderRadius: 14, padding: "14px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
          <Settings size={12} color={MUTED_TEXT_COLOR} />
          <span style={{ fontSize: 10, color: MUTED_TEXT_COLOR, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 2 }}>SETTINGS</span>
        </div>
        <SettingsToggle
          label="Auto download on single file convert"
          checked={settings.autoDownload}
          onChange={v => updateSetting("autoDownload", v)}
          desc="Automatically download file as soon as conversion completes"
        />
      </div>

      {/* Convert more */}
      <div style={{ textAlign: "center" }}>
        <button onClick={onDone} style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "#ffffff08", border: "1px solid #ffffff18", borderRadius: 14,
          padding: "12px 28px", fontSize: 13, fontWeight: 700, color: "#ffffff66",
          cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", transition: "all 0.15s",
        }}
          onMouseEnter={e => { e.currentTarget.style.background = "#ffffff12"; e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "#ffffff08"; e.currentTarget.style.color = "#ffffff66"; }}>
          <RotateCcw size={14} /> Convert More
        </button>
      </div>
    </div>
  );
}

// ─── CONVERSION PROGRESS ──────────────────────────────────────────────────────

function ConversionProgress({ files, targetFormat, onDone, formats, settings, updateSetting, dirHandle, moveOriginalsHandle }) {
  const [items, setItems] = useState(() => {
    console.log("[ConversionProgress] init with", files.length, "files, target:", targetFormat?.format?.format, targetFormat?.format?.mime);
    files.forEach((f, i) => console.log(`  [${i}] name=${f.name} ext=${f.ext} size=${f.size} hasFile=${!!f.file}`));
    return files.map((f, i) => ({ ...f, id: i, progress: 0, status: "pending", savedName: null }));
  });
  const [curIdx, setCurIdx] = useState(0);
  const [startMs] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const [resultFiles, setResultFiles] = useState([]);
  const [savedToDir, setSavedToDir] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startMs) / 1000)), 400);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (curIdx >= items.length) { setDone(true); return; }

    const convertFile = async () => {
      const currentFile = items[curIdx];
      setItems(prev => prev.map((f, i) => i === curIdx ? { ...f, status: "converting" } : f));

      let progTimer;
      try {
        let prog = 0;
        const bump = () => {
          prog = Math.min(prog + 5, 90);
          setItems(prev => prev.map((f, i) => i === curIdx ? { ...f, progress: prog } : f));
          if (prog < 90) progTimer = setTimeout(bump, 80);
        };
        bump();

        console.log(`[Convert ${curIdx}] reading ${currentFile.name} (${currentFile.size} bytes)…`);
        const inputBuffer = await currentFile.file.arrayBuffer();
        const inputBytes = new Uint8Array(inputBuffer);
        console.log(`[Convert ${curIdx}] arrayBuffer → ${inputBytes.length} bytes`);
        const fromFormat = findFormatByExtension(currentFile.ext) || findFormatByMime(currentFile.file.type);
        console.log(`[Convert ${curIdx}] fromFormat:`, fromFormat ? `${fromFormat.format.format} (${fromFormat.format.mime})` : "NULL");
        console.log(`[Convert ${curIdx}] targetFormat:`, targetFormat ? `${targetFormat.format.format} (${targetFormat.format.mime})` : "NULL");
        if (!fromFormat || !targetFormat) throw new Error(`Format not found — from=${!!fromFormat} to=${!!targetFormat}`);

        const result = await tryConvertByTraversing(
          [{ name: currentFile.name, bytes: inputBytes }],
          fromFormat, targetFormat
        );
        console.log(`[Convert ${curIdx}] result:`, result ? `${result.files.length} files, path: ${result.path.map(n => n.format.format).join(" → ")}` : "NULL");
        if (!result) throw new Error("Conversion failed — tryConvertByTraversing returned null");

        clearTimeout(progTimer);
        const dotIndex = currentFile.name.lastIndexOf(".");
        const baseName = dotIndex !== -1 ? currentFile.name.substring(0, dotIndex) : currentFile.name;
        const outputName = `${baseName}.${targetFormat.format.extension}`;
        const bytes = result.files[0].bytes;
        console.log(`[Convert ${curIdx}] output: ${outputName}, ${bytes.length} bytes, mime=${targetFormat.format.mime}`);

        // Write directly to directory if handle available (folder mode)
        if (dirHandle) {
          try {
            const fileHandle = await dirHandle.getFileHandle(outputName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(bytes);
            await writable.close();
            console.log(`[Convert ${curIdx}] written to dir: ${outputName}`);
            setSavedToDir(true);
            setItems(prev => prev.map((f, i) => i === curIdx ? { ...f, savedName: outputName } : f));
            // Move original to subfolder if requested
            if (moveOriginalsHandle) {
              try {
                const srcHandle = await dirHandle.getFileHandle(currentFile.name);
                const srcFile = await srcHandle.getFile();
                const srcBytes = new Uint8Array(await srcFile.arrayBuffer());
                const destHandle = await moveOriginalsHandle.getFileHandle(currentFile.name, { create: true });
                const destWritable = await destHandle.createWritable();
                await destWritable.write(srcBytes);
                await destWritable.close();
                await dirHandle.removeEntry(currentFile.name);
                console.log(`[Convert ${curIdx}] moved original ${currentFile.name} to originals folder`);
              } catch (err) {
                if (err.name !== "AbortError") console.warn(`[Convert ${curIdx}] move original failed:`, err);
              }
            }
          } catch (err) {
            if (err.name !== "AbortError") console.warn(`[Convert ${curIdx}] dir write failed, falling back to download:`, err);
            downloadFile(bytes, outputName, targetFormat.format.mime);
          }
        } else {
          setResultFiles(prev => [...prev, { bytes, name: outputName, mime: targetFormat.format.mime }]);
          // Only auto-download for single-file mode
          if (files.length === 1 && settings.autoDownload) {
            downloadFile(bytes, outputName, targetFormat.format.mime);
          }
        }

        setItems(prev => prev.map((f, i) => i === curIdx ? { ...f, progress: 100, status: "done" } : f));
        setTimeout(() => setCurIdx(c => c + 1), 300);
      } catch (e) {
        clearTimeout(progTimer);
        if (e.name !== "AbortError") console.error("Conversion error:", e);
        setItems(prev => prev.map((f, i) => i === curIdx ? { ...f, progress: 100, status: "error" } : f));
        setTimeout(() => setCurIdx(c => c + 1), 300);
      }
    };

    convertFile();
  }, [curIdx]);

  const total = items.length;
  const compCnt = items.filter(f => f.status === "done").length;
  const pct = total ? Math.floor((compCnt / total) * 100) : 0;
  const avgSec = elapsed / Math.max(compCnt, 1);
  const eta = done ? 0 : Math.ceil((total - compCnt) * avgSec);
  const totSize = items.reduce((a, f) => a + f.size, 0);
  const targetExt = targetFormat?.format.extension || "out";

  if (done && !dirHandle) {
    return (
      <DoneScreen
        resultFiles={resultFiles}
        targetFormat={targetFormat}
        elapsed={elapsed}
        total={total}
        totSize={totSize}
        onDone={onDone}
        settings={settings}
        updateSetting={updateSetting}
        isSingleFile={total === 1}
        savedToDir={savedToDir}
      />
    );
  }

  const allDone = done || (dirHandle && compCnt + items.filter(f => f.status === "error").length === total);

  return (
    <div style={{ padding: "0 24px 24px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
              {allDone
                ? <CheckCircle2 size={20} color="#06FFB4" />
                : <Zap size={20} color="#FF6B9D" style={{ animation: "glow-pulse 1s ease-in-out infinite" }} />}
              {allDone ? "All Done!" : "Converting…"}
            </div>
            <div style={{ fontSize: 12, color: "#ffffff44", fontFamily: "'JetBrains Mono',monospace", marginTop: 3 }}>
              {compCnt}/{total} files · {fmtBytes(totSize)} · {allDone ? `Completed in ${fmtSec(elapsed)}` : `~${fmtSec(eta)} left`}
            </div>
          </div>
          <div style={{ fontSize: 42, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1, background: `linear-gradient(90deg,${allDone ? "#06FFB4,#4CC9F0" : "#FF6B9D,#C77DFF"})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{allDone ? "100%" : `${pct}%`}</div>
        </div>

        <div style={{ height: 8, background: "#ffffff08", borderRadius: 4, marginBottom: 20, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${allDone ? 100 : pct}%`, borderRadius: 4, transition: "width 0.3s", background: allDone ? "linear-gradient(90deg,#06FFB4,#4CC9F0)" : "linear-gradient(90deg,#FF6B9D,#C77DFF)", boxShadow: allDone ? "0 0 14px #06FFB4" : "0 0 14px #FF6B9D88" }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {items.map((f, idx) => {
            const fileCat = getFileCategory(f.ext, formats);
            const catStyle = getCategoryStyle(fileCat);
            const color = catStyle.color;
            const isCopied = copiedIdx === idx;
            return (
              <div key={f.id} style={{
                background: f.status === "converting" ? `${color}0c` : "#0A0B14",
                border: `1px solid ${f.status === "converting" ? color + "44" : f.status === "done" ? color + "22" : f.status === "error" ? "#ff444444" : "#ffffff08"}`,
                borderRadius: 12, padding: "11px 14px", opacity: f.status === "pending" ? 0.4 : 1,
                transition: "all 0.25s", boxShadow: f.status === "converting" ? `0 0 18px ${color}1a` : "none",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <FileIconBox ext={f.ext} cat={fileCat} size={32} formats={formats} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: dirHandle && f.savedName ? 4 : 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                      <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0, color: f.status === "done" ? "#06FFB4" : f.status === "error" ? "#ff4444" : f.status === "converting" ? color : "#ffffff22" }}>
                        {f.status === "done" && !dirHandle ? `✓ .${targetExt.toUpperCase()}` : f.status === "error" ? "✗ Error" : f.status === "converting" ? `${f.progress}%` : "–"}
                      </span>
                    </div>
                    {/* Saved-as label for dir mode */}
                    {dirHandle && f.savedName && (
                      <div
                        title={`Click to copy: ${f.savedName}`}
                        onClick={() => {
                          navigator.clipboard?.writeText(f.savedName).catch(() => {});
                          setCopiedIdx(idx);
                          setTimeout(() => setCopiedIdx(n => n === idx ? null : n), 2000);
                        }}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", marginBottom: 4, maxWidth: "100%" }}>
                        <span style={{ fontSize: 10, color: "#06FFB4", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>
                          {isCopied ? "✓ copied!" : `Saved as ${truncateMid(f.savedName, 32)}`}
                        </span>
                      </div>
                    )}
                    <div style={{ height: 3, background: "#ffffff08", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${f.progress}%`, transition: "width 0.08s linear", borderRadius: 2, background: f.status === "done" ? "#06FFB4" : f.status === "error" ? "#ff4444" : `linear-gradient(90deg,${color},${color}bb)`, boxShadow: f.status === "converting" ? `0 0 6px ${color}` : undefined }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: "#ffffff22", fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{fmtBytes(f.size)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Dir mode: convert-more button shown inline after all done */}
        {dirHandle && allDone && (
          <div style={{ textAlign: "center", marginTop: 24 }}>
            <button onClick={onDone} style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "#ffffff08", border: "1px solid #ffffff18", borderRadius: 14,
              padding: "12px 28px", fontSize: 13, fontWeight: 700, color: "#ffffff66",
              cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", transition: "all 0.15s",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = "#ffffff12"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#ffffff08"; e.currentTarget.style.color = "#ffffff66"; }}>
              <RotateCcw size={14} /> Convert More
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [mode, setMode] = useState("idle");
  const [file, setFile] = useState(null);
  const [folder, setFolder] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [query, setQuery] = useState("");
  const [formats, setFormats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTo, setSelectedTo] = useState(null);
  const [folderFrom, setFolderFrom] = useState(null);
  const [folderTo, setFolderTo] = useState(null);
  const [settings, updateSetting] = useSettings();
  const [convertPayload, setConvertPayload] = useState(null);
  const [folderDirHandle, setFolderDirHandle] = useState(null);
  const [moveOriginals, setMoveOriginals] = useState(false);
  const [recentFormats, setRecentFormats] = useState(() => loadRecentFormats());
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches);

  const fileInputRef = useRef();
  const rootRef = useRef();
  const quickConvertRef = useRef(null); // holds { file, singleTargets } for key handler

  const startSingleConvert = useCallback((targetFormat, sourceFile) => {
    if (!targetFormat || !sourceFile) return;
    const cat = normalizeCategory(targetFormat.format.category);
    const key = targetFormat.format.format.toUpperCase();
    saveRecentFormat(cat, key);
    setRecentFormats(loadRecentFormats());
    setConvertPayload({ files: [{ ...sourceFile, id: 0 }], target: targetFormat });
    setMode("converting");
  }, []);

  useEffect(() => {
    const m = window.matchMedia("(max-width: 768px)");
    const update = () => setIsNarrow(m.matches);
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  const showCacheButton = !import.meta.env.PROD && !isNarrow;

  // Load formats: use cache first for instant UI, then refresh in background
  useEffect(() => {
    const hadCache = loadCachedFormats();
    if (hadCache) {
      setFormats(getFormats());
      setLoading(false);
    }
    // Always run full init (refresh handlers, update cache for next load)
    initializeFormats().then(() => {
      setFormats(getFormats());
      setLoading(false);
      console.log("Built initial format list.");
    });
  }, []);

  useEffect(() => {
    const h = e => {
      if (mode === "converting") return;
      if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "Escape")    { setQuery(""); return; }
      if (e.key === "Backspace") { setQuery(q => q.slice(0, -1)); return; }
      // Press 1 in file mode → quick-convert to first suggested format
      if (e.key === "1" && mode === "file" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const { file: f, singleTargets: targets } = quickConvertRef.current || {};
        if (f && targets?.length) {
          e.preventDefault();
          startSingleConvert(targets[0], f);
        }
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) setQuery(q => q + e.key);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [mode, startSingleConvert]);

  useEffect(() => {
    const h = e => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) if (it.kind === "file") { const f = it.getAsFile(); if (f) loadFile(f); break; }
    };
    window.addEventListener("paste", h);
    return () => window.removeEventListener("paste", h);
  }, []);

  const loadFile = useCallback(f => {
    const ext = f.name.split(".").pop();
    const cat = getFileCategory(ext, formats);
    const url = cat === "image" ? URL.createObjectURL(f) : null;
    setFile({ name: f.name, ext, cat, size: f.size, url, file: f });
    setSelectedTo(null); setQuery(""); setMode("file");
  }, [formats]);

  const loadFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) return;
    // Directory picker id must be alphanumeric, hyphen, or underscore (no : / etc.)
    const pickerId = (typeof location !== "undefined" && location.origin)
      ? location.origin.replace(/[^a-zA-Z0-9_-]/g, "_")
      : "fco_folder";
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite", id: pickerId });
      const files = [];
      for await (const entry of handle.values()) {
        if (entry.kind === "file" && !entry.name.startsWith(".")) {
          const f = await entry.getFile();
          const ext = f.name.split(".").pop();
          files.push({ id: files.length, name: f.name, ext, cat: getFileCategory(ext, formats), size: f.size, file: f });
        }
      }
      setFolder({ name: handle.name, files });
      setFolderDirHandle(handle);
      setFolderFrom(null); setFolderTo(null); setQuery(""); setMode("folder");
    } catch (error) {
      if (error.name !== "AbortError") console.error("[Folder picker]", error);
      // Don't switch to empty folder view on cancel or error — stay on current page
    }
  }, [formats]);

  const handleDragOver  = e => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = e => { if (!rootRef.current?.contains(e.relatedTarget)) setIsDragOver(false); };
  const handleDrop      = e => {
    e.preventDefault(); setIsDragOver(false);
    const items = [...(e.dataTransfer.items || [])];
    const hasDir = items.some(it => { try { return it.webkitGetAsEntry()?.isDirectory; } catch { return false; } });
    if (hasDir) { loadFolder(); return; }
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  };

  const reset = () => { setMode("idle"); setFile(null); setFolder(null); setSelectedTo(null); setFolderFrom(null); setFolderTo(null); setQuery(""); setConvertPayload(null); setFolderDirHandle(null); setMoveOriginals(false); };

  const fromFormats = formats.filter(f => f.format.from);
  const toFormats = formats.filter(f => f.format.to);

  // Preferred format ordering per category — most useful first
  const PREFERRED_FORMATS = {
    image:   ["WEBP", "JPG", "JPEG", "PNG", "AVIF", "GIF", "SVG", "BMP", "TIFF"],
    video:   ["MP4", "WEBM", "MKV", "MOV", "AVI", "GIF"],
    audio:   ["MP3", "OGG", "FLAC", "WAV", "AAC", "OPUS", "M4A"],
    text:    ["PDF", "DOCX", "MD", "TXT", "HTML", "ODT"],
    archive: ["ZIP", "TAR", "GZ", "7Z", "RAR"],
  };
  const singleTargets = (() => {
    if (!file) return [];
    const ff = findFormatByExtension(file.ext) || findFormatByMime(file.file?.type);
    if (!ff) return [];
    const fileCat = normalizeCategory(ff.format.category);
    const preferred = PREFERRED_FORMATS[fileCat] || [];
    const recent = recentFormats[fileCat] || []; // e.g. ["WEBP", "JPG"]
    const filtered = deduplicateFormats(toFormats.filter(f =>
      ff.format.format !== f.format.format || ff.format.mime !== f.format.mime
    ));
    const formatKey = f => f.format.format.toUpperCase();
    return [...filtered].sort((a, b) => {
      const aCat = normalizeCategory(a.format.category);
      const bCat = normalizeCategory(b.format.category);
      const aIsSame = aCat === fileCat;
      const bIsSame = bCat === fileCat;
      if (aIsSame !== bIsSame) return aIsSame ? -1 : 1;
      if (aIsSame && bIsSame) {
        // Recent picks override the preference list
        const aRecent = recent.indexOf(formatKey(a));
        const bRecent = recent.indexOf(formatKey(b));
        if (aRecent !== bRecent) {
          if (aRecent !== -1 && bRecent === -1) return -1;
          if (bRecent !== -1 && aRecent === -1) return 1;
          return aRecent - bRecent;
        }
        const ai = preferred.indexOf(formatKey(a));
        const bi = preferred.indexOf(formatKey(b));
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      }
      return 0;
    });
  })();

  // Keep ref fresh every render so the keydown handler always sees current values
  quickConvertRef.current = { file, singleTargets };

  const folderExts = folder ? [...new Set(folder.files.map(f => f.ext.toUpperCase()))].sort() : [];
  const folderCats = folder ? [...new Set(folder.files.map(f => f.cat))] : [];
  const filteredFolderFiles = folder ? (folderFrom ? folder.files.filter(f => f.ext.toUpperCase() === folderFrom) : folder.files) : [];
  const totalSize = filteredFolderFiles.reduce((a, f) => a + f.size, 0);
  const etaSec = Math.ceil(filteredFolderFiles.length * 1.3);
  const convertFiles = convertPayload?.files || [];
  const convertTarget = convertPayload?.target || null;
  const convertDirHandle = convertPayload?.dirHandle || null;
  const convertMoveOriginalsHandle = convertPayload?.moveOriginalsHandle || null;

  const ArrowDiv = () => (
    <div style={{ width: 52, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <div style={{ width: 1, flex: 1, background: "linear-gradient(transparent,#C77DFF33,transparent)" }} />
      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#FF6B9D15,#C77DFF15)", border: "1px solid #C77DFF33", display: "flex", alignItems: "center", justifyContent: "center", color: "#C77DFF", boxShadow: "0 0 16px #C77DFF22", animation: "glow-pulse 2s ease-in-out infinite" }}>
        <ArrowRight size={14} />
      </div>
      <div style={{ width: 1, flex: 1, background: "linear-gradient(transparent,#C77DFF33,transparent)" }} />
    </div>
  );

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#07080F", color: "#E8E8FF", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk','Segoe UI',sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ marginBottom: 16, opacity: 0.6 }}><Zap size={32} color="#FF6B9D" /></div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Loading formats...</div>
          <div style={{ fontSize: 12, color: MUTED_TEXT_COLOR, fontFamily: "'JetBrains Mono',monospace" }}>Initializing conversion handlers</div>
        </div>
      </div>
    );
  }

  function downloadFormatCache() {
    try {
      const raw = localStorage.getItem("fco_tools_format_cache");
      if (!raw) { alert("No cache yet — open the app once to build it."); return; }
      const blob = new Blob([raw], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "fco-format-cache.json";
      a.click();
    } catch (e) { console.error(e); }
  }

  return (
    <div ref={rootRef} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
      style={{ height: "100%", background: "#07080F", color: "#E8E8FF", fontFamily: "'Space Grotesk','Segoe UI',sans-serif", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;700;900&display=swap');
        @keyframes fadeSlideDown{from{opacity:0;transform:translateY(-24px) scale(0.97)}to{opacity:1;transform:none}}
        @keyframes slideUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
        @keyframes glow-pulse{0%,100%{opacity:.35}50%{opacity:.9}}
        @keyframes convertPulse{0%,100%{box-shadow:0 0 28px #06FFB455}50%{box-shadow:0 0 56px #06FFB4bb}}
        @keyframes clipboardGlow{0%,100%{box-shadow:0 0 16px #FF6B9D33,0 0 0 1px #FF6B9D22}50%{box-shadow:0 0 36px #FF6B9D99,0 0 0 1px #FF6B9D66}}
        @keyframes dragGlow{0%,100%{box-shadow:0 0 24px #C77DFF33}50%{box-shadow:0 0 52px #C77DFF99,0 0 0 1px #C77DFF55}}
      `}</style>

      {/* BG grid */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.016) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.016) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      {/* BG blobs */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            position: "absolute",
            top: i === 0 ? -200 : i === 1 ? -100 : undefined, bottom: i === 2 ? -200 : undefined,
            left: i === 0 ? -200 : i === 2 ? "35%" : undefined, right: i === 1 ? -150 : undefined,
            width: i === 0 ? 500 : i === 1 ? 400 : 600, height: i === 0 ? 500 : i === 1 ? 400 : 400,
            borderRadius: "50%",
            background: `radial-gradient(circle,${["#FF6B9D18", "#4CC9F015", "#C77DFF0d"][i]},transparent 70%)`,
            animation: `glow-pulse ${[4, 5, 6][i]}s ease-in-out infinite ${[0, 1, 2][i]}s`,
          }} />
        ))}
      </div>

      {/* Drag overlay */}
      {isDragOver && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "#07080Ff0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "2px solid #FF6B9D55", pointerEvents: "none" }}>
          <div style={{ animation: "float 0.8s ease-in-out infinite", color: "#FF6B9D" }}><Download size={72} /></div>
          <div style={{ fontSize: 30, fontWeight: 700, color: "#FF6B9D", marginTop: 16, textShadow: "0 0 40px #FF6B9D" }}>Drop to Convert</div>
          <div style={{ fontSize: 13, color: MUTED_TEXT_COLOR, marginTop: 8, fontFamily: "'JetBrains Mono',monospace" }}>FILES · FOLDERS · ANYTHING</div>
        </div>
      )}

      {/* HEADER */}
      <div style={{ position: "relative", zIndex: 10, padding: "11px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #ffffff08", backdropFilter: "blur(12px)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ cursor: "pointer", display: "flex", alignItems: "center" }} onClick={reset}>
            {/* Text title — hidden in favor of title.png
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 900, fontSize: 22, lineHeight: 1, letterSpacing: -1 }}>
              <span style={{ background: "linear-gradient(90deg,#FF4500 0%,#FF8C00 25%,#FFD700 55%,#FFF176 80%,#FFE500 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", filter: "drop-shadow(0 0 12px #FF8C0066)" }}>FCO.</span>
              <span style={{ background: "linear-gradient(90deg,#FF2D78 0%,#FF6BCD 25%,#C77DFF 55%,#7B61FF 75%,#4CC9F0 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", filter: "drop-shadow(0 0 12px #C77DFF55)" }}>TOOLS</span>
            </span>
            */}
            <img src="/convert/title.png" alt="FCO.TOOLS" style={{ height: 28, width: "auto", display: "block" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1, borderLeft: "1px solid #ffffff12", paddingLeft: 12 }}>
            <span style={{ fontSize: 9, color: MUTED_TEXT_COLOR, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5, lineHeight: 1.3 }}>
              CORE PROJECT by{" "}
              <a href="https://github.com/p2r3" target="_blank" rel="noopener noreferrer" style={{ color: "#C77DFF", textDecoration: "none" }}>p2r3</a>
            </span>
            <span style={{ fontSize: 9, color: MUTED_TEXT_COLOR, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5, lineHeight: 1.3 }}>
              UI FORK by{" "}
              <a href="https://github.com/zardoy" target="_blank" rel="noopener noreferrer" style={{ color: "#4CC9F0", textDecoration: "none" }}>zardoy</a>
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {showCacheButton && (
          <button onClick={downloadFormatCache} title="Download format cache JSON"
            style={{ display: "flex", alignItems: "center", gap: 5, background: "#ffffff06", border: "1px solid #ffffff12", borderRadius: 8, padding: "5px 10px", color: MUTED_TEXT_COLOR, fontSize: 11, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", transition: "all 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.color = "#06FFB4"; e.currentTarget.style.borderColor = "#06FFB430"; }}
            onMouseLeave={e => { e.currentTarget.style.color = MUTED_TEXT_COLOR; e.currentTarget.style.borderColor = "#ffffff12"; }}>
            <Download size={11} /> cache
          </button>
          )}
          {mode !== "idle" && (
            <button onClick={reset} style={{ display: "flex", alignItems: "center", gap: 6, background: "#ffffff08", border: "1px solid #ffffff15", borderRadius: 8, padding: "5px 13px", color: "#ffffff55", fontSize: 12, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}>
              <RotateCcw size={11} /> Reset
            </button>
          )}
        </div>
      </div>

      {/* BODY */}
      <div style={{ flex: 1, position: "relative", zIndex: 5, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>

        {/* ══ IDLE ══ */}
        {mode === "idle" && (
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch" }}>
            <div style={{ padding: "18px 22px 0", animation: "slideUp 0.5s ease", flexShrink: 0 }}>
              <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 16 }}>
                {features.map((f, i) => (
                  <div key={i} style={{ background: "#0C0D1A", border: `1px solid ${f.color}18`, borderRadius: 14, padding: "16px 16px", display: "flex", gap: 12, alignItems: "flex-start", animation: `slideUp 0.5s ease ${i * 0.08}s both`, boxShadow: `0 0 24px ${f.color}07` }}>
                    <div style={{ width: 40, height: 40, borderRadius: 11, background: `${f.color}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 0 14px ${f.color}2a` }}>
                      <f.Icon size={20} color={f.color} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: f.color, marginBottom: 3 }}>{f.title}</div>
                      <div style={{ fontSize: 12, color: "#ffffff44", lineHeight: 1.6 }}>{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Controls bar */}
            <div style={{ padding: "0 22px", marginBottom: 10, flexShrink: 0 }}>
              <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div onClick={() => fileInputRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 7, background: "#ffffff07", border: "1px dashed #ffffff1a", borderRadius: 9, padding: "8px 16px", fontSize: 12, color: "#ffffff44", cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#FF6B9D55"; e.currentTarget.style.color = "#FF6B9D"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#ffffff1a"; e.currentTarget.style.color = "#ffffff44"; }}>
                  <FileIcon size={13} /> File
                </div>
                <div onClick={loadFolder} style={{ display: "flex", alignItems: "center", gap: 7, background: "#ffffff07", border: "1px dashed #ffffff1a", borderRadius: 9, padding: "8px 16px", fontSize: 12, color: "#ffffff44", cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#06FFB455"; e.currentTarget.style.color = "#06FFB4"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#ffffff1a"; e.currentTarget.style.color = "#ffffff44"; }}>
                  <FolderOpen size={13} /> In Folder Convert
                </div>

                {/* Ctrl+V hint — more visible */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#4CC9F00e", border: "1px solid #4CC9F030", borderRadius: 8, padding: "5px 12px" }}>
                  <Command size={12} color="#4CC9F0" />
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#4CC9F0", fontWeight: 700, letterSpacing: 0.5 }}>Ctrl+V</span>
                  <span style={{ fontSize: 11, color: "#4CC9F066" }}>paste · type to filter</span>
                </div>

                {query && (
                  <span style={{ background: "#C77DFF1a", border: "1px solid #C77DFF44", borderRadius: 6, padding: "3px 9px", color: "#C77DFF", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, letterSpacing: 1, display: "flex", alignItems: "center", gap: 4 }}>
                    {query}
                    <X size={11} style={{ opacity: 0.5, cursor: "pointer" }} onClick={() => setQuery("")} />
                  </span>
                )}
              </div>
            </div>

            {/* Format table */}
            <div style={{ padding: "0 22px 18px" }}>
              <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", background: "#090A12", borderRadius: 18, border: "1px solid #ffffff08", overflow: "hidden", minHeight: 320, height: "calc(100svh - 340px)", maxHeight: 600 }}>
                <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <FormatColumn side="from" query={query} formats={fromFormats} selected={null} onSelect={() => {}} />
                </div>
                <ArrowDiv />
                <div style={{ flex: 1, borderLeft: "1px solid #ffffff08", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <FormatColumn side="to" query={query} formats={toFormats} selected={null} onSelect={() => {}} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ SINGLE FILE ══ */}
        {mode === "file" && file && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0, animation: "fadeSlideDown 0.4s cubic-bezier(0.16,1,0.3,1)" }}>
            {/* Scrollable content — paddingBottom so content isn't hidden behind fixed convert bar */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", padding: "18px 22px", paddingBottom: selectedTo ? "110px" : "22px" }}>
              <div style={{ maxWidth: 900, margin: "0 auto" }}>
                {/* File card */}
                <div style={{ background: "#0C0D1A", border: `1px solid ${getCategoryStyle(file.cat).color}1a`, borderRadius: 18, padding: "18px 20px", marginBottom: 16, display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ animation: "float 3s ease-in-out infinite" }}>
                    <FileIconBox ext={file.ext} cat={file.cat} size={80} formats={formats} />
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 4, wordBreak: "break-all" }}>{file.name}</div>
                    <div style={{ fontSize: 12, color: "#ffffff33", fontFamily: "'JetBrains Mono',monospace", marginBottom: 10 }}>{fmtBytes(file.size)} · {(file.cat || "UNKNOWN").toUpperCase()}</div>
                    {file.url && (
                      <div style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${getCategoryStyle(file.cat).color}22`, display: "inline-block" }}>
                        <img src={file.url} alt="preview" style={{ display: "block", maxWidth: 180, maxHeight: 110, objectFit: "cover" }} />
                      </div>
                    )}
                  </div>
                  <button onClick={reset} style={{ background: "none", border: "1px solid #ffffff15", borderRadius: 8, color: "#ffffff33", cursor: "pointer", padding: "5px 9px", display: "flex", alignItems: "center" }}>
                    <X size={14} />
                  </button>
                </div>

                {/* Format selector */}
                <div style={{ background: "#090A12", borderRadius: 18, border: "1px solid #ffffff08", overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #ffffff06", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#ffffff33", letterSpacing: 2 }}>CONVERT TO</span>
                      {selectedTo && <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: getCategoryStyle(selectedTo.format.category).color }}>→ .{selectedTo.format.extension.toUpperCase()}</span>}
                    </div>
                    {singleTargets.length > 0 && (
                      <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color: MUTED_TEXT_COLOR, letterSpacing: 0.5 }}>
                        Press <kbd style={{ background: "#ffffff12", border: "1px solid #ffffff20", borderRadius: 3, padding: "1px 5px", fontSize: 9 }}>1</kbd> → quick-convert to <span style={{ color: getCategoryStyle(singleTargets[0]?.format.category).color }}>.{singleTargets[0]?.format.extension.toUpperCase()}</span>
                      </span>
                    )}
                  </div>
                  <div style={{ padding: "14px 16px", display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {singleTargets.map((f, idx) => {
                      const catStyle = getCategoryStyle(f.format.category);
                      const isSelected = selectedTo && selectedTo.format.format === f.format.format && selectedTo.format.mime === f.format.mime;
                      return (
                        <Pill key={`${f.format.format}-${f.index}`} label={f.format.format.toUpperCase()} color={catStyle.color}
                          selected={isSelected} onClick={() => setSelectedTo(isSelected ? null : f)} />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Fixed convert button — always visible at bottom when format selected */}
            {selectedTo && (
              <div style={{
                position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 20,
                padding: "12px 22px 18px", paddingBottom: "max(18px, env(safe-area-inset-bottom))",
                background: "linear-gradient(transparent 0%, #07080F 35%, #07080F 100%)", borderTop: "1px solid #ffffff08", backdropFilter: "blur(12px)",
              }}>
                <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 11, color: "#ffffff22", fontFamily: "'JetBrains Mono',monospace" }}>{fmtBytes(file.size)} · Est. ~2s</div>
                  <button onClick={() => startSingleConvert(selectedTo, file)} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    background: "linear-gradient(135deg,#06FFB4,#4CC9F0)", border: "none", borderRadius: 14,
                    padding: "13px 36px", fontSize: 15, fontWeight: 800, color: "#07080F", cursor: "pointer",
                    fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5,
                    animation: "convertPulse 2s ease-in-out infinite", transition: "transform 0.15s",
                  }}
                    onMouseEnter={e => e.currentTarget.style.transform = "scale(1.04)"}
                    onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                    <Zap size={16} /> Convert → .{selectedTo.format.extension.toUpperCase()}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ FOLDER ══ */}
        {mode === "folder" && folder && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0, animation: "fadeSlideDown 0.4s cubic-bezier(0.16,1,0.3,1)" }}>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", padding: "18px 22px", paddingBottom: folderTo ? "110px" : "22px" }}>
              <div style={{ maxWidth: 900, margin: "0 auto" }}>
                {/* Folder card */}
                <div style={{ background: "#0C0D1A", border: "1px solid #06FFB41a", borderRadius: 18, padding: "16px 20px", marginBottom: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ animation: "float 3s ease-in-out infinite", color: "#06FFB4" }}><FolderOpen size={48} /></div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 3 }}>{folder.name}</div>
                    <div style={{ fontSize: 12, color: "#ffffff33", fontFamily: "'JetBrains Mono',monospace", marginBottom: 8 }}>
                      {folder.files.length} files · {fmtBytes(folder.files.reduce((a, f) => a + f.size, 0))}
                      {folderDirHandle && <span style={{ marginLeft: 8, color: "#06FFB4", fontSize: 10, border: "1px solid #06FFB433", borderRadius: 4, padding: "1px 6px" }}>✓ write access</span>}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {folderCats.map(c => {
                        const catStyle = getCategoryStyle(c);
                        const { Icon } = catStyle;
                        return (
                          <span key={c} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, background: `${catStyle.color}15`, border: `1px solid ${catStyle.color}30`, color: catStyle.color, fontFamily: "'JetBrains Mono',monospace", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Icon size={9} /> {catStyle.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <button onClick={reset} style={{ background: "none", border: "1px solid #ffffff15", borderRadius: 8, color: "#ffffff33", cursor: "pointer", padding: "5px 9px", display: "flex", alignItems: "center", alignSelf: "flex-start" }}>
                    <X size={14} />
                  </button>
                </div>

                {/* FROM + TO */}
                <div style={{ background: "#090A12", borderRadius: 18, border: "1px solid #ffffff08", overflow: "hidden", marginBottom: 16, display: "grid", gridTemplateColumns: "1fr auto 1fr" }}>
                  <div style={{ padding: "14px 16px" }}>
                    <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#ffffff33", letterSpacing: 2, marginBottom: 10 }}>FILTER FROM EXTENSIONS</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {folderExts.map(ext => {
                        const cat = getFileCategory(ext, formats);
                        const catStyle = getCategoryStyle(cat);
                        return <Pill key={ext} label={ext} color={catStyle.color} tiny selected={folderFrom === ext} onClick={() => setFolderFrom(folderFrom === ext ? null : ext)} />;
                      })}
                    </div>
                    {!folderFrom && <div style={{ fontSize: 10, color: "#ffffff1a", marginTop: 8, fontFamily: "'JetBrains Mono',monospace" }}>All — no filter applied</div>}
                  </div>
                  <ArrowDiv />
                  <div style={{ padding: "14px 16px", borderLeft: "1px solid #ffffff08", overflowY: "auto", maxHeight: 300, scrollbarWidth: "thin", scrollbarColor: "#ffffff1a transparent" }}>
                    <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#ffffff33", letterSpacing: 2, marginBottom: 10 }}>CONVERT ALL TO</div>
                    {Object.entries(CATEGORY_STYLES).map(([cat, data]) => {
                      const { Icon } = data;
                      const catFormats = deduplicateFormats(toFormats.filter(f => normalizeCategory(f.format.category) === cat));
                      if (!catFormats.length) return null;
                      return (
                        <div key={cat} style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 9, color: data.color, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, letterSpacing: 1, marginBottom: 5, display: "flex", alignItems: "center", gap: 4 }}>
                            <Icon size={9} color={data.color} /> {data.label.toUpperCase()}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                            {catFormats.map(f => {
                              const isSelected = folderTo && folderTo.format.format === f.format.format && folderTo.format.mime === f.format.mime;
                              return <Pill key={`${f.format.format}-${f.index}`} label={f.format.format.toUpperCase()} color={data.color} tiny selected={isSelected} onClick={() => setFolderTo(isSelected ? null : f)} />;
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* File list */}
                <div style={{ background: "#090A12", borderRadius: 18, border: "1px solid #ffffff08", padding: "14px 16px", marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#ffffff33", letterSpacing: 2, marginBottom: 10 }}>
                    FILES TO PROCESS ({filteredFolderFiles.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 220, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "#ffffff1a transparent" }}>
                    {filteredFolderFiles.slice(0, 60).map(f => (
                      <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "#ffffff04", borderRadius: 9 }}>
                        <FileIconBox ext={f.ext} cat={f.cat} size={26} formats={formats} />
                        <span style={{ flex: 1, fontSize: 12, color: "#ffffff66", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                        <span style={{ fontSize: 10, color: "#ffffff22", fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{fmtBytes(f.size)}</span>
                      </div>
                    ))}
                    {filteredFolderFiles.length > 60 && <div style={{ textAlign: "center", fontSize: 11, color: "#ffffff22", padding: "6px 0", fontFamily: "'JetBrains Mono',monospace" }}>+{filteredFolderFiles.length - 60} more…</div>}
                  </div>
                </div>

                {/* Move originals option — only when dir write access available */}
                {folderDirHandle && folderTo && (
                  <div style={{ background: "#090A12", border: "1px solid #ffffff08", borderRadius: 14, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      onClick={() => setMoveOriginals(v => !v)}
                      style={{
                        width: 40, height: 22, borderRadius: 11, cursor: "pointer", flexShrink: 0, position: "relative", transition: "background 0.2s",
                        background: moveOriginals ? "#F8B500" : "#ffffff18",
                      }}>
                      <div style={{
                        position: "absolute", top: 3, left: moveOriginals ? 20 : 3, width: 16, height: 16,
                        borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px #00000044",
                      }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: moveOriginals ? "#F8B500" : "#ffffff88" }}>Move originals to <code style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>_originals/</code> after convert</div>
                      <div style={{ fontSize: 10, color: MUTED_TEXT_COLOR, fontFamily: "'JetBrains Mono',monospace", marginTop: 2 }}>Originals moved to a subfolder so only converted files remain <span style={{ color: "#F8B50066" }}>(you can remove it later)</span></div>
                    </div>
                  </div>
                )}

                {/* Stats */}
                {folderTo && (
                  <div style={{ display: "flex", justifyContent: "center", gap: 28, flexWrap: "wrap" }}>
                    {[["FILES", filteredFolderFiles.length, "#4CC9F0"], ["TOTAL", fmtBytes(totalSize), "#C77DFF"], ["EST.", `~${fmtSec(etaSec)}`, "#F8B500"]].map(([l, v, c]) => (
                      <div key={l} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 26, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace", color: c, textShadow: `0 0 20px ${c}66` }}>{v}</div>
                        <div style={{ fontSize: 10, color: "#ffffff33", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Fixed convert button — always visible at bottom when target format selected */}
            {folderTo && (
              <div style={{
                position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 20,
                padding: "12px 22px 18px", paddingBottom: "max(18px, env(safe-area-inset-bottom))",
                background: "linear-gradient(transparent 0%, #07080F 35%, #07080F 100%)", borderTop: "1px solid #ffffff08", backdropFilter: "blur(12px)",
              }}>
                <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 11, color: "#ffffff22", fontFamily: "'JetBrains Mono',monospace" }}>{filteredFolderFiles.length} files · {fmtBytes(totalSize)}</div>
                  <button onClick={async () => {
                    let moveHandle = null;
                    if (moveOriginals && folderDirHandle) {
                      try {
                        moveHandle = await folderDirHandle.getDirectoryHandle("_originals", { create: true });
                      } catch (err) { if (err.name !== "AbortError") console.warn("Could not create _originals folder:", err); }
                    }
                    setConvertPayload({ files: [...filteredFolderFiles], target: folderTo, dirHandle: folderDirHandle, moveOriginalsHandle: moveHandle });
                    setMode("converting");
                  }} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    background: "linear-gradient(135deg,#06FFB4,#4CC9F0)", border: "none", borderRadius: 14,
                    padding: "13px 36px", fontSize: 15, fontWeight: 800, color: "#07080F", cursor: "pointer",
                    fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5,
                    animation: "convertPulse 2s ease-in-out infinite", transition: "transform 0.15s",
                  }}
                    onMouseEnter={e => e.currentTarget.style.transform = "scale(1.04)"}
                    onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                    <Zap size={16} /> Convert {filteredFolderFiles.length} Files → .{folderTo.format.extension.toUpperCase()}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ CONVERTING ══ */}
        {mode === "converting" && (
          <div style={{ animation: "fadeSlideDown 0.4s cubic-bezier(0.16,1,0.3,1)", flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", paddingTop: 18 }}>
            <ConversionProgress
              files={convertFiles}
              targetFormat={convertTarget}
              onDone={reset}
              formats={formats}
              settings={settings}
              updateSetting={updateSetting}
              dirHandle={convertDirHandle}
              moveOriginalsHandle={convertMoveOriginalsHandle}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ position: "relative", zIndex: 10, textAlign: "center", padding: "8px 22px 12px", fontSize: 11, color: MUTED_TEXT_COLOR_BRIGHTER, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, flexShrink: 0 }}>
        TYPE TO FILTER · ESC CLEAR · CTRL+V PASTE · DROP FILES OR FOLDERS
      </div>

      <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (f) loadFile(f); }} />
    </div>
  );
}
