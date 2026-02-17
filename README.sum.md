# Source Folder Summary

This document summarizes the purpose, main implementation focus, and motivation for each folder and file in the src directory.

## Top-level

- [src/](src/)
  - Purpose: TypeScript source for the Figma MCP server, extractor pipeline, and supporting utilities.
  - Motivation: Provide a clean separation between server transport, Figma API integration, extraction/transformation logic, and utilities.

- [src/bin.ts](src/bin.ts)
  - Main implementation: Loads environment variables via `dotenv` and calls `startServer()` as the CLI entrypoint.
  - Motivation: Provide a single executable entry that boots the server with .env configuration.

- [src/config.ts](src/config.ts)
  - Main implementation: Parses CLI flags with `yargs`, loads .env, validates auth, and returns `getServerConfig()` with source tracking.
  - Motivation: Centralize configuration resolution for CLI and HTTP modes with explicit provenance of each setting.

- [src/index.ts](src/index.ts)
  - Main implementation: Re-exports extractor types and the public extractor API (`extractFromDesign`, built-ins).
  - Motivation: Offer a stable, minimal surface for consumers who only need data extraction.

- [src/mcp-server.ts](src/mcp-server.ts)
  - Main implementation: Re-exports server-centric APIs (`createServer`, `startServer`, config helpers).
  - Motivation: Provide a focused entry for users integrating the MCP server without extractor-only exports.

- [src/server.ts](src/server.ts)
  - Main implementation: Starts the MCP server in stdio or HTTP mode, wires Express routes for Streamable HTTP and SSE, and manages transports.
  - Motivation: Support multiple MCP transport modes for local CLI use and remote HTTP access.

## Extractors

- [src/extractors/](src/extractors/)
  - Purpose: Flexible, single-pass traversal and extraction pipeline for Figma node trees.
  - Motivation: Optimize data extraction for different LLM use cases by composing extractors.

- [src/extractors/README.md](src/extractors/README.md)
  - Main implementation: Documentation of the extractor architecture and usage patterns.
  - Motivation: Explain how to compose extractors and tailor outputs for context constraints.

- [src/extractors/types.ts](src/extractors/types.ts)
  - Main implementation: Core types (`ExtractorFn`, `TraversalContext`, `SimplifiedNode`, `SimplifiedDesign`).
  - Motivation: Provide a type-safe contract for extractor composition and output shape.

- [src/extractors/node-walker.ts](src/extractors/node-walker.ts)
  - Main implementation: `extractFromDesign()` performs a single tree walk, applying extractors and optional post-child hooks.
  - Motivation: Ensure efficient traversal with consistent filtering, depth limits, and extensibility.

- [src/extractors/design-extractor.ts](src/extractors/design-extractor.ts)
  - Main implementation: `simplifyRawFigmaObject()` normalizes raw Figma responses, extracts nodes, and aggregates components/styles.
  - Motivation: Produce a unified `SimplifiedDesign` from file or node endpoints.

- [src/extractors/built-in.ts](src/extractors/built-in.ts)
  - Main implementation: Built-in extractors (`layoutExtractor`, `textExtractor`, `visualsExtractor`, `componentExtractor`) plus `collapseSvgContainers()`.
  - Motivation: Provide ready-to-use extraction presets and payload reduction for SVG-heavy structures.

- [src/extractors/index.ts](src/extractors/index.ts)
  - Main implementation: Re-exports all extractor types and built-in helpers.
  - Motivation: Keep import ergonomics simple for external consumers.

## MCP Server

- [src/mcp/](src/mcp/)
  - Purpose: MCP server creation and tool registration.
  - Motivation: Encapsulate MCP setup separate from transport plumbing in server.ts.

- [src/mcp/index.ts](src/mcp/index.ts)
  - Main implementation: `createServer()` creates `McpServer`, instantiates `FigmaService`, and registers tools.
  - Motivation: Keep MCP server assembly centralized and configurable (format, image tools).

- [src/mcp/tools/](src/mcp/tools/)
  - Purpose: MCP tool definitions and handlers.
  - Motivation: Isolate tool contracts from server boot logic.

