import type { FileFormat, FileData, FormatHandler } from "../src/FormatHandler.js";
import { ConvertPathNode } from "../src/FormatHandler.js";
import normalizeMimeType from "../src/normalizeMimeType.js";
import handlers from "../src/handlers/index.js";
import { TraversionGraph } from "../src/TraversionGraph.js";

const FORMAT_CACHE_KEY = "fco_tools_format_cache";
const FORMAT_CACHE_VERSION = 1;

let supportedFormatCache = new Map<string, FileFormat[]>();
let traversionGraph = new TraversionGraph();
let simpleMode = true;

export interface FormatOption {
  format: FileFormat;
  handler: FormatHandler;
  index: number;
}

let allOptions: FormatOption[] = [];

function buildAllOptionsFromCache(): void {
  allOptions = [];
  for (const handler of handlers) {
    const supportedFormats = supportedFormatCache.get(handler.name);
    if (!supportedFormats) continue;
    for (const format of supportedFormats) {
      if (!format.mime) continue;
      allOptions.push({ format, handler, index: allOptions.length });
    }
  }
}

/** Load format cache from localStorage and rebuild allOptions. Returns true if cache was valid and used. */
export function loadCachedFormats(): boolean {
  try {
    const raw = localStorage.getItem(FORMAT_CACHE_KEY);
    if (!raw) return false;
    const { version, cache } = JSON.parse(raw);
    if (version !== FORMAT_CACHE_VERSION || !Array.isArray(cache)) return false;
    supportedFormatCache = new Map(cache);
    traversionGraph = new TraversionGraph();
    buildAllOptionsFromCache();
    traversionGraph.init(supportedFormatCache, handlers);
    return allOptions.length > 0;
  } catch {
    return false;
  }
}

function saveFormatCache(): void {
  try {
    const cache = Array.from(supportedFormatCache.entries());
    localStorage.setItem(FORMAT_CACHE_KEY, JSON.stringify({ version: FORMAT_CACHE_VERSION, cache }));
  } catch {}
}

export async function initializeFormats() {
  allOptions = [];
  supportedFormatCache = new Map();
  traversionGraph = new TraversionGraph();

  try {
    const cacheJSON = await fetch("cache.json").then(r => r.json());
    // cache.json may be a plain array OR { cache: [...] }
    const cacheArray = Array.isArray(cacheJSON) ? cacheJSON
      : Array.isArray(cacheJSON?.cache) ? cacheJSON.cache
      : null;
    if (!cacheArray) throw new TypeError(`cache.json has unexpected shape: ${JSON.stringify(cacheJSON)?.slice(0, 120)}`);
    supportedFormatCache = new Map(cacheArray);
  } catch (e) {
    console.warn("Missing supported format precache.", e);
  }

  for (const handler of handlers) {
    if (!supportedFormatCache.has(handler.name)) {
      console.warn(`Cache miss for formats of handler "${handler.name}".`);
      try {
        await handler.init();
      } catch (_) { continue; }
      if (handler.supportedFormats) {
        supportedFormatCache.set(handler.name, handler.supportedFormats);
        console.info(`Updated supported format cache for "${handler.name}".`);
      }
    }
    const supportedFormats = supportedFormatCache.get(handler.name);
    if (!supportedFormats) {
      console.warn(`Handler "${handler.name}" doesn't support any formats.`);
      continue;
    }
    for (const format of supportedFormats) {
      if (!format.mime) continue;
      allOptions.push({ format, handler, index: allOptions.length });
    }
  }
  traversionGraph.init(supportedFormatCache, handlers);
  saveFormatCache();
  return allOptions;
}

/** Serialize format cache to JSON (same shape as src/main.ts for buildCache.js). */
export function getFormatCacheJSON(): string {
  return JSON.stringify(Array.from(supportedFormatCache.entries()), null, 2);
}

export function getFormats() {
  return allOptions;
}

export function getFormatsByCategory() {
  const byCategory: Record<string, FormatOption[]> = {};
  for (const option of allOptions) {
    const category = Array.isArray(option.format.category)
      ? option.format.category[0]
      : option.format.category || "other";
    if (!byCategory[category]) byCategory[category] = [];
    byCategory[category].push(option);
  }
  return byCategory;
}

export function findFormatByExtension(ext: string): FormatOption | null {
  const extLower = ext.toLowerCase();
  return allOptions.find(opt =>
    opt.format.extension.toLowerCase() === extLower && opt.format.from
  ) || null;
}

export function findFormatByMime(mime: string): FormatOption | null {
  const normalized = normalizeMimeType(mime);
  return allOptions.find(opt =>
    opt.format.mime === normalized && opt.format.from
  ) || null;
}

async function attemptConvertPath(files: FileData[], path: ConvertPathNode[]): Promise<{ files: FileData[], path: ConvertPathNode[] } | null> {
  for (let i = 0; i < path.length - 1; i++) {
    const handler = path[i + 1].handler;
    try {
      let supportedFormats = supportedFormatCache.get(handler.name);
      if (!handler.ready) {
        try {
          await handler.init();
        } catch (_) { return null; }
        if (handler.supportedFormats) {
          supportedFormatCache.set(handler.name, handler.supportedFormats);
          supportedFormats = handler.supportedFormats;
        }
      }
      if (!supportedFormats) throw `Handler "${handler.name}" doesn't support any formats.`;
      const inputFormat = supportedFormats.find(c => c.mime === path[i].format.mime && c.from)!;
      files = (await Promise.all([
        handler.doConvert(files, inputFormat, path[i + 1].format),
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      ]))[0];
      if (files.some(c => !c.bytes.length)) throw "Output is empty.";
    } catch (e) {
      console.log(path.map(c => c.format.format));
      console.error(handler.name, `${path[i].format.format} → ${path[i + 1].format.format}`, e);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return null;
    }
  }
  return { files, path };
}

export async function tryConvertByTraversing(
  files: FileData[],
  from: FormatOption,
  to: FormatOption
): Promise<{ files: FileData[], path: ConvertPathNode[] } | null> {
  const fromNode = new ConvertPathNode(from.handler, from.format);
  const toNode = new ConvertPathNode(to.handler, to.format);

  console.log(`[tryConvert] from: ${from.format.format} (${from.format.mime}, handler=${from.handler.name}) → to: ${to.format.format} (${to.format.mime}, handler=${to.handler.name})`);
  console.log(`[tryConvert] input files:`, files.map(f => `${f.name} (${f.bytes.length}b)`));
  console.log(`[tryConvert] graph initialized: ${traversionGraph ? "yes" : "no"}, allOptions: ${allOptions.length}`);

  let pathCount = 0;
  for await (const path of traversionGraph.searchPath(fromNode, toNode, simpleMode)) {
    pathCount++;
    console.log(`[tryConvert] trying path #${pathCount}: ${path.map(n => n.format.format).join(" → ")}`);
    if (path.at(-1)?.handler === toNode.handler) {
      path[path.length - 1] = toNode;
    }
    const attempt = await attemptConvertPath(files, path);
    if (attempt) {
      console.log(`[tryConvert] SUCCESS via path #${pathCount}, output: ${attempt.files.length} files`);
      return attempt;
    }
    console.log(`[tryConvert] path #${pathCount} failed, trying next…`);
  }
  console.warn(`[tryConvert] FAILED — exhausted all ${pathCount} paths`);
  return null;
}

export function downloadFile(bytes: Uint8Array, name: string, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
}
