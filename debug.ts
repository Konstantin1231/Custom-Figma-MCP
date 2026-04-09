import express, { type Request, type Response } from "express";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.DEBUG_STORAGE_HOST || "127.0.0.1";
const PORT = Number(process.env.DEBUG_STORAGE_PORT || process.env.PORT || 8180);
const STORE_FILE_PATH = path.join(__dirname, "image_store.json");
const IMAGE_STORE_DIRECTORY = path.join(__dirname, "image_store");

type SupportedMimeType =
	| "image/png"
	| "image/gif"
	| "image/jpg"
	| "image/jpeg"
	| "image/webp"
	| "image/svg+xml";
type ImageLifecycleType = "TEMPORARY" | "REGULAR";
type ImageSourceType = "PBX";

type CreateOrUpdateImageRequest = {
	contentLength: number;
	contentType: SupportedMimeType;
	type: ImageLifecycleType;
	sourceType: ImageSourceType;
	altText?: string | null;
	description?: string | null;
	name?: string | null;
	height?: number | null;
	width?: number | null;
};

type ImageResponse = {
	id: string;
	url: string;
	name?: string | null;
	height?: number | null;
	width?: number | null;
	size: number | null;
	type: ImageLifecycleType | null;
};

type ErrorResponse = {
	messages: string[];
};

type StoredImage = CreateOrUpdateImageRequest & {
	id: string;
	uploadToken: string;
	fileName: string;
	uploaded: boolean;
	createdAt: string;
	updatedAt: string;
};

type ImageStore = Record<string, StoredImage>;

const supportedUploadMimeTypes: SupportedMimeType[] = [
	"image/png",
	"image/gif",
	"image/jpg",
	"image/jpeg",
	"image/webp",
	"image/svg+xml",
];
const allowedImageTypes: ImageLifecycleType[] = ["TEMPORARY", "REGULAR"];
const allowedSourceTypes: ImageSourceType[] = ["PBX"];
const MAX_SIZE_IN_BYTES = 3 * 1024 * 1024;

const app = express();

app.use(express.json({ limit: "2mb" }));

function createSwaggerHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mock Image Storage API</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body {
        margin: 0;
        background: #fafafa;
      }

      .topbar {
        display: none;
      }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        displayRequestDuration: true,
      });
    </script>
  </body>
