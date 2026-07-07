import { z } from "zod";
import type { FigmaService } from "../../services/figma.js";
import { Logger } from "../../utils/logger.js";
import {
  MsFigmaImageClient,
  MsFigmaClientError,
  type MsFigmaImageFill,
  type MsFigmaImageFillEntry,
  type MsFigmaImageError,
  type MsFigmaImageStatus,
  type MsFigmaRenderFormat,
} from "../../utils/ms-figma-client.js";
import type { ToolExtra } from "../progress.js";

const parameters = {
  fileKey: z
    .string()
    .regex(/^[a-zA-Z0-9]+$/, "File key must be alphanumeric")
    .describe("The key of the Figma file containing the images"),
  nodes: z
    .object({
      nodeId: z
        .string()
        .regex(
          /^I?\d+[:|-]\d+(?:;\d+[:|-]\d+)*$/,
          "Node ID must be like '1234:5678' or 'I5666:180910;1:10515;1:10336'",
        )
        .describe("The ID of the Figma node to fetch an image for"),
      imageRef: z
        .string()
        .nullable()
        .describe(
          "If a node has an imageRef fill, you must include this variable. Leave blank when downloading Vector SVG images or animated GIFs (use gifRef instead), or when an IMAGE fill is present without an imageRef — in that case the node is rendered as PNG via nodeId.",
        ),
      gifRef: z
        .string()
        .nullable()
        .describe(
          "If a node has a gifRef fill (animated GIF), you must include this variable to download the animated GIF. When gifRef is present in the Figma data, use it instead of imageRef to get the animated file rather than a static snapshot.",
        ),
      description: z
        .string()
        .describe("One short sentence explaining why this image is being loaded."),
      category: z
        .enum(["mockup", "asset"])
        .describe(
          "'mockup' if the image is only being looked at for reference; 'asset' if it will be used in the design.",
        ),
      format: z
        .enum(["jpg", "png", "svg"])
        .nullable()
        .describe(
          "Format to render in. Only applies when the node has no imageRef/gifRef and Figma must render it directly.",
        ),
    })
    .array()
    .describe("The nodes to fetch images for"),
  pngScale: z
    .number()
    .positive()
    .optional()
    .default(1)
    .describe(
      "Export scale used when Figma renders a node directly (no imageRef/gifRef). Optional, defaults to 1.",
    ),
  customer_token: z
    .string()
    .optional()
    .describe("Internal use only. Do not provide this parameter."),
};

const parametersSchema = z.object(parameters);
type ParsedDownloadImagesParams = z.infer<typeof parametersSchema>;
export type DownloadImagesParams = z.input<typeof parametersSchema>;
type RequestedNode = ParsedDownloadImagesParams["nodes"][number];

type NodeResult = {
  status: "success" | "failed";
  code?: string;
  description: string;
  format: string | null;
  category: "mockup" | "asset";
  is_image_ref: boolean;
  is_gif_ref: boolean;
  url: string | null;
  metadata: Record<string, unknown> | null;
};

// Figma node ids are colon-separated ("1234:5678"); the schema also accepts
// hyphens since that's how node-id often shows up copy-pasted from a Figma
// URL. Normalize on the wire, but key results by whatever the agent sent.
function normalizeNodeId(nodeId: string): string {
  return nodeId.replace(/-/g, ":");
}

function hasFillRef(node: RequestedNode): boolean {
  return Boolean(node.imageRef || node.gifRef);
}

function buildFillEntry(node: RequestedNode): MsFigmaImageFillEntry {
  return {
    ...(node.imageRef ? { imageRef: node.imageRef } : {}),
    ...(node.gifRef ? { gifRef: node.gifRef } : {}),
  };
}

function resultCode(
  status: MsFigmaImageStatus | undefined,
  error: MsFigmaImageError | null | undefined,
  node: RequestedNode,
) {
  return explainErrorCode(error?.code ?? status ?? "NO_RESPONSE", node);
}

function renderFormat(node: RequestedNode): MsFigmaRenderFormat {
  return node.format ?? "png";
}

function resultFormat(node: RequestedNode): MsFigmaRenderFormat | "gif" {
  if (node.gifRef) return "gif";
  if (node.imageRef) return "png";
  return renderFormat(node);
}

function explainErrorCode(code: string, node?: RequestedNode): string {
  const suffix = errorHint(code, node);
  return suffix ? `${code}: ${suffix}` : code;
}

