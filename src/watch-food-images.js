import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import sharp from "sharp";

const execFileAsync = promisify(execFile);

const OUTPUT_DIR = path.join(process.cwd(), "data", "+images");
const POLL_INTERVAL_MS = 1000;
const FINGERPRINT_SIZE = 32;
const DUPLICATE_DISTANCE_THRESHOLD = 0.02;
const IMAGE_MIME_TYPES = [
  "image/png",
  "image/webp",
  "image/jpeg",
  "image/tiff",
  "image/bmp",
];

let lastProcessedHash = null;
const fingerprintCache = new Map();

const run = async (command, args, options = {}) => {
  const { stdout } = await execFileAsync(command, args, {
    encoding: "buffer",
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });

  return stdout;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const makeOutputPath = () =>
  path.join(OUTPUT_DIR, `00-food-${randomBytes(4).toString("hex")}.png`);

const getClipboardImageType = async () => {
  const stdout = await run("wl-paste", ["--list-types"]);
  const availableTypes = stdout
    .toString("utf8")
    .split("\n")
    .map((type) => type.trim())
    .filter(Boolean);

  return IMAGE_MIME_TYPES.find((type) => availableTypes.includes(type)) ?? null;
};

const getClipboardImage = async (mimeType) =>
  run("wl-paste", ["--no-newline", "--type", mimeType]);

const fingerprintBuffer = async (imageBuffer) =>
  sharp(imageBuffer)
    .rotate()
    .removeAlpha()
    .resize(FINGERPRINT_SIZE, FINGERPRINT_SIZE, { fit: "fill" })
    .raw()
    .toBuffer();

const fingerprintDistance = (left, right) => {
  if (left.length !== right.length)
    throw new Error("Cannot compare fingerprints with different lengths.");

  let squaredDiffSum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const diff = (left[index] - right[index]) / 255;
    squaredDiffSum += diff * diff;
  }

  return Math.sqrt(squaredDiffSum / left.length);
};

const syncFingerprintCache = async () => {
  const entries = (await readdir(OUTPUT_DIR))
    .filter((entry) => entry.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b));
  const livePaths = new Set(entries.map((entry) => path.join(OUTPUT_DIR, entry)));

  for (const cachedPath of fingerprintCache.keys()) {
    if (!livePaths.has(cachedPath)) {
      fingerprintCache.delete(cachedPath);
    }
  }

  await Promise.all(
    entries.map(async (entry) => {
      const imagePath = path.join(OUTPUT_DIR, entry);
      if (fingerprintCache.has(imagePath)) {
        return;
      }

      const imageBuffer = await sharp(imagePath).toBuffer();
      const fingerprint = await fingerprintBuffer(imageBuffer);
      fingerprintCache.set(imagePath, fingerprint);
    }),
  );
};

const findVisualDuplicate = async (candidateFingerprint) => {
  for (const [existingPath, existingFingerprint] of fingerprintCache.entries()) {
    const distance = fingerprintDistance(candidateFingerprint, existingFingerprint);

    if (distance <= DUPLICATE_DISTANCE_THRESHOLD) {
      return {
        distance,
        path: existingPath,
      };
    }
  }

  return null;
};

const buildCropDefinitions = (dimensions) => {
  const { width, height } = dimensions;

  if (width === height) {
    const cropWidth = Math.floor(width / 2);
    const cropHeight = Math.floor(height / 2);

    return [
      {
        width: cropWidth,
        height: cropHeight,
        left: cropWidth,
        top: 0,
      },
      {
        width: cropWidth,
        height: cropHeight,
        left: 0,
        top: cropHeight,
      },
      {
        width: cropWidth,
        height: cropHeight,
        left: cropWidth,
        top: cropHeight,
      },
    ];
  }

  if (width > height) {
    const cropWidth = Math.floor(width / 2);

    return [
      {
        width: cropWidth,
        height,
        left: 0,
        top: 0,
      },
      {
        width: cropWidth,
        height,
        left: cropWidth,
        top: 0,
      },
    ];
  }

  console.log(`Skipping ${width}x${height} image: expected square or horizontal.`);
  return [];
};

const saveCrops = async (imageBuffer, dimensions) => {
  const cropDefinitions = buildCropDefinitions(dimensions);
  let savedCount = 0;

  for (const crop of cropDefinitions) {
    const candidateBuffer = await sharp(imageBuffer)
      .extract(crop)
      .png()
      .toBuffer();
    const candidateFingerprint = await fingerprintBuffer(candidateBuffer);
    const duplicate = await findVisualDuplicate(candidateFingerprint);

    if (duplicate != null) {
      console.log(
        `Skipped duplicate crop (${duplicate.distance.toFixed(4)}) matching ${path.basename(duplicate.path)}.`,
      );
      continue;
    }

    const outputPath = makeOutputPath();
    await writeFile(outputPath, candidateBuffer);
    fingerprintCache.set(outputPath, candidateFingerprint);
    savedCount += 1;
  }

  return savedCount;
};

const processClipboardImage = async () => {
  const mimeType = await getClipboardImageType();
  if (mimeType == null) {
    return;
  }

  console.log("Checking clipboard image...");
  const imageBuffer = await getClipboardImage(mimeType);
  const imageHash = createHash("sha256").update(imageBuffer).digest("hex");
  if (imageHash === lastProcessedHash) {
    return;
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  await syncFingerprintCache();

  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width;
  const height = metadata.height;

  if (!Number.isInteger(width) || !Number.isInteger(height))
    throw new Error("Failed to identify clipboard image dimensions.");

  console.log(`Cropping ${width}x${height} image...`);
  const savedCount = await saveCrops(imageBuffer, { width, height });
  lastProcessedHash = imageHash;

  if (savedCount > 0) {
    console.log(
      `Saved ${savedCount} image${savedCount === 1 ? "" : "s"} from ${width}x${height} clipboard image.`,
    );
  }
};

const watchClipboard = async () => {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await syncFingerprintCache();
  console.log(`Watching clipboard for images. Saving crops to ${OUTPUT_DIR}`);

  while (true) {
    try {
      await processClipboardImage();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }

    await sleep(POLL_INTERVAL_MS);
  }
};

await watchClipboard();