- [src/mcp/tools/get-figma-data-tool.ts](src/mcp/tools/get-figma-data-tool.ts)
  - Main implementation: `getFigmaData()` fetches raw data via `FigmaService`, runs `simplifyRawFigmaObject()`, and returns YAML/JSON.
  - Motivation: Provide a single tool to retrieve structured design data optimized for LLM consumption.

- [src/mcp/tools/download-figma-images-tool.ts](src/mcp/tools/download-figma-images-tool.ts)
  - Main implementation: `downloadFigmaImages()` validates input, deduplicates download requests, calls `FigmaService.downloadImages()`, and formats results.
  - Motivation: Enable image asset retrieval with optional cropping and dimension metadata.

- [src/mcp/tools/index.ts](src/mcp/tools/index.ts)
  - Main implementation: Re-exports tools and parameter types.
  - Motivation: Simplify tool imports for `createServer()`.

## Services

- [src/services/](src/services/)
  - Purpose: External API integration.
  - Motivation: Abstract Figma HTTP calls and image download logic behind a single class.

- [src/services/figma.ts](src/services/figma.ts)
  - Main implementation: `FigmaService` handles auth, robust fetch with curl fallback, file/node retrieval, and image download with post-processing hooks.
  - Motivation: Provide a resilient interface to the Figma API and centralize image retrieval logic.

## Transformers

- [src/transformers/](src/transformers/)
  - Purpose: Convert raw Figma node properties into simplified, CSS-friendly representations.
  - Motivation: Standardize data for LLM usage and reduce payload size.

- [src/transformers/component.ts](src/transformers/component.ts)
  - Main implementation: Simplifies components and component sets into minimal definitions.
  - Motivation: Preserve essential metadata without verbose API fields.

- [src/transformers/layout.ts](src/transformers/layout.ts)
  - Main implementation: `buildSimplifiedLayout()` maps AutoLayout and positional data to flex-like schema and dimensions.
  - Motivation: Provide layout semantics that align with CSS and UI implementation needs.

- [src/transformers/text.ts](src/transformers/text.ts)
  - Main implementation: Extracts text content and normalized typographic styles.
  - Motivation: Preserve readable content and style signals with minimal noise.

- [src/transformers/effects.ts](src/transformers/effects.ts)
  - Main implementation: Converts Figma effects into CSS `box-shadow`, `text-shadow`, `filter`, and `backdrop-filter`.
  - Motivation: Map visual effects to developer-friendly CSS constructs.

- [src/transformers/style.ts](src/transformers/style.ts)
  - Main implementation: Normalizes fills, strokes, gradients, pattern fills, image scaling, and color conversions; annotates image download metadata.
  - Motivation: Convert visual paints into CSS-ready outputs while preserving download instructions for assets.

## Utilities

- [src/utils/](src/utils/)
  - Purpose: Shared helpers for IO, type guards, logging, and image processing.
  - Motivation: Reduce duplication across services, extractors, and tools.

- [src/utils/common.ts](src/utils/common.ts)
  - Main implementation: Image download helper, object cleanup, CSS shorthand generation, visibility checks, and number rounding.
  - Motivation: Provide reusable utilities for styling and IO tasks.

- [src/utils/fetch-with-retry.ts](src/utils/fetch-with-retry.ts)
  - Main implementation: `fetchWithRetry()` falls back to `curl` when fetch fails due to proxies/SSL issues.
  - Motivation: Improve reliability in restrictive network environments.

- [src/utils/identity.ts](src/utils/identity.ts)
  - Main implementation: Type guards (`isFrame`, `isLayout`, `isRectangle`, `isStrokeWeights`) and helpers like `hasValue()`.
  - Motivation: Strengthen type safety for Figma node inspection.

- [src/utils/image-processing.ts](src/utils/image-processing.ts)
  - Main implementation: Uses `sharp` to crop images by Figma transforms and compute image dimensions and CSS variables.
  - Motivation: Support accurate image export and CSS tiling behavior.