</html>`;
}

function createOpenApiDocument(request: Request) {
	return {
		openapi: "3.1.0",
		info: {
			title: "Mock image storage API",
			version: "1.0.0",
			description:
				"Debug server for local testing. Flow: POST /images with original file metadata -> PUT raw bytes to the returned upload URL -> GET /images/{id} to obtain the public URL.",
		},
		servers: [
			{
				url: getBaseUrl(request),
				description: "Current debug server",
			},
		],
		tags: [
			{
				name: "Images",
				description: "Main image lifecycle endpoints.",
			},
			{
				name: "Debug Helpers",
				description: "Extra endpoints exposed by the local mock server.",
			},
		],
		paths: {
			"/images": {
				post: {
					tags: ["Images"],
					summary: "Create image entry",
					description:
						"Creates an image record from the original file metadata and returns the upload URL. contentType and contentLength must match the later PUT request headers.",
					operationId: "create-image",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/CreateOrUpdateImageRequest",
								},
							},
						},
					},
					responses: {
						"201": {
							description: "Image entry created. The url field is the upload URL.",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/ImageResponse",
									},
								},
							},
						},
						"400": {
							description: "Invalid request",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/ErrorResponse",
									},
								},
							},
						},
					},
				},
			},
			"/images/{id}": {
				get: {
					tags: ["Images"],
					summary: "Get uploaded image",
					description:
						"Returns image metadata and the public URL. This only works after the binary upload has finished.",
					operationId: "get-image",
					parameters: [
						{
							name: "id",
							in: "path",
							required: true,
							description: "Image identifier.",
							schema: {
								type: "string",
								format: "uuid",
							},
						},
					],
					responses: {
						"200": {
							description: "Image is ready.",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/ImageResponse",
									},
								},
							},
						},
						"404": {
							description: "Image not found.",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/ErrorResponse",
									},
								},
							},
						},
						"409": {
							description: "Image exists but binary upload has not happened yet.",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/ErrorResponse",
									},
								},
							},
						},
					},
				},
			},
			"/mock-upload/{uploadToken}": {
				put: {
					tags: ["Debug Helpers"],
					summary: "Upload image bytes",
					description:
						"Internal helper route used by the returned upload URL. Send the original file bytes with Content-Type and Content-Length headers. The frontend does not send app credentials here.",
					operationId: "upload-image-bytes",
					parameters: [
						{
							name: "uploadToken",
							in: "path",
							required: true,
							description: "Opaque upload token contained in the URL returned by POST /images.",
							schema: {
								type: "string",
							},
						},
					],
					requestBody: {
						required: true,
						content: {
							"image/png": {
								schema: {
									type: "string",
									format: "binary",
								},
							},
							"image/gif": {
								schema: {
									type: "string",
									format: "binary",
								},
							},
							"image/jpg": {
								schema: {
									type: "string",
									format: "binary",
								},
							},
							"image/jpeg": {
								schema: {
									type: "string",
									format: "binary",
								},
							},
							"image/webp": {
								schema: {
									type: "string",
									format: "binary",
								},
							},
							"image/svg+xml": {
								schema: {
									type: "string",
									format: "binary",
								},
							},
						},
					},
					responses: {
						"200": {
							description: "Image bytes uploaded successfully.",
						},
						"400": {
							description: "Missing or invalid upload body or headers, unsupported MIME type, or size mismatch.",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/ErrorResponse",
									},
								},
							},
						},
						"404": {
							description: "Upload URL not found.",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/ErrorResponse",
									},
								},
							},
						},
					},
				},
			},
		},
		components: {
			schemas: {
				CreateOrUpdateImageRequest: {
					type: "object",
					description: "Payload used to create an image entry from the original file metadata.",
					properties: {
						contentLength: {
							type: "integer",
							format: "int32",
							minimum: 0,
							maximum: MAX_SIZE_IN_BYTES,
							description: "Original file size in bytes. Must match the later PUT Content-Length header.",
							example: 183245,
						},
						contentType: {
							type: "string",
							enum: supportedUploadMimeTypes,
							description: "Original file MIME type. Must match the later PUT Content-Type header.",
							example: "image/png",
						},
						type: {
							type: "string",
							enum: allowedImageTypes,
							description: "Image lifecycle type.",
							example: "TEMPORARY",
						},
						sourceType: {
							type: "string",
							enum: allowedSourceTypes,
							description: "Image source type.",
							example: "PBX",
						},
						altText: {
							type: "string",
							nullable: true,
							description: "Alternative text used for accessibility.",
						},
						description: {
							type: "string",
							nullable: true,
							description: "Free-form image description.",
						},
						name: {
							type: "string",
							nullable: true,
							description: "Human-readable image name.",
						},
						height: {
							type: "integer",
							format: "int32",
							nullable: true,
							description: "Image height in pixels.",
						},
						width: {
							type: "integer",
							format: "int32",
							nullable: true,
							description: "Image width in pixels.",
						},
					},
					required: ["contentLength", "contentType", "sourceType", "type"],
				},
				ImageResponse: {
					type: "object",
					description:
						"Image metadata and a URL. After POST this is the upload URL. After GET this is the final public URL.",
					properties: {
						id: {
							type: "string",
							format: "uuid",
							description: "Unique image identifier.",
						},
						url: {
							type: "string",
							description: "Upload URL or final public URL, depending on the step.",
						},
						description: {
							type: "string",
						},
						name: {
							type: "string",
							nullable: true,
						},
						height: {
							type: "integer",
							format: "int32",
							nullable: true,
						},
						width: {
							type: "integer",
							format: "int32",
							nullable: true,
						},
						size: {
							type: "integer",
							format: "int32",
							nullable: true,
							description: "Image size in bytes.",
						},
						type: {
							type: "string",
							enum: allowedImageTypes,
							nullable: true,
						},
					},
				},
				ErrorResponse: {
					type: "object",
					properties: {
						messages: {
							type: "array",
							items: {
								type: "string",
							},
						},
					},
				},
			},
		},
	};
}

function getBaseUrl(request: Request): string {
	return `${request.protocol}://${request.get("host")}`;
}

function getImageFilePath(image: StoredImage): string {
	return path.join(IMAGE_STORE_DIRECTORY, image.fileName);
}

function getUploadUrl(request: Request, uploadToken: string): string {
	return `${getBaseUrl(request)}/mock-upload/${uploadToken}`;
}

function getPublicImageUrl(request: Request, id: string): string {
	return `${getBaseUrl(request)}/mock-files/${id}`;
}

function getExtensionFromContentType(contentType: SupportedMimeType): string {
	switch (contentType) {
		case "image/png":
			return ".png";
		case "image/gif":
			return ".gif";
		case "image/jpg":
		case "image/jpeg":
			return ".jpg";
		case "image/webp":
			return ".webp";
		case "image/svg+xml":
			return ".svg";
	}
}

