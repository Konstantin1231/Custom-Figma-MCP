import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { Transform } from "@figma/rest-api-spec";
import { z } from "zod";
import { FigmaService } from "../../services/figma.js";
import { Logger } from "../../utils/logger.js";
import {
	downloadAndProcessImage,
	type ImageProcessingResult,
} from "../../utils/image-processing.js";
import { ImageServiceClient } from "../../utils/image-service-client.js";
import { sendProgress, startProgressHeartbeat, type ToolExtra } from "../progress.js";

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
				.describe("The ID of the Figma image node to fetch, formatted as 1234:5678"),
			imageRef: z
				.string()
				.nullable()
				.describe(
					"If a node has an imageRef fill, you must include this variable. Leave blank when downloading Vector SVG images or animated GIFs (use gifRef instead).",
				),
			gifRef: z
				.string()
				.nullable()
				.describe(
					"If a node has a gifRef fill (animated GIF), you must include this variable to download the animated GIF. When gifRef is present in the Figma data, use it instead of imageRef to get the animated file rather than a static snapshot.",
				),
			assetName: z
				.string()
				.regex(
					/^[a-zA-Z0-9_.-]+\.(png|svg|gif)$/,
					"Asset names must contain only letters, numbers, underscores, dots, or hyphens, and end with .png, .svg, or .gif.",
				)
				.describe(
					"A temporary asset name used during download and processing. It must include the extension so the tool knows whether to handle the asset as png, svg, or gif.",
				),
			needsCropping: z
				.boolean()
				.nullable()
				.describe("Whether this image needs cropping based on its transform matrix"),
			cropTransform: z
				.array(z.array(z.number()))
				.nullable()
				.describe("Figma transform matrix for image cropping"),
			requiresImageDimensions: z
				.boolean()
				.nullable()
				.describe("Whether this image requires dimension information for CSS variables"),
			variantSuffix: z
				.string()
				.regex(
					/^[a-zA-Z0-9_-]+$/,
					"Suffix must contain only letters, numbers, underscores, or hyphens",
				)
				.nullable()
				.describe(
					"Optional suffix used to keep otherwise-identical asset variants unique during processing, for example when Figma provides multiple cropped variants of the same source image.",
				),
		})
		.array()
		.describe("The nodes to fetch as images"),
	pngScale: z
		.number()
		.positive()
		.optional()
		.default(2)
		.describe(
			"Export scale for PNG images. Optional, defaults to 2 if not specified. Affects PNG images only.",
		),
	customer_token: z
		.string()
		.optional()
		.describe("Internal use only. Do not provide this parameter."),
};

const parametersSchema = z.object(parameters);
export type DownloadImagesParams = z.infer<typeof parametersSchema>;

type PlannedDownload = {
	fileName: string;
	needsCropping: boolean;
	cropTransform: Transform | null;
	requiresImageDimensions: boolean;
	imageRef?: string;
	gifRef?: string;
	nodeId?: string;
};

type RequestedNode = {
	requestedNodeId: string;
	resolvedFileName: string;
	downloadIndex: number;
};

type UploadedImageResult = ImageProcessingResult & {
	imageId: string;
	publicUrl: string;
};

function resolveFileName(assetName: string, variantSuffix?: string | null): string {
	if (!variantSuffix || assetName.includes(variantSuffix)) {
		return assetName;
	}

	const extension = path.extname(assetName);
	const fileNameWithoutExtension = assetName.slice(0, -extension.length);
	return `${fileNameWithoutExtension}-${variantSuffix}${extension}`;
}

async function downloadAndUploadImages(
	figmaService: FigmaService,
	imageServiceClient: ImageServiceClient,
	fileKey: string,
	items: PlannedDownload[],
	options: { pngScale?: number } = {},
): Promise<UploadedImageResult[]> {
	if (items.length === 0) {
		return [];
	}

	const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "figma-mcp-image-service-"));

	try {
		const { pngScale = 2 } = options;
		const imageFillRefs = items
			.map((item) => item.gifRef ?? item.imageRef)
			.filter((value): value is string => !!value);
		const imageFillUrls = imageFillRefs.length > 0 ? await figmaService.getImageFillUrls(fileKey) : {};

		const pngRenderNodeIds = items
			.filter((item) => item.nodeId && !item.fileName.toLowerCase().endsWith(".svg"))
			.map((item) => item.nodeId as string);
		const pngRenderUrls =
			pngRenderNodeIds.length > 0
				? await figmaService.getNodeRenderUrls(fileKey, pngRenderNodeIds, "png", { pngScale })
				: {};

		const svgRenderNodeIds = items
			.filter((item) => item.nodeId && item.fileName.toLowerCase().endsWith(".svg"))
			.map((item) => item.nodeId as string);
		const svgRenderUrls =
			svgRenderNodeIds.length > 0
				? await figmaService.getNodeRenderUrls(fileKey, svgRenderNodeIds, "svg")
				: {};

		return Promise.all(
			items.map(async (item) => {
				const imageUrl = item.gifRef
					? imageFillUrls[item.gifRef]
					: item.imageRef
						? imageFillUrls[item.imageRef]
						: item.nodeId && item.fileName.toLowerCase().endsWith(".svg")
							? svgRenderUrls[item.nodeId]
							: item.nodeId
								? pngRenderUrls[item.nodeId]
								: undefined;

				if (!imageUrl) {
					throw new Error(`Failed to resolve a Figma image URL for ${item.fileName}.`);
				}

				const processedImage = await downloadAndProcessImage(
					item.fileName,
					workDirectory,
					imageUrl,
					item.needsCropping,
					item.cropTransform ?? undefined,
					item.requiresImageDimensions,
				);

				try {
					const uploadedImage = await imageServiceClient.uploadTemporaryImage(processedImage.filePath);

					return {
						...processedImage,
						imageId: uploadedImage.id,
						publicUrl: uploadedImage.url,
					} satisfies UploadedImageResult;
				} finally {
					await fs.rm(processedImage.filePath, { force: true });
				}
			}),
		);
	} finally {
		await fs.rm(workDirectory, { recursive: true, force: true });
	}
}

