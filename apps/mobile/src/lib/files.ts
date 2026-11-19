// Vault file helpers: pick (documents/photos) → base64 for POST /me/vault/uploads, and open a stored file via GET /me/vault/{id}/content.
import { Platform } from "react-native";
import { api } from "@/api/client";
import { ApiError } from "@/api/errors";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // API default VAULT_MAX_BYTES
export const UPLOAD_MIME = ["application/pdf", "image/jpeg", "image/png"] as const;
export type PickedFile = { fileName: string; mimeType: string; contentBase64: string; sizeBytes: number };
export type PickError = "type" | "size" | "failed";

export const isAllowedMime = (m: string | undefined | null): m is (typeof UPLOAD_MIME)[number] => !!m && (UPLOAD_MIME as readonly string[]).includes(m);
const mimeFromName = (n: string) => (/\.pdf$/i.test(n) ? "application/pdf" : /\.png$/i.test(n) ? "image/png" : /\.jpe?g$/i.test(n) ? "image/jpeg" : "");

/** Validates and base64-encodes a blob (works on web and React Native via fetch(uri)). */
export async function blobToPicked(blob: Blob, fileName: string, mime: string): Promise<PickedFile | PickError> {
  const mimeType = isAllowedMime(mime) ? mime : mimeFromName(fileName);
  if (!isAllowedMime(mimeType)) return "type";
  if (blob.size > MAX_UPLOAD_BYTES) return "size";
  const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
  return { fileName: fileName.slice(0, 160), mimeType, contentBase64: dataUrl.slice(dataUrl.indexOf(",") + 1), sizeBytes: blob.size };
}

export async function pickDocument(): Promise<PickedFile | PickError | null> {
  try {
    const DocumentPicker = await import("expo-document-picker");
    const res = await DocumentPicker.getDocumentAsync({ type: [...UPLOAD_MIME], copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.[0]) return null;
    const a = res.assets[0];
    const blob = await (await fetch(a.uri)).blob();
    return await blobToPicked(blob, a.name, a.mimeType ?? blob.type);
  } catch { return "failed"; }
}

export async function pickPhoto(): Promise<PickedFile | PickError | null> {
  try {
    const ImagePicker = await import("expo-image-picker");
    if (Platform.OS !== "web") { const perm = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!perm.granted) return "failed"; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsMultipleSelection: false });
    if (res.canceled || !res.assets?.[0]) return null;
    const a = res.assets[0];
    const blob = await (await fetch(a.uri)).blob();
    return await blobToPicked(blob, a.fileName ?? `photo-${Date.now()}.jpg`, a.mimeType ?? blob.type);
  } catch { return "failed"; }
}

/** Downloads the decrypted file (auth header via the API client) and opens it: new tab on web, share sheet on device. */
export async function openVaultFile(id: string, fileName: string | null): Promise<"opened" | "failed"> {
  try {
    const { data, response } = await api.GET("/api/v1/me/vault/{id}/content", { params: { path: { id } }, parseAs: "blob" });
    if (!response.ok || !data) throw new ApiError(response.status, "DOWNLOAD_FAILED", "download failed");
    const blob = data as Blob;
    if (Platform.OS === "web") { const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 60_000); return "opened"; }
    const FS = await import("expo-file-system");
    const Sharing = await import("expo-sharing");
    const file = new FS.File(FS.Paths.cache, fileName ?? `${id}`);
    if (file.exists) file.delete();
    file.create();
    file.write(new Uint8Array(await blob.arrayBuffer()));
    await Sharing.shareAsync(file.uri);
    return "opened";
  } catch { return "failed"; }
}

/** Data URI for inline image preview (images only). */
export async function fetchImageDataUri(id: string): Promise<string | null> {
  try {
    const { data, response } = await api.GET("/api/v1/me/vault/{id}/content", { params: { path: { id } }, parseAs: "blob" });
    if (!response.ok || !data) return null;
    return await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(data as Blob); });
  } catch { return null; }
}
