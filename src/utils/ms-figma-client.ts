import { Logger } from "./logger.js";

export type MsFigmaRenderFormat = "png" | "jpg" | "svg";
export type MsFigmaImageStatus = "SUCCESS" | "NOT_FOUND" | "FAILED";
export type MsFigmaImageErrorCode = "IMAGE_TRANSFER_FAILED";

// ms-figma's metadata shape isn't contractually fixed (it passes through
// whatever media-storage reports) — treat it as an opaque dict the caller
// will JSON-serialize rather than modeling individual fields.
export type MsFigmaImageMetadata = Record<string, unknown>;

export type MsFigmaImageError = {
  code: MsFigmaImageErrorCode;
};

export type MsFigmaRenderedImage = {
  url: string | null;
  metadata: MsFigmaImageMetadata | null;
  status: MsFigmaImageStatus;
  error: MsFigmaImageError | null;
};

export type MsFigmaImagesResponse = {
  images: Record<string, MsFigmaRenderedImage>;
};

export type MsFigmaImageFillMetadata = MsFigmaImageMetadata;

export type MsFigmaImageFill = {
  ref: string | null;
  url: string | null;
  metadata: MsFigmaImageFillMetadata | null;
  status: MsFigmaImageStatus;
  error: MsFigmaImageError | null;
};

export type MsFigmaImageFillsResponse = {
  images: Record<string, MsFigmaImageFill>;
};

export type MsFigmaResolveImagesRequest = {
  ids: string[];
  format: MsFigmaRenderFormat;
  scale?: number;
};

export type MsFigmaImageFillEntry = {
  imageRef?: string;
  gifRef?: string;
};

type MsFigmaErrorResponse = {
  error?: {
    code?: string;
    integrationStatus?: string;
    message?: string;
  };
};

function parseErrorResponseBody(responseBody?: string): MsFigmaErrorResponse["error"] {
  if (!responseBody) return undefined;

  try {
    const parsed = JSON.parse(responseBody) as MsFigmaErrorResponse;
    return parsed.error;
  } catch {
    return undefined;
  }
}

export class MsFigmaClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: string,
    public readonly upstreamCode?: string,
    public readonly integrationStatus?: string,
  ) {
    super(message);
    this.name = "MsFigmaClientError";
  }
}

const DEFAULT_FIGMA_API_BASE_URL = "https://api.figma.com/v1";

// SVG rendering has always used these defaults (see buildSvgQueryParams in
// figma.ts) — outlined text and simplified strokes produce renders that match
// what designers see, without leaking internal Figma node ids into markup.
const SVG_RENDER_DEFAULTS = {
  svgOutlineText: true,
  svgIncludeId: false,
  svgSimplifyStroke: true,
} as const;

/**
 * ms-figma exposes the images resource as a sibling of the file proxy
 * (".../figma/proxy" -> ".../figma/images"), reusing the same MCP_SERVER_URL
 * that FigmaService is configured with. Falls back to the raw Figma API base
 * when no proxy is configured so misconfiguration fails loudly at request
 * time instead of silently resolving to the wrong host here.
 */
function resolveImagesBaseUrl(mcpServerUrl?: string): string {
  const raw = (mcpServerUrl ?? process.env.MCP_SERVER_URL ?? DEFAULT_FIGMA_API_BASE_URL).replace(
    /\/+$/,
    "",
  );
  return raw.replace(/\/figma\/proxy$/, "/figma/images");
}

async function getResponseBodyPreview(response: Response): Promise<string> {
  const responseText = await response.text();
  if (!responseText) return "(empty body)";
  return responseText.length > 500 ? `${responseText.slice(0, 500)}...` : responseText;
}

function buildRequestErrorMessage(response: Response, responseBody: string): string {
  const parts = [`ms-figma request failed with ${response.status} ${response.statusText}`];
  if (responseBody !== "(empty body)") {
    parts.push(`response body: ${responseBody}`);
  }
  return parts.join(". ");
}

function parseImageError(value: unknown): MsFigmaImageError | null {
  if (typeof value !== "object" || value === null) return null;
  const code = (value as Record<string, unknown>).code;
  return typeof code === "string" ? { code: code as MsFigmaImageErrorCode } : null;
}

