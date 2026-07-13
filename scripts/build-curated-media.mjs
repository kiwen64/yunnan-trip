import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const requests = JSON.parse(await readFile(new URL("media-requests.json", import.meta.url), "utf8"));
const curated = JSON.parse(await readFile(new URL("curated-media.json", import.meta.url), "utf8"));
const mediaDir = new URL("assets/media/", root);
const mediaDirPath = fileURLToPath(mediaDir);

const extensionFor = (contentType, sourceUrl) => {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("webp")) return ".webp";
  if (type.includes("png")) return ".png";
  if (type.includes("gif")) return ".gif";
  if (type.includes("avif")) return ".avif";
  const sourceExt = extname(new URL(sourceUrl).pathname).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"].includes(sourceExt)) {
    return sourceExt === ".jpeg" ? ".jpg" : sourceExt;
  }
  return ".jpg";
};

const getWithRetry = async (url, referer, retries = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          Referer: referer
        }
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length < 1024) throw new Error(`response too small (${data.length} bytes)`);
      return { data, contentType: response.headers.get("content-type") };
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, attempt * 700));
    }
  }
  throw lastError;
};

await rm(mediaDir, { recursive: true, force: true });
await mkdir(mediaDir, { recursive: true });

const groupedRequests = Object.groupBy(requests, request => request.spotId);
const output = {};
const failures = [];
const downloadedFiles = new Map();

for (const spot of curated) {
  const labels = groupedRequests[spot.spotId] || [];
  if (!labels.length) throw new Error(`No media labels found for ${spot.spotId}`);
  output[spot.spotId] = [];

  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index].label;
    let downloaded = false;
    let lastError;
    for (let offset = 0; offset < spot.images.length; offset += 1) {
      const sourceImage = spot.images[(index + offset) % spot.images.length];
      const imageMeta = typeof sourceImage === "string" ? { url: sourceImage } : sourceImage;
      const imageUrl = imageMeta.url;
      const sourceUrl = imageMeta.sourceUrl || spot.sourceUrl;
      const sourceName = imageMeta.sourceName || spot.sourceName;
      try {
        const cachedFileName = downloadedFiles.get(imageUrl);
        if (cachedFileName) {
          output[spot.spotId].push({
            label,
            src: `./assets/media/${cachedFileName}`,
            sourceUrl,
            license: "网络示例图",
            author: `来源：${sourceName}`
          });
          downloaded = true;
          break;
        }
        const { data, contentType } = await getWithRetry(imageUrl, sourceUrl);
        const extension = extensionFor(contentType, imageUrl);
        const fileName = `${spot.spotId}-${index + 1}${extension}`;
        await writeFile(join(mediaDirPath, fileName), data);
        downloadedFiles.set(imageUrl, fileName);
        output[spot.spotId].push({
          label,
          src: `./assets/media/${fileName}`,
          sourceUrl,
          license: "网络示例图",
          author: `来源：${sourceName}`
        });
        downloaded = true;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!downloaded) failures.push(`${spot.spotId}-${index + 1}: ${lastError?.message || "unknown error"}`);
  }
}

if (failures.length) {
  throw new Error(`Media download failed:\n${failures.join("\n")}`);
}

const mediaJs = `/* Curated network examples. Source pages are retained for attribution. */\nwindow.SPOT_MEDIA = ${JSON.stringify(output, null, 2)};\n`;
await writeFile(new URL("media.js", root), mediaJs, "utf8");
console.log(`Built ${Object.keys(output).length} spots / ${requests.length} labeled images.`);