- [src/utils/logger.ts](src/utils/logger.ts)
  - Main implementation: Minimal logger with HTTP/stdio modes and dev-only JSON log writer.
  - Motivation: Provide consistent logging without pulling in a heavy dependency.

## Tests

- [src/tests/](src/tests/)
  - Purpose: Jest-based tests for server behavior and output format decisions.
  - Motivation: Validate tool output and key assumptions for LLM efficiency.

- [src/tests/benchmark.test.ts](src/tests/benchmark.test.ts)
  - Main implementation: Asserts YAML output is more token-efficient than JSON for small payloads.
  - Motivation: Justify YAML as the default output format.

- [src/tests/integration.test.ts](src/tests/integration.test.ts)
  - Main implementation: Spins up an in-memory MCP server/client and calls `get_figma_data`.
  - Motivation: Ensure the MCP tool chain works end-to-end against the Figma API.

## Key Functions (inputs, outputs, usage)

Only high-impact functions that are reused across files are listed.

### Server & configuration

- `getServerConfig(isStdioMode: boolean)` in [src/config.ts](src/config.ts)
  - Inputs: `isStdioMode` controls whether to log configuration details.
  - Output: `ServerConfig` object (auth, host/port, output format, skip flags, source metadata).
  - Used in: [src/server.ts](src/server.ts) to configure server startup.
  - Why: Centralizes CLI/env config parsing and validation for both CLI and HTTP modes.

- `startServer()` in [src/server.ts](src/server.ts)
  - Inputs: none (reads process args and env).
  - Output: `Promise<void>`; starts MCP server in stdio or HTTP mode.
  - Used in: [src/bin.ts](src/bin.ts) to run the CLI entrypoint.
  - Why: Single entry that chooses transport and bootstraps MCP server consistently.

- `startHttpServer(host: string, port: number, mcpServer: McpServer)` in [src/server.ts](src/server.ts)
  - Inputs: HTTP host/port and an initialized `McpServer`.
  - Output: `Promise<void>`; starts Express server with Streamable HTTP and SSE endpoints.
  - Used in: `startServer()` in [src/server.ts](src/server.ts).
  - Why: Separates HTTP transport wiring from CLI mode.

- `createServer(authOptions: FigmaAuthOptions, options?: CreateServerOptions)` in [src/mcp/index.ts](src/mcp/index.ts)
  - Inputs: Figma auth (`figmaApiKey` or OAuth token) and MCP options (HTTP flag, output format, skip image tool).
  - Output: `McpServer` instance with tools registered.
  - Used in: [src/server.ts](src/server.ts) and [src/tests/integration.test.ts](src/tests/integration.test.ts).
  - Why: Encapsulates MCP tool registration and shared server setup.

### Extractors (core pipeline)

- `extractFromDesign(nodes, extractors, options?, globalVars?)` in [src/extractors/node-walker.ts](src/extractors/node-walker.ts)
  - Inputs: Figma nodes, extractor list, traversal options (depth, filter, `afterChildren`), and optional `globalVars`.
  - Output: `{ nodes: SimplifiedNode[]; globalVars: GlobalVars }`.
  - Used in: `simplifyRawFigmaObject()` in [src/extractors/design-extractor.ts](src/extractors/design-extractor.ts).
  - Why: Single-pass traversal that composes extractors efficiently for LLM context tuning.

- `simplifyRawFigmaObject(apiResponse, nodeExtractors, options?)` in [src/extractors/design-extractor.ts](src/extractors/design-extractor.ts)
  - Inputs: Raw Figma API response, extractor list, traversal options.
  - Output: `SimplifiedDesign` (metadata, nodes, components, styles).
  - Used in: `getFigmaData()` in [src/mcp/tools/get-figma-data-tool.ts](src/mcp/tools/get-figma-data-tool.ts).
  - Why: Unifies file and node responses into a single simplified output.

- `layoutExtractor`, `textExtractor`, `visualsExtractor`, `componentExtractor` in [src/extractors/built-in.ts](src/extractors/built-in.ts)
  - Inputs: `(node, result, context)` per `ExtractorFn`.
  - Output: Mutate `result` and `context.globalVars` in-place.
  - Used in: `allExtractors` and passed to `extractFromDesign()` via `getFigmaData()`.
  - Why: Provide common extraction behavior without custom extractor authoring.

