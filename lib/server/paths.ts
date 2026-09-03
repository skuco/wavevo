import path from "node:path";

export const DATA_ROOT = path.join(process.cwd(), "data");
export const UPLOAD_ROOT = path.join(DATA_ROOT, "uploads");

export function uploadDirectory(id: string) {
  return path.join(UPLOAD_ROOT, id);
}

export function assertUploadId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new Error("Invalid upload id.");
  return id;
}