function parseStatus(value: unknown): MsFigmaImageStatus {
  return value === "SUCCESS" || value === "NOT_FOUND" || value === "FAILED" ? value : "FAILED";
}

function parseRenderedImage(value: unknown): MsFigmaRenderedImage {
  const entry = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  // The documented schema for this field is inconsistent with the documented
  // example (imageUrl vs. url); accept either so a spec fix upstream doesn't
  // silently break parsing here.
  const url = entry.url ?? entry.imageUrl;
  return {
    url: typeof url === "string" ? url : null,
    metadata: parseImageFillMetadata(entry.metadata),
    status: parseStatus(entry.status),
    error: parseImageError(entry.error),
  };
}

function parseImagesResponse(data: unknown): MsFigmaImagesResponse {
  const value = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const images =
    typeof value.images === "object" && value.images !== null
      ? (value.images as Record<string, unknown>)
      : {};
  return {
    images: Object.fromEntries(
      Object.entries(images).map(([nodeId, entry]) => [nodeId, parseRenderedImage(entry)]),
    ),
  };
}

function parseImageFillMetadata(value: unknown): MsFigmaImageFillMetadata | null {
  return typeof value === "object" && value !== null ? (value as MsFigmaImageFillMetadata) : null;
}

function parseImageFill(value: unknown): MsFigmaImageFill {
  const entry = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    ref: typeof entry.ref === "string" ? entry.ref : null,
    url: typeof entry.url === "string" ? entry.url : null,
    metadata: parseImageFillMetadata(entry.metadata),
    status: parseStatus(entry.status),
    error: parseImageError(entry.error),
  };
}

function parseImageFillsResponse(data: unknown): MsFigmaImageFillsResponse {
  const value = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const images =
    typeof value.images === "object" && value.images !== null
      ? (value.images as Record<string, unknown>)
      : {};
  return {
    images: Object.fromEntries(
      Object.entries(images).map(([nodeId, entry]) => [nodeId, parseImageFill(entry)]),
    ),
  };
}

/**
 * Client for ms-figma's image-resolution endpoints. Unlike the legacy
 * FigmaService image paths, ms-figma downloads and hosts the image itself —
 * callers only ever get back a public URL, never bytes to process locally.
 */
export class MsFigmaImageClient {
  private readonly baseUrl: string;
  private readonly customerToken?: string;

  constructor(customerToken?: string, mcpServerUrl?: string) {
    this.baseUrl = resolveImagesBaseUrl(mcpServerUrl);
    this.customerToken = customerToken;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.customerToken) {
      headers.Authorization = `Bearer ${this.customerToken}`;
    }
    return headers;
  }

  private async post<T>(endpoint: string, body: unknown, parse: (data: unknown) => T): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    Logger.log(`Calling ms-figma at ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const responseBody = await getResponseBodyPreview(response);
      const upstreamError = parseErrorResponseBody(responseBody);
      const errorMessage = buildRequestErrorMessage(response, responseBody);
      Logger.error(
        `ms-figma request failed with ${response.status} ${response.statusText} at ${url}. Response body: ${responseBody}`,
      );
      throw new MsFigmaClientError(
        errorMessage,
        response.status,
        responseBody,
        upstreamError?.code,
        upstreamError?.integrationStatus,
      );
    }

    return parse(await response.json());
  }

  /** Renders nodes directly (no imageRef/gifRef) via POST /figma/images/{fileKey}. */
  async resolveRenderedImages(
    fileKey: string,
    request: MsFigmaResolveImagesRequest,
  ): Promise<MsFigmaImagesResponse> {
    const svgOptions = request.format === "svg" ? SVG_RENDER_DEFAULTS : {};
    return this.post(
      `/${fileKey}`,
      { ids: request.ids, format: request.format, scale: request.scale, ...svgOptions },
      parseImagesResponse,
    );
  }

  /** Resolves image/gif fills via POST /figma/images/{fileKey}/fills. */
  async resolveImageFills(
    fileKey: string,
    images: Record<string, MsFigmaImageFillEntry>,
  ): Promise<MsFigmaImageFillsResponse> {
    return this.post(`/${fileKey}/fills`, { images }, parseImageFillsResponse);
  }
}
