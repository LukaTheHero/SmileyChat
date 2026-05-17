import { Glob } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative } from "node:path";

import {
    PLUGIN_CATEGORIES,
    type PluginCategory,
} from "#frontend/lib/plugins/types";

import {
    getPluginMarketplaceSource,
    isPluginMarketplaceEnabled,
} from "./config/runtime-config";
import { BadRequestError, HttpError, json } from "./http";
import { pluginsDir } from "./paths";
import { safeFetch } from "./security/safe-fetch";

export type MarketplaceRegistryEntry = {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    category?: PluginCategory;
    permissions?: string[];
    path: string;
    files: string[];
};

type MarketplaceListResponse = {
    enabled: true;
    source: string;
    plugins: Array<MarketplaceRegistryEntry & { installed: boolean }>;
};

type MarketplaceDisabledResponse = {
    enabled: false;
    reason: string;
};

const MARKETPLACE_FETCH_POLICY = {
    allowedProtocols: ["https:"],
    flagName: "SMILEYCHAT_PLUGIN_MARKETPLACE_ENABLED",
};

const MAX_PLUGIN_FILE_BYTES = 5 * 1024 * 1024;
const CORE_PLUGIN_IDS = new Set(["smiley-chat-formatter"]);

export async function readMarketplaceListing(): Promise<Response> {
    if (!isPluginMarketplaceEnabled()) {
        return json(
            {
                enabled: false,
                reason:
                    "Plugin marketplace is disabled. Set SMILEYCHAT_PLUGIN_MARKETPLACE_ENABLED=true in .env to enable it.",
            } satisfies MarketplaceDisabledResponse,
            403,
        );
    }

    const source = getPluginMarketplaceSource();
    const registry = await fetchRegistry(source);
    const installed = await listInstalledPluginIds();
    const plugins = registry.plugins.map((entry) => ({
        ...entry,
        installed: installed.has(entry.id),
    }));

    return json({
        enabled: true,
        source,
        plugins,
    } satisfies MarketplaceListResponse);
}

export async function installMarketplacePlugin(body: unknown): Promise<Response> {
    if (!isPluginMarketplaceEnabled()) {
        return json(
            { error: "Plugin marketplace is disabled." },
            403,
        );
    }

    const requestedId = pluginIdFromBody(body);
    const source = getPluginMarketplaceSource();
    const registry = await fetchRegistry(source);
    const entry = registry.plugins.find((item) => item.id === requestedId);

    if (!entry) {
        return json(
            { error: `Plugin "${requestedId}" is not in the marketplace registry.` },
            404,
        );
    }

    const folderName = safeSegment(entry.id);
    const targetDir = normalize(join(pluginsDir, folderName));

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });

    for (const filePath of entry.files) {
        const safePath = sanitizeFileEntry(filePath);
        const fileUrl = `${source}/${encodePath(entry.path)}/${encodePath(safePath)}`;
        const targetPath = normalize(join(targetDir, safePath));

        if (!isSafeChild(targetDir, targetPath)) {
            throw new BadRequestError(
                `Marketplace plugin "${entry.id}" requested unsafe file path: ${filePath}`,
            );
        }

        const fileResponse = await safeFetch(fileUrl, {
            policy: MARKETPLACE_FETCH_POLICY,
            maxResponseBytes: MAX_PLUGIN_FILE_BYTES,
        });

        if (!fileResponse.ok) {
            throw new HttpError(
                502,
                `Failed to fetch ${filePath} for ${entry.id}: ${fileResponse.status} ${fileResponse.statusText}`,
            );
        }

        const buffer = new Uint8Array(await fileResponse.arrayBuffer());
        await mkdir(dirname(targetPath), { recursive: true });
        await Bun.write(targetPath, buffer);
    }

    return json({ ok: true, plugin: entry });
}

