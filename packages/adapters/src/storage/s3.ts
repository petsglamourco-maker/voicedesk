import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ProviderError } from "../errors";
import type { ObjectStorage, PutObjectInput } from "./types";

export interface S3Config {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle?: boolean;
}

/** S3-compatible storage: SeaweedFS locally, AWS S3 (eu-west-2) or Cloudflare R2 later. */
export class S3ObjectStorage implements ObjectStorage {
  readonly name = "s3";
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? false,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  /** Creates the bucket if it doesn't exist (local dev convenience). */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.wrap("create bucket", () =>
        this.client.send(new CreateBucketCommand({ Bucket: this.bucket })),
      );
    }
  }

  async put(input: PutObjectInput): Promise<void> {
    await this.wrap("put object", () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        }),
      ),
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.Body ? await res.Body.transformToByteArray() : new Uint8Array();
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw new ProviderError(this.name, "get object failed", { retryable: true, cause: error });
    }
  }

  async delete(key: string): Promise<void> {
    await this.wrap("delete object", () =>
      this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })),
    );
  }

  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix.endsWith("/")) throw new Error("deletePrefix: prefix must end with '/'");
    let deleted = 0;
    let token: string | undefined;
    do {
      const page = await this.wrap("list objects", () =>
        this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        ),
      );
      const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (keys.length > 0) {
        await this.wrap("delete objects", () =>
          this.client.send(
            new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }),
          ),
        );
        deleted += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }

  signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  private async wrap<T>(action: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (cause) {
      throw new ProviderError(this.name, `${action} failed`, { retryable: true, cause });
    }
  }
}