function errorHint(code: string, node?: RequestedNode): string | null {
  switch (code) {
    case "IMAGE_TRANSFER_FAILED":
      return node?.format === "svg"
        ? "Often happen, when Figma could not render this node as an image. This usually happens when the node cannot be rendered as SVG. Retry with a different image type, usually png instead of svg."
        : "Often happen, when Figma could not render this node as an image. Retry with a different image type or a simpler node. If you are requesting svg, switch to png."
      ;
    case "INTEGRATION_SETUP_ERROR":
      return "Often happen, when the user account is not linked to a Figma account in ms-figma. Ask the user to repeat sign-in and reconnect their Figma account.";
    case "INVALID_REQUEST":
      return "Often happen, when ms-figma rejected the request. This usually happens when too many images are requested at once. Retry with a smaller batch.";
    case "NOT_FOUND":
      return "Often happen, when the requested node or image reference was not found. Verify the file key, node id, and imageRef/gifRef values.";
    case "FAILED":
      return "Often happen, when ms-figma could not resolve this image. Retry once; if it still fails, change the render format or inspect the source node in Figma.";
    case "NO_RESPONSE":
      return "Often happen, when ms-figma returned no image entry for this node. Retry once and verify the input node ids.";
    default:
      return null;
  }
}

function formatRequestError(error: unknown): string {
  if (error instanceof MsFigmaClientError && error.upstreamCode) {
    const integrationStatus = error.integrationStatus
      ? ` (integration status: ${error.integrationStatus})`
      : "";
    return `${explainErrorCode(error.upstreamCode)}${integrationStatus}`;
  }

  return error instanceof Error ? error.message : String(error);
}

async function resolveImages(
  client: MsFigmaImageClient,
  fileKey: string,
  nodes: RequestedNode[],
  pngScale: number,
) {
  const fillNodes = nodes.filter(hasFillRef);
  const renderNodesByFormat = new Map<MsFigmaRenderFormat, RequestedNode[]>();
  for (const node of nodes) {
    if (hasFillRef(node)) continue;
    const format = renderFormat(node);
    const bucket = renderNodesByFormat.get(format) ?? [];
    bucket.push(node);
    renderNodesByFormat.set(format, bucket);
  }

  const [fillsResponse, renderResponses] = await Promise.all([
    fillNodes.length > 0
      ? client.resolveImageFills(
          fileKey,
          Object.fromEntries(
            fillNodes.map((node) => [normalizeNodeId(node.nodeId), buildFillEntry(node)]),
          ),
        )
      : Promise.resolve({ images: {} as Record<string, MsFigmaImageFill> }),
    Promise.all(
      Array.from(renderNodesByFormat.entries()).map(([format, group]) =>
        client.resolveRenderedImages(fileKey, {
          ids: group.map((node) => normalizeNodeId(node.nodeId)),
          format,
          scale: pngScale,
        }),
      ),
    ),
  ]);

  const renderedByNodeId = Object.assign({}, ...renderResponses.map((response) => response.images));
  return { fillsByNodeId: fillsResponse.images, renderedByNodeId };
}

async function downloadFigmaImagesV2(
  params: DownloadImagesParams,
  _figmaService: FigmaService,
  _imageDir: string | undefined,
  _transport: unknown,
  _authMode: unknown,
  _clientInfo: unknown,
  _extra: ToolExtra,
) {
  try {
    const { fileKey, nodes, pngScale, customer_token } = parametersSchema.parse(params);

    const client = new MsFigmaImageClient(customer_token);
    const { fillsByNodeId, renderedByNodeId } = await resolveImages(
      client,
      fileKey,
      nodes,
      pngScale,
    );

    const results: Record<string, NodeResult> = {};
    for (const node of nodes) {
      const isImageRef = !!node.imageRef;
      const isGifRef = !!node.gifRef;
      const wireNodeId = normalizeNodeId(node.nodeId);
      const fillEntry = hasFillRef(node) ? fillsByNodeId[wireNodeId] : undefined;
      const renderEntry = hasFillRef(node) ? undefined : renderedByNodeId[wireNodeId];

      const status = fillEntry?.status ?? renderEntry?.status;
      const url = fillEntry?.url ?? renderEntry?.url ?? null;
      const error = fillEntry?.error ?? renderEntry?.error ?? null;
      const metadata = fillEntry?.metadata ?? renderEntry?.metadata ?? null;
      const isSuccess = status === "SUCCESS" && !!url;

      results[node.nodeId] = {
        status: isSuccess ? "success" : "failed",
        ...(isSuccess ? {} : { code: resultCode(status, error, node) }),
        description: node.description,
        format: resultFormat(node),
        category: node.category,
        is_image_ref: isImageRef,
        is_gif_ref: isGifRef,
        url,
        metadata,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  } catch (error) {
    Logger.error(`Error resolving images from ${params.fileKey}:`, error);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Failed to resolve images: ${formatRequestError(error)}`,
        },
      ],
    };
  }
}

function getDescription(_imageDir?: string) {
  return "Resolve public URLs for images used in a Figma file. Returns a map of node ID to resolved URL and metadata;.";
}

export const downloadFigmaImagesTool = {
  name: "download_figma_images",
  getDescription,
  parametersSchema,
  handler: downloadFigmaImagesV2,
} as const;