- `collapseSvgContainers(node, result, children)` in [src/extractors/built-in.ts](src/extractors/built-in.ts)
  - Inputs: original node, built result, processed children.
  - Output: children array to include (possibly empty).
  - Used in: `getFigmaData()` in [src/mcp/tools/get-figma-data-tool.ts](src/mcp/tools/get-figma-data-tool.ts) via traversal `afterChildren`.
  - Why: Reduces payload size by collapsing SVG-only containers.

### MCP tools (public API surface)

- `getFigmaData(params, figmaService, outputFormat)` in [src/mcp/tools/get-figma-data-tool.ts](src/mcp/tools/get-figma-data-tool.ts)
  - Inputs: tool params (file key, optional node ID and depth), `FigmaService`, output format.
  - Output: MCP tool response containing YAML/JSON text (or error payload).
  - Used in: Registered by `createServer()` in [src/mcp/index.ts](src/mcp/index.ts).
  - Why: Primary tool for clients to fetch structured design data.

- `downloadFigmaImages(params, figmaService)` in [src/mcp/tools/download-figma-images-tool.ts](src/mcp/tools/download-figma-images-tool.ts)
  - Inputs: tool params (file key, nodes list, local path, scale), `FigmaService`.
  - Output: MCP tool response listing downloaded files with dimensions (or error payload).
  - Used in: Registered by `createServer()` when image downloads are enabled.
  - Why: Automates asset export with deduplication and optional cropping metadata.

### Figma API service

- `downloadImages(fileKey, localPath, items, options?)` in [src/services/figma.ts](src/services/figma.ts)
  - Inputs: file key, local output directory, list of items (imageRef or nodeId + metadata), options (PNG scale/SVG options).
  - Output: `Promise<ImageProcessingResult[]>` with file paths and dimensions.
  - Used in: `downloadFigmaImages()` in [src/mcp/tools/download-figma-images-tool.ts](src/mcp/tools/download-figma-images-tool.ts).
  - Why: Centralized image download and post-processing pipeline.

- `getRawFile(fileKey, depth?)` and `getRawNode(fileKey, nodeId, depth?)` in [src/services/figma.ts](src/services/figma.ts)
  - Inputs: file key and optional depth; node endpoint also requires node ID.
  - Output: Raw Figma API response (file or nodes).
  - Used in: `getFigmaData()` in [src/mcp/tools/get-figma-data-tool.ts](src/mcp/tools/get-figma-data-tool.ts).
  - Why: Provide low-level API access for the extractor pipeline.

### Transformers (reused by extractors)

- `buildSimplifiedLayout(node, parent?)` in [src/transformers/layout.ts](src/transformers/layout.ts)
  - Inputs: Figma node and optional parent.
  - Output: `SimplifiedLayout` (flex-like layout, sizing, positioning).
  - Used in: `layoutExtractor` in [src/extractors/built-in.ts](src/extractors/built-in.ts).
  - Why: Converts Figma layout metadata into CSS-relevant structure.

- `parsePaint(paint, hasChildren)` and `buildSimplifiedStrokes(node, hasChildren)` in [src/transformers/style.ts](src/transformers/style.ts)
  - Inputs: Figma paint or node plus whether the node has children.
  - Output: `SimplifiedFill` or `SimplifiedStroke`.
  - Used in: `visualsExtractor` in [src/extractors/built-in.ts](src/extractors/built-in.ts).
  - Why: Normalize visual paints, gradients, and strokes into CSS-friendly values and image download metadata.

- `buildSimplifiedEffects(node)` in [src/transformers/effects.ts](src/transformers/effects.ts)
  - Inputs: Figma node.
  - Output: `SimplifiedEffects` (box-shadow, filters).
  - Used in: `visualsExtractor` in [src/extractors/built-in.ts](src/extractors/built-in.ts).
  - Why: Map Figma effects to CSS equivalents.

