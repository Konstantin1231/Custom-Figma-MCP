import { promises as fs } from "fs";
import path from "path";

export type ImageServiceMimeType =
	| "image/png"
	| "image/gif"
	| "image/jpg"
	| "image/jpeg"
	| "image/webp"
	| "image/svg+xml";

export type ImageServiceImageType = "TEMPORARY" | "REGULAR";
export type ImageServiceImageSourceType = "PBX";

export type CreateImageRequest = {
	contentLength: number;
	contentType: ImageServiceMimeType;
	type: ImageServiceImageType;
	sourceType: ImageServiceImageSourceType;
};

export type ImageResponse = {
	id: string;
	url: string;
	name: string | null;
	height: number | null;
	width: number | null;
	size: number | null;
	type: ImageServiceImageType | null;
};

export class ImageServiceClientError extends Error {
	constructor(
		message: string,
		public readonly statusCode: number,
	) {
		super(message);
		this.name = "ImageServiceClientError";
	}
}

const MIME_TYPE_BY_EXTENSION: Record<string, ImageServiceMimeType> = {
	".png": "image/png",
	".gif": "image/gif",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".svg": "image/svg+xml",
};

function normalizeBaseUrl(baseURL: string): string {
	return baseURL.replace(/\/+$/, "");
}

function getMimeTypeFromFilePath(filePath: string): ImageServiceMimeType {
	const extension = path.extname(filePath).toLowerCase();
	const mimeType = MIME_TYPE_BY_EXTENSION[extension];

	if (!mimeType) {
		throw new Error(`Unsupported image extension: ${extension || "(none)"}`);
	}

	return mimeType;
}

function parseImageResponse(data: unknown): ImageResponse {
	if (typeof data !== "object" || data === null) {
		throw new Error("Image service returned a non-object response.");
	}

	const value = data as Record<string, unknown>;
	if (typeof value.id !== "string" || typeof value.url !== "string") {
		throw new Error("Image service response is missing required id/url fields.");
	}

	return {
		id: value.id,
		url: value.url,
		name: typeof value.name === "string" || value.name === null ? (value.name ?? null) : null,
		height:
			typeof value.height === "number" || value.height === null ? (value.height ?? null) : null,
		width: typeof value.width === "number" || value.width === null ? (value.width ?? null) : null,
		size: typeof value.size === "number" || value.size === null ? (value.size ?? null) : null,
		type:
			value.type === "TEMPORARY" || value.type === "REGULAR" || value.type === null
				? (value.type ?? null)
				: null,
	};
}

async function createRequestFromFile(filePath: string): Promise<CreateImageRequest> {
	const fileStats = await fs.stat(filePath);

	return {
		contentLength: fileStats.size,
		contentType: getMimeTypeFromFilePath(filePath),
		type: "TEMPORARY",
		sourceType: "PBX",
	};
}

export class ImageServiceClient {
	private readonly baseURL: string;
	private readonly customerToken?: string;

	constructor(
		customerToken?: string,
		baseURL: string = process.env.IMAGE_SERVICE_URL || "http://127.0.0.1:8180",
	) {
		this.baseURL = normalizeBaseUrl(baseURL);
		this.customerToken = customerToken;
	}

	private getAuthHeaders(): Record<string, string> {
		if (!this.customerToken) {
			return {};
		}

		return {
			Authorization: `Bearer ${this.customerToken}`,
		};
	}

	async createImageEntry(request: CreateImageRequest): Promise<ImageResponse> {
		const response = await fetch(`${this.baseURL}/images`, {
			method: "POST",
			headers: {
				...this.getAuthHeaders(),
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(request),
		});

		if (!response.ok) {
			throw new ImageServiceClientError("Failed to create image entry", response.status);
		}

		return parseImageResponse(await response.json());
	}

	async uploadBinary(uploadUrl: string, filePath: string, request: CreateImageRequest): Promise<void> {
		const fileBuffer = await fs.readFile(filePath);
		const response = await fetch(uploadUrl, {
			method: "PUT",
			headers: {
				"Content-Type": request.contentType,
				"Content-Length": request.contentLength.toString(),
			},
			body: fileBuffer,
		});

		if (!response.ok) {
			throw new ImageServiceClientError("Failed to upload image", response.status);
		}
	}

	async getImageMetadata(id: string): Promise<ImageResponse> {
		const response = await fetch(`${this.baseURL}/images/${id}`, {
			method: "GET",
			headers: {
				...this.getAuthHeaders(),
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			throw new ImageServiceClientError("Failed to get image url", response.status);
		}

		return parseImageResponse(await response.json());
	}

	async uploadTemporaryImage(filePath: string): Promise<ImageResponse> {
		const request = await createRequestFromFile(filePath);
		const createdImage = await this.createImageEntry(request);
		await this.uploadBinary(createdImage.url, filePath, request);
		return this.getImageMetadata(createdImage.id);
	}
}
