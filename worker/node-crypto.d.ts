declare module "node:crypto" {
  export function createHash(algorithm: "md5"): { update(value: string, encoding: "utf8"): { digest(encoding: "hex"): string } };
}