async function downloadFigmaImages(
	params: DownloadImagesParams,
	figmaService: FigmaService,
	_imageDir: string | undefined,
	_transport: unknown,
	_authMode: unknown,
	_clientInfo: unknown,
	extra: ToolExtra,
) {
	try {
		const { fileKey, nodes, pngScale = 2, customer_token } = parametersSchema.parse(params);

		if (customer_token) {
			figmaService.customerToken = customer_token;
		}

		const imageServiceClient = new ImageServiceClient(customer_token);

		await sendProgress(extra, 0, 3, "Resolving image downloads");

		const downloadItems: PlannedDownload[] = [];
		const requestedNodes: RequestedNode[] = [];
		const seenDownloads = new Map<string, number>();

		for (const rawNode of nodes) {
			const normalizedNodeId = rawNode.nodeId.replace(/-/g, ":");
			const resolvedFileName = resolveFileName(rawNode.assetName, rawNode.variantSuffix);
			const plannedDownload: PlannedDownload = {
				fileName: resolvedFileName,
				needsCropping: rawNode.needsCropping || false,
				cropTransform: rawNode.cropTransform,
				requiresImageDimensions: rawNode.requiresImageDimensions || false,
			};

			if (rawNode.gifRef) {
				const downloadIndex = downloadItems.length;
				downloadItems.push({ ...plannedDownload, gifRef: rawNode.gifRef });
				requestedNodes.push({
					requestedNodeId: rawNode.nodeId,
					resolvedFileName,
					downloadIndex,
				});
				continue;
			}

			if (rawNode.imageRef) {
				const uniqueKey = `${rawNode.imageRef}-${rawNode.variantSuffix || "none"}`;

				if (!rawNode.variantSuffix && seenDownloads.has(uniqueKey)) {
					const downloadIndex = seenDownloads.get(uniqueKey) as number;
					requestedNodes.push({
						requestedNodeId: rawNode.nodeId,
						resolvedFileName,
						downloadIndex,
					});

					if (plannedDownload.requiresImageDimensions) {
						downloadItems[downloadIndex].requiresImageDimensions = true;
					}

					continue;
				}

				const downloadIndex = downloadItems.length;
				downloadItems.push({ ...plannedDownload, imageRef: rawNode.imageRef });
				requestedNodes.push({
					requestedNodeId: rawNode.nodeId,
					resolvedFileName,
					downloadIndex,
				});
				seenDownloads.set(uniqueKey, downloadIndex);
				continue;
			}

			const downloadIndex = downloadItems.length;
			downloadItems.push({ ...plannedDownload, nodeId: normalizedNodeId });
			requestedNodes.push({
				requestedNodeId: rawNode.nodeId,
				resolvedFileName,
				downloadIndex,
			});
		}

		await sendProgress(extra, 1, 3, `Resolved ${downloadItems.length} images, downloading`);
		const stopHeartbeat = startProgressHeartbeat(extra, "Downloading and uploading images");

		let uploadedImages: UploadedImageResult[];
		try {
			uploadedImages = await downloadAndUploadImages(
				figmaService,
				imageServiceClient,
				fileKey,
				downloadItems,
				{ pngScale },
			);
		} finally {
			stopHeartbeat();
		}

		const successCount = uploadedImages.length;
		await sendProgress(extra, 2, 3, `Uploaded ${successCount} images, formatting response`);

		const imageMappings = requestedNodes
			.map((requestedNode) => {
				const uploadedImage = uploadedImages[requestedNode.downloadIndex];
				const dimensions = `${uploadedImage.finalDimensions.width}x${uploadedImage.finalDimensions.height}`;
				const cropStatus = uploadedImage.wasCropped ? " (cropped)" : "";
				const dimensionInfo = uploadedImage.cssVariables
					? `${dimensions} | ${uploadedImage.cssVariables}`
					: dimensions;

				return `- ${requestedNode.resolvedFileName} (${requestedNode.requestedNodeId}) -> ${uploadedImage.publicUrl} [${dimensionInfo}${cropStatus}]`;
			})
			.join("\n");

		return {
			content: [
				{
					type: "text" as const,
					text: `Uploaded ${successCount} images to the image service:\n${imageMappings}`,
				},
			],
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		Logger.error(`Error downloading images from ${params.fileKey}:`, error);
		return {
			isError: true,
			content: [
				{
					type: "text" as const,
					text: `Failed to download images: ${message}`,
				},
			],
		};
	}
}

function getDescription(_imageDir?: string) {
	return "Download SVG, PNG, and GIF images used in a Figma file, upload them to the image service as TEMPORARY images, and return nodeId to public URL mappings.";
}

export const downloadFigmaImagesTool = {
	name: "download_figma_images",
	getDescription,
	parametersSchema,
	handler: downloadFigmaImages,
} as const;