export async function uninstallMarketplacePlugin(pluginId: string): Promise<Response> {
    if (CORE_PLUGIN_IDS.has(pluginId)) {
        return json(
            { error: "Core plugins cannot be uninstalled from the marketplace." },
            400,
        );
    }

    const folderName = safeSegment(pluginId);
    const targetDir = normalize(join(pluginsDir, folderName));

    if (!isSafeChild(pluginsDir, targetDir)) {
        return json({ error: "Invalid plugin id." }, 400);
    }

    await rm(targetDir, { recursive: true, force: true });
    return json({ ok: true });
}

async function fetchRegistry(source: string) {
    const url = `${source}/registry.json`;
    const response = await safeFetch(url, {
        policy: MARKETPLACE_FETCH_POLICY,
        maxResponseBytes: MAX_PLUGIN_FILE_BYTES,
    });

    if (!response.ok) {
        throw new HttpError(
            502,
            `Marketplace registry fetch failed: ${response.status} ${response.statusText}`,
        );
    }

    const raw = (await response.json()) as Record<string, unknown>;
    return normalizeRegistry(raw);
}

function normalizeRegistry(value: Record<string, unknown>) {
    const plugins = Array.isArray(value.plugins) ? value.plugins : [];
    const normalized: MarketplaceRegistryEntry[] = [];

    for (const raw of plugins) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const id = stringField(entry.id);
        const name = stringField(entry.name);
        const version = stringField(entry.version);
        const path = stringField(entry.path);
        const files = Array.isArray(entry.files)
            ? (entry.files.filter(
                  (file): file is string => typeof file === "string",
              ) as string[])
            : [];

        if (!id || !name || !version || !path || files.length === 0) {
            continue;
        }

        normalized.push({
            id,
            name,
            version,
            description:
                typeof entry.description === "string" ? entry.description : undefined,
            author: typeof entry.author === "string" ? entry.author : undefined,
            category: normalizeCategory(entry.category),
            permissions: Array.isArray(entry.permissions)
                ? (entry.permissions.filter(
                      (item): item is string => typeof item === "string",
                  ) as string[])
                : [],
            path,
            files,
        });
    }

    return { plugins: normalized };
}

function normalizeCategory(value: unknown): PluginCategory | undefined {
    return typeof value === "string" &&
        (PLUGIN_CATEGORIES as readonly string[]).includes(value)
        ? (value as PluginCategory)
        : undefined;
}

function pluginIdFromBody(body: unknown): string {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new BadRequestError("Body must be a JSON object with an id field.");
    }
    const id = (body as Record<string, unknown>).id;
    if (typeof id !== "string" || !id.trim()) {
        throw new BadRequestError("Plugin id is required.");
    }
    return id.trim();
}

function sanitizeFileEntry(filePath: string): string {
    const segments = filePath.split("/").filter(Boolean);
    if (segments.length === 0) {
        throw new BadRequestError("Plugin file path is empty.");
    }
    for (const segment of segments) {
        if (segment === ".." || segment === "." || segment.startsWith(".")) {
            throw new BadRequestError(`Unsafe plugin file path segment: ${segment}`);
        }
    }
    return segments.join("/");
}

function stringField(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function encodePath(value: string): string {
    return value.split("/").map(encodeURIComponent).join("/");
}

function safeSegment(value: string): string {
    return basename(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isSafeChild(parent: string, child: string) {
    const relativePath = relative(normalize(parent), normalize(child));
    return (
        Boolean(relativePath) &&
        !relativePath.startsWith("..") &&
        !isAbsolute(relativePath)
    );
}

async function listInstalledPluginIds(): Promise<Set<string>> {
    const installed = new Set<string>();
    await mkdir(pluginsDir, { recursive: true });

    const glob = new Glob("*/plugin.json");
    for await (const manifestFile of glob.scan(pluginsDir)) {
        const file = Bun.file(join(pluginsDir, manifestFile));
        if (!(await file.exists())) continue;
        try {
            const manifest = (await file.json()) as Record<string, unknown>;
            if (typeof manifest.id === "string" && manifest.id.trim()) {
                installed.add(manifest.id.trim());
            }
        } catch {
            // skip
        }
    }

    return installed;
}