- `extractNodeText(node)` and `extractTextStyle(node)` in [src/transformers/text.ts](src/transformers/text.ts)
  - Inputs: Figma node.
  - Output: text content string or `SimplifiedTextStyle` object.
  - Used in: `textExtractor` in [src/extractors/built-in.ts](src/extractors/built-in.ts).
  - Why: Preserve content and typography in a minimal, LLM-friendly shape.

- `simplifyComponents()` and `simplifyComponentSets()` in [src/transformers/component.ts](src/transformers/component.ts)
  - Inputs: Aggregated Figma components and component sets.
  - Output: Simplified definitions keyed by ID.
  - Used in: `simplifyRawFigmaObject()` in [src/extractors/design-extractor.ts](src/extractors/design-extractor.ts).
  - Why: Reduce noisy API fields while retaining essential component metadata.

### Transformer usage and current pipeline order

Transformers are called by the built-in extractors during traversal. They are not invoked directly by the MCP tools.

Pipeline order (normal request flow):

1. `getFigmaData()` in [src/mcp/tools/get-figma-data-tool.ts](src/mcp/tools/get-figma-data-tool.ts)
2. `FigmaService.getRawFile()` or `FigmaService.getRawNode()` in [src/services/figma.ts](src/services/figma.ts)
3. `simplifyRawFigmaObject()` in [src/extractors/design-extractor.ts](src/extractors/design-extractor.ts)
4. `extractFromDesign()` in [src/extractors/node-walker.ts](src/extractors/node-walker.ts)
5. Built-in extractors in [src/extractors/built-in.ts](src/extractors/built-in.ts):
  - `layoutExtractor` → `buildSimplifiedLayout()` in [src/transformers/layout.ts](src/transformers/layout.ts)
  - `textExtractor` → `extractNodeText()` and `extractTextStyle()` in [src/transformers/text.ts](src/transformers/text.ts)
  - `visualsExtractor` → `parsePaint()`, `buildSimplifiedStrokes()` in [src/transformers/style.ts](src/transformers/style.ts) and `buildSimplifiedEffects()` in [src/transformers/effects.ts](src/transformers/effects.ts)
  - `componentExtractor` → component props only (no transformer call)
6. `simplifyComponents()` and `simplifyComponentSets()` in [src/transformers/component.ts](src/transformers/component.ts)

Why this order: raw Figma data is fetched first, then normalized into a `SimplifiedDesign` by a single traversal that applies extractors. Extractors call transformers to translate raw properties into CSS-friendly shapes, and finally component metadata is simplified.

### Utilities (shared helpers)

- `downloadAndProcessImage()` in [src/utils/image-processing.ts](src/utils/image-processing.ts)
  - Inputs: file name, local path, image URL, cropping flags, transform, dimension flag.
  - Output: `Promise<ImageProcessingResult>` containing file path and dimension metadata.
  - Used in: `downloadImages()` in [src/services/figma.ts](src/services/figma.ts).
  - Why: Centralizes cropping and dimension calculation for asset export.

- `fetchWithRetry(url, options?)` in [src/utils/fetch-with-retry.ts](src/utils/fetch-with-retry.ts)
  - Inputs: URL and request options.
  - Output: Parsed JSON response (or throws).
  - Used in: `FigmaService.request()` in [src/services/figma.ts](src/services/figma.ts).
  - Why: Improves reliability in network-restricted environments by falling back to `curl`.

- `isVisible(element)` and `pixelRound(num)` in [src/utils/common.ts](src/utils/common.ts)
  - Inputs: element with `visible` or a number.
  - Output: boolean or rounded number.
  - Used in: `extractFromDesign()` and layout calculations in [src/extractors/node-walker.ts](src/extractors/node-walker.ts) and [src/transformers/layout.ts](src/transformers/layout.ts).
<<<<<<< HEAD
  - Why: Normalize visibility filtering and numerical precision across the pipeline.
=======
  - Why: Normalize visibility filtering and numerical precision across the pipeline.
>>>>>>> 7edba50 (Add README files, update package.json, and enhance Figma tools with customer token support)