function getMimeType(contentType: SupportedMimeType): string {
	return contentType;
}

function findImageByUploadToken(store: ImageStore, uploadToken: string): StoredImage | undefined {
	return Object.values(store).find(
		(image) => typeof image.uploadToken === "string" && image.uploadToken === uploadToken,
	);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null | undefined {
	return value === undefined || value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null | undefined {
	return (
		value === undefined || value === null || (typeof value === "number" && Number.isFinite(value))
	);
}

function validateImageRequest(body: unknown): {
	isValid: boolean;
	data?: CreateOrUpdateImageRequest;
	errors: string[];
} {
	if (!isObject(body)) {
		return {
			isValid: false,
			errors: ["Request body must be a JSON object."],
		};
	}

	const errors: string[] = [];
	const { contentLength, contentType, type, sourceType } = body;

	if (typeof contentLength !== "number" || !Number.isInteger(contentLength) || contentLength < 0) {
		errors.push("contentLength must be a non-negative integer.");
	}

	if (!supportedUploadMimeTypes.includes(contentType as SupportedMimeType)) {
		errors.push(`contentType must be one of: ${supportedUploadMimeTypes.join(", ")}.`);
	}

	if (typeof contentLength === "number" && contentLength > MAX_SIZE_IN_BYTES) {
		errors.push(`contentLength must be at most ${MAX_SIZE_IN_BYTES} bytes.`);
	}

	if (!allowedImageTypes.includes(type as ImageLifecycleType)) {
		errors.push(`type must be one of: ${allowedImageTypes.join(", ")}.`);
	}

	if (!allowedSourceTypes.includes(sourceType as ImageSourceType)) {
		errors.push(`sourceType must be one of: ${allowedSourceTypes.join(", ")}.`);
	}

	if (!isNullableString(body.altText)) {
		errors.push("altText must be a string or null when provided.");
	}

	if (!isNullableString(body.description)) {
		errors.push("description must be a string or null when provided.");
	}

	if (!isNullableString(body.name)) {
		errors.push("name must be a string or null when provided.");
	}

	if (!isNullableNumber(body.height)) {
		errors.push("height must be a number or null when provided.");
	}

	if (!isNullableNumber(body.width)) {
		errors.push("width must be a number or null when provided.");
	}

	if (errors.length > 0) {
		return { isValid: false, errors };
	}

	return {
		isValid: true,
		errors: [],
		data: {
			contentLength: contentLength as number,
			contentType: contentType as SupportedMimeType,
			type: type as ImageLifecycleType,
			sourceType: sourceType as ImageSourceType,
			altText: body.altText as string | null | undefined,
			description: body.description as string | null | undefined,
			name: body.name as string | null | undefined,
			height: body.height as number | null | undefined,
			width: body.width as number | null | undefined,
		},
	};
}

function createErrorResponse(messages: string[]): ErrorResponse {
	return { messages };
}

function createImageResponse(image: StoredImage, url: string): ImageResponse {
	return {
		id: image.id,
		url,
		name: image.name,
		height: image.height,
		width: image.width,
		size: image.contentLength,
		type: image.type,
	};
}

async function ensureStorageExists(): Promise<void> {
	await fs.mkdir(IMAGE_STORE_DIRECTORY, { recursive: true });

	try {
		await fs.access(STORE_FILE_PATH);
	} catch {
		await fs.writeFile(STORE_FILE_PATH, "{}\n", "utf8");
	}
}

async function readStore(): Promise<ImageStore> {
	await ensureStorageExists();
	const rawContent = await fs.readFile(STORE_FILE_PATH, "utf8");
	const trimmedContent = rawContent.trim();

	if (trimmedContent === "") {
		return {};
	}

	return JSON.parse(trimmedContent) as ImageStore;
}

async function writeStore(store: ImageStore): Promise<void> {
	await fs.writeFile(STORE_FILE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function handleUploadRequest(request: Request, response: Response): Promise<void> {
	const store = await readStore();
	const image = findImageByUploadToken(store, request.params.uploadToken);

	if (!image) {
		response.status(404).json(createErrorResponse(["Upload URL not found."]));
		return;
	}

	const contentTypeHeader = request.header("content-type");
	const contentLengthHeader = request.header("content-length");

	if (!contentTypeHeader) {
		response.status(400).json(createErrorResponse(["Content-Type header is required."]));
		return;
	}

	if (!contentLengthHeader) {
		response.status(400).json(createErrorResponse(["Content-Length header is required."]));
		return;
	}

	const expectedMimeType = getMimeType(image.contentType);
	if (contentTypeHeader !== expectedMimeType) {
		response.status(400).json(
			createErrorResponse([
				`Content-Type must be ${expectedMimeType} for this image, received ${contentTypeHeader}.`,
			]),
		);
		return;
	}

	const parsedContentLength = Number(contentLengthHeader);
	if (!Number.isInteger(parsedContentLength) || parsedContentLength < 0) {
		response.status(400).json(createErrorResponse(["Content-Length header must be a non-negative integer."]));
		return;
	}

	if (parsedContentLength > MAX_SIZE_IN_BYTES) {
		response.status(400).json(
			createErrorResponse([`Content-Length must be at most ${MAX_SIZE_IN_BYTES} bytes.`]),
		);
		return;
	}

	if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
		response.status(400).json(createErrorResponse(["Upload body must contain image bytes."]));
		return;
	}

	if (parsedContentLength !== request.body.length) {
		response.status(400).json(
			createErrorResponse([
				`Content-Length header ${parsedContentLength} does not match uploaded byte size ${request.body.length}.`,
			]),
		);
		return;
	}

	if (parsedContentLength !== image.contentLength) {
		response.status(400).json(
			createErrorResponse([
				`Uploaded file size ${parsedContentLength} does not match the expected size ${image.contentLength} declared during POST /images.`,
			]),
		);
		return;
	}

	await fs.writeFile(getImageFilePath(image), request.body);

	const updatedImage: StoredImage = {
		...image,
		uploaded: true,
		updatedAt: new Date().toISOString(),
	};

	store[image.id] = updatedImage;
	await writeStore(store);

	response.status(200).end();
}

app.get("/", (_request: Request, response: Response) => {
	response.redirect("/docs");
});

app.get("/docs", (_request: Request, response: Response) => {
	response.type("html").send(createSwaggerHtml());
});

app.get("/openapi.json", (request: Request, response: Response) => {
	response.json(createOpenApiDocument(request));
});

app.post("/images", async (request: Request, response: Response) => {
	const validation = validateImageRequest(request.body);

	if (!validation.isValid || !validation.data) {
		response.status(400).json(createErrorResponse(validation.errors));
		return;
	}

	const id = randomUUID();
	const now = new Date().toISOString();
	const newImage: StoredImage = {
		id,
		uploadToken: randomUUID(),
		fileName: `${id}${getExtensionFromContentType(validation.data.contentType)}`,
		uploaded: false,
		createdAt: now,
		updatedAt: now,
		...validation.data,
	};

	const store = await readStore();
	store[id] = newImage;
	await writeStore(store);

	response.status(201).json(createImageResponse(newImage, getUploadUrl(request, newImage.uploadToken)));
});

app.get("/images/:id", async (request: Request, response: Response) => {
	const store = await readStore();
	const image = store[request.params.id];

	if (!image) {
		response.status(404).json(createErrorResponse(["Image not found."]));
		return;
	}

	if (!image.uploaded) {
		response.status(409).json(
			createErrorResponse(["Image is not uploaded yet. Upload bytes to the URL returned by POST /images."]),
		);
		return;
	}

	response.json(createImageResponse(image, getPublicImageUrl(request, image.id)));
});

// This route replaces the signed Cloudflare upload URL used by the real service.
app.put(
	"/mock-upload/:uploadToken",
	express.raw({ type: "*/*", limit: `${MAX_SIZE_IN_BYTES}b` }),
	handleUploadRequest,
);

app.get("/mock-files/:id", async (request: Request, response: Response) => {
	const store = await readStore();
	const image = store[request.params.id];

	if (!image || !image.uploaded) {
		response.status(404).json(createErrorResponse(["Image file not found."]));
		return;
	}

	response.type(getMimeType(image.contentType));
	response.sendFile(getImageFilePath(image));
});

async function startServer(): Promise<void> {
	await ensureStorageExists();

	app.listen(PORT, HOST, () => {
		console.log(`Mock image storage server is running at http://${HOST}:${PORT}`);
		console.log(`Swagger UI: http://${HOST}:${PORT}/docs`);
		console.log(`Metadata file: ${STORE_FILE_PATH}`);
		console.log(`Image directory: ${IMAGE_STORE_DIRECTORY}`);
	});
}

startServer().catch((error) => {
	console.error("Failed to start mock image storage server:", error);
	process.exit(1);
});