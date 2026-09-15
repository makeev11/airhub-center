import { bytesToHex } from "@noble/hashes/utils.js";
import { encode64, sign, type ChatIdentity } from "./identity.ts";
import { centerHttpUrl } from "./centers.ts";

export function mediaUrl(value: string, origin: string): URL | null {
  try {
    const url = new URL(value, origin);
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      !/^\/media\/[a-f0-9]{64}(?:\.[a-z0-9]+)?$/.test(url.pathname) ||
      url.search ||
      url.hash
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

function mediaAuth(
  identity: ChatIdentity,
  action: "get" | "upload",
  hash?: string,
) {
  const tags = [
    ["t", action],
    ["server", new URL(identity.origin).host],
    ["expiration", String(Math.floor(Date.now() / 1000) + 300)],
  ];
  if (hash) tags.push(["x", hash]);
  return `Nostr ${encode64(
    new TextEncoder().encode(
      JSON.stringify(
        sign(identity, {
          kind: 24242,
          content: `${action} Center media`,
          tags,
        }),
      ),
    ),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}`;
}

/** Never forward authorization to a remote image host or follow a redirect with credentials. */
export async function fetchMedia(
  identity: ChatIdentity,
  value: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const url = mediaUrl(value, identity.origin);
  if (!url) throw new Error("Этот файл находится вне хранилища Центра.");
  const response = await fetch(centerHttpUrl(identity, url.pathname), {
    headers: { Authorization: mediaAuth(identity, "get") },
    signal,
    redirect: "error",
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok) throw new Error("Не удалось загрузить файл.");
  return response.blob();
}

/** Re-encode photos to discard EXIF before upload, matching the existing clients' media policy. */
async function prepareFile(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Для первого среза выберите фото JPEG, PNG или WebP.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error("Изображение слишком большое.");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Браузер не смог подготовить фото.");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Не удалось подготовить фото.")),
        file.type,
        0.9,
      ),
    );
  } finally {
    bitmap.close();
  }
}

export async function uploadFile(
  identity: ChatIdentity,
  file: File,
): Promise<{ content: string; tag: string[] }> {
  if (file.size > 20 * 1024 * 1024 || file.size === 0)
    throw new Error("Выберите непустой файл до 20 МБ.");
  if (["text/html", "image/svg+xml"].includes(file.type))
    throw new Error("Этот формат не поддерживается в чате.");
  const blob = await prepareFile(file);
  if (blob.size > 20 * 1024 * 1024)
    throw new Error("Подготовленный файл превышает 20 МБ.");
  const hash = bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
  );
  const headers = {
    Authorization: mediaAuth(identity, "upload", hash),
    "Content-Type": blob.type || "application/octet-stream",
    "X-SHA-256": hash,
  };
  const put = (path: string) =>
    fetch(centerHttpUrl(identity, path), {
      method: "PUT",
      headers,
      body: blob,
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(60_000),
    });
  let response = await put("/upload");
  if ([404, 405].includes(response.status))
    response = await put("/media/upload");
  if (!response.ok)
    throw new Error(`Не удалось загрузить файл (${response.status}).`);
  const descriptor = await response.json();
  const url =
    typeof descriptor.url === "string"
      ? mediaUrl(descriptor.url, identity.origin)
      : null;
  if (!url || descriptor.sha256 !== hash)
    throw new Error("Сервер вернул некорректное подтверждение файла.");
  const filename = file.name.replace(/[[\]\\\n\r]/g, "_").slice(0, 200);
  return {
    content: `[${filename}](${url.href})`,
    tag: [
      "imeta",
      `url ${url.href}`,
      `m ${blob.type || "application/octet-stream"}`,
      `x ${hash}`,
      `size ${blob.size}`,
      `filename ${filename}`,
    ],
  };
}
