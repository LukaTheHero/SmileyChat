import {
    ArrowLeftRight,
    BookOpen,
    Bot,
    Boxes,
    CheckCircle2,
    Download,
    Layers,
    Layout,
    Pencil,
    Plug,
    Plus,
    Power,
    RefreshCw,
    RotateCcw,
    Save,
    Search,
    Settings,
    Sparkles,
    Store,
    Trash2,
    User,
    Wrench,
    X,
    XCircle,
} from "lucide-preact";
import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { mergeCoreAndUserPluginManifests } from "#frontend/core-extensions";
import {
    deletePluginProfile,
    installMarketplacePlugin,
    loadMarketplaceListing,
    loadPluginManifests,
    loadPluginProfiles,
    savePluginEnabled,
    savePluginProfilesState,
    uninstallMarketplacePlugin,
    type MarketplaceListing,
    type MarketplacePluginEntry,
    type PluginProfilesPayload,
} from "#frontend/lib/api/client";
import { messageFromError } from "#frontend/lib/common/errors";
import {
    applyProfileToPlugins,
    snapshotAllPluginConfigs,
} from "#frontend/lib/plugins/activation";
import {
    BUILT_IN_PROFILES,
    DEFAULT_PROFILE_ID,
    isStateCustom,
    type PluginProfile,
    type PluginProfilesState,
} from "#frontend/lib/plugins/profiles";
import {
    deactivatePlugin,
    getLoadedPlugins,
    getPluginSettingsPanels,
    setPluginEnabledState,
    subscribeToPluginRegistry,
} from "#frontend/lib/plugins/registry";
import {
    createPluginStorage,
    loadCoreRuntimePlugin,
    loadRuntimePlugin,
} from "#frontend/lib/plugins/runtime";
import {
    PLUGIN_CATEGORIES,
    PLUGIN_CATEGORY_LABELS,
    type PluginAppSnapshot,
    type PluginCategory,
    type PluginManifest,
} from "#frontend/lib/plugins/types";

type RequestState = "idle" | "loading" | "success" | "error";

type PluginsSettingsProps = {
    pluginSnapshot: PluginAppSnapshot;
};

type InstalledFilter = "all" | "installed" | "not-installed";

const CATEGORY_ICONS: Record<
    PluginCategory,
    FunctionComponent<{ size?: number | string }>
> = {
    interface: Layout,
    "input-output": ArrowLeftRight,
    automation: Bot,
    connections: Plug,
    tools: Wrench,
    "memory-lore": BookOpen,
    other: Boxes,
};

export function PluginsSettings({ pluginSnapshot }: PluginsSettingsProps) {
    const [plugins, setPlugins] = useState<PluginManifest[]>([]);
    const [profilesPayload, setProfilesPayload] =
        useState<PluginProfilesPayload | null>(null);
    const [requestState, setRequestState] = useState<RequestState>("idle");
    const [statusMessage, setStatusMessage] = useState("");
    const [openPluginId, setOpenPluginId] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const [installedFilter, setInstalledFilter] = useState<InstalledFilter>("all");
    const [categoryFilter, setCategoryFilter] = useState<PluginCategory | "all">("all");
    const [, setRegistryRevision] = useState(0);
    const [marketplaceOpen, setMarketplaceOpen] = useState(false);
    const loadedPlugins = getLoadedPlugins();
    const pluginSettingsPanels = getPluginSettingsPanels();

    useEffect(() => {
        void refreshAll();
    }, []);

    useEffect(
        () =>
            subscribeToPluginRegistry(() =>
                setRegistryRevision((revision) => revision + 1),
            ),
        [],
    );

    const currentEnabledMap = useMemo(() => {
        const map: Record<string, boolean> = {};
        for (const plugin of plugins) {
            map[plugin.id] = plugin.enabled !== false;
        }
        return map;
    }, [plugins]);

    const allProfiles = useMemo<PluginProfile[]>(() => {
        const builtins = profilesPayload?.builtinProfiles ?? BUILT_IN_PROFILES;
        const userProfiles = profilesPayload?.userProfiles ?? [];
        return [...builtins, ...userProfiles];
    }, [profilesPayload]);

    const activeProfileId = profilesPayload?.activeProfileId ?? DEFAULT_PROFILE_ID;
    const activeProfile =
        allProfiles.find((profile) => profile.id === activeProfileId) ?? allProfiles[0];
    const isCustom = profilesPayload
        ? isStateCustom(currentEnabledMap, profilesPayload.lastApplied)
        : false;

    const filteredPlugins = useMemo(() => {
        const search = searchTerm.trim().toLowerCase();
        return plugins.filter((plugin) => {
            const category = plugin.category ?? "other";
            const enabled = plugin.enabled !== false;

            if (categoryFilter !== "all" && category !== categoryFilter) {
                return false;
            }

            if (installedFilter === "installed" && !enabled) {
                return false;
            }

            if (installedFilter === "not-installed" && enabled) {
                return false;
            }

            if (search) {
                const haystack = [
                    plugin.name,
                    plugin.id,
                    plugin.description ?? "",
                    PLUGIN_CATEGORY_LABELS[category],
                ]
                    .join(" ")
                    .toLowerCase();

                if (!haystack.includes(search)) {
                    return false;
                }
            }

            return true;
        });
    }, [plugins, searchTerm, installedFilter, categoryFilter]);

    const groupedPlugins = useMemo(() => {
        const groups = new Map<PluginCategory, PluginManifest[]>();
        for (const plugin of filteredPlugins) {
            const category = plugin.category ?? "other";
            const bucket = groups.get(category) ?? [];
            bucket.push(plugin);
            groups.set(category, bucket);
        }
        return PLUGIN_CATEGORIES.filter((category) => groups.has(category)).map(
            (category) => [category, groups.get(category) ?? []] as const,
        );
    }, [filteredPlugins]);

    const categoryCounts = useMemo(() => {
        const counts = new Map<PluginCategory, number>();
        for (const plugin of plugins) {
            const category = plugin.category ?? "other";
            counts.set(category, (counts.get(category) ?? 0) + 1);
        }
        return counts;
    }, [plugins]);

    async function refreshAll() {
        setRequestState("loading");

        try {
            const [manifestResponse, profilesResponse] = await Promise.all([
                loadPluginManifests(),
                loadPluginProfiles(),
            ]);
            setPlugins(mergeCoreAndUserPluginManifests(manifestResponse.plugins));
            setProfilesPayload(profilesResponse);
            setStatusMessage("");
            setRequestState("success");
        } catch (error) {
            setStatusMessage(messageFromError(error, "Could not load plugins."));
            setRequestState("error");
        }
    }

    async function togglePlugin(plugin: PluginManifest) {
        const nextEnabled = plugin.enabled === false;
        setRequestState("loading");

        try {
            const response = await savePluginEnabled(plugin.id, nextEnabled);
            setPlugins(mergeCoreAndUserPluginManifests(response.plugins ?? []));
            setPluginEnabledState(plugin.id, nextEnabled);

            if (plugin.source === "core") {
                if (nextEnabled) {
                    await loadCoreRuntimePlugin(plugin.id);
                } else {
                    deactivatePlugin(plugin.id);
                }
            } else if (nextEnabled) {
                const nextPlugin =
                    response.plugins?.find((item) => item.id === plugin.id) ??
                    response.plugin;
                if (nextPlugin) {
                    await loadRuntimePlugin(nextPlugin);
                }
            } else {
                deactivatePlugin(plugin.id);
            }

            setStatusMessage(
                `${plugin.name} ${nextEnabled ? "enabled" : "disabled"}.${
                    plugin.source === "core" || nextEnabled || loadedState(plugin)
                        ? ""
                        : " Restart SmileyChat to load this plugin into the current session."
                }`,
            );
            setRequestState("success");
        } catch (error) {
            setStatusMessage(messageFromError(error, "Could not update plugin."));
            setRequestState("error");
        }
    }

    function loadedState(plugin: PluginManifest) {
        return loadedPlugins.find((item) => item.manifest.id === plugin.id);
    }

    function settingsPanelsForPlugin(pluginId: string) {
        return pluginSettingsPanels.filter(
            (panel) => pluginIdFromScopedId(panel.id) === pluginId,
        );
    }

    async function applyProfile(profile: PluginProfile) {
        if (!profilesPayload) return;
        setRequestState("loading");

        try {
            const { appliedEnabled, enabledChanges, configChanges } =
                await applyProfileToPlugins(profile, plugins);
            const refreshed = await loadPluginManifests();
            setPlugins(mergeCoreAndUserPluginManifests(refreshed.plugins));

            const nextState: PluginProfilesState = {
                version: 1,
                activeProfileId: profile.id,
                lastApplied: appliedEnabled,
                userProfiles: profilesPayload.userProfiles,
            };
            const saved = await savePluginProfilesState(nextState);
            setProfilesPayload({
                activeProfileId: saved.state.activeProfileId,
                lastApplied: saved.state.lastApplied,
                builtinProfiles: profilesPayload.builtinProfiles,
                userProfiles: saved.state.userProfiles,
            });

            const summary =
                enabledChanges.length === 0 && configChanges.length === 0
                    ? `${profile.name} applied. No plugins needed to change.`
                    : `${profile.name} applied. ${enabledChanges.length} toggled, ${configChanges.length} config${configChanges.length === 1 ? "" : "s"} restored.`;
            setStatusMessage(summary);
            setRequestState("success");
        } catch (error) {
            setStatusMessage(messageFromError(error, "Could not apply profile."));
            setRequestState("error");
        }
    }

    async function resetToActiveProfile() {
        if (!activeProfile) return;
        await applyProfile(activeProfile);
    }

    async function saveCurrentAs(name: string) {
        if (!profilesPayload) return;
        const trimmed = name.trim();
        if (!trimmed) return;
        const id = slugify(trimmed) || `profile-${Date.now()}`;
        if (BUILT_IN_PROFILES.some((profile) => profile.id === id)) {
            setStatusMessage("That name conflicts with a built-in profile.");
            setRequestState("error");
            return;
        }

        setRequestState("loading");
        try {
            const pluginConfig = await snapshotAllPluginConfigs(plugins);
            const newProfile: PluginProfile = {
                id,
                name: trimmed,
                description: "User-defined profile.",
                builtin: false,
                enabledPlugins: { ...currentEnabledMap },
                pluginConfig,
                defaultEnabled: true,
            };

            const nextState: PluginProfilesState = {
                version: 1,
                activeProfileId: id,
                lastApplied: { ...currentEnabledMap },
                userProfiles: [
                    ...profilesPayload.userProfiles.filter((profile) => profile.id !== id),
                    newProfile,
                ],
            };
            const saved = await savePluginProfilesState(nextState);
            setProfilesPayload({
                activeProfileId: saved.state.activeProfileId,
                lastApplied: saved.state.lastApplied,
                builtinProfiles: profilesPayload.builtinProfiles,
                userProfiles: saved.state.userProfiles,
            });
            setStatusMessage(`Saved "${trimmed}" and activated it.`);
            setRequestState("success");
        } catch (error) {
            setStatusMessage(messageFromError(error, "Could not save profile."));
            setRequestState("error");
        }
    }

    async function updateActiveUserProfile() {
        if (!profilesPayload || !activeProfile || activeProfile.builtin) return;
        setRequestState("loading");
        try {
            const pluginConfig = await snapshotAllPluginConfigs(plugins);
            const updated: PluginProfile = {
                ...activeProfile,
                enabledPlugins: { ...currentEnabledMap },
                pluginConfig,
            };
            const nextState: PluginProfilesState = {
                version: 1,
                activeProfileId: activeProfile.id,
                lastApplied: { ...currentEnabledMap },
                userProfiles: profilesPayload.userProfiles.map((profile) =>
                    profile.id === activeProfile.id ? updated : profile,
                ),
            };
            const saved = await savePluginProfilesState(nextState);
            setProfilesPayload({
                activeProfileId: saved.state.activeProfileId,
                lastApplied: saved.state.lastApplied,
                builtinProfiles: profilesPayload.builtinProfiles,
                userProfiles: saved.state.userProfiles,
            });
            setStatusMessage(`Saved current state to "${activeProfile.name}".`);
            setRequestState("success");
        } catch (error) {
            setStatusMessage(messageFromError(error, "Could not save profile."));
            setRequestState("error");
        }
    }

    async function deleteActiveProfile() {
        if (!profilesPayload || !activeProfile || activeProfile.builtin) return;
        setRequestState("loading");
        try {
            const response = await deletePluginProfile(activeProfile.id);
            setProfilesPayload({
                activeProfileId: response.state.activeProfileId,
                lastApplied: response.state.lastApplied,
                builtinProfiles: profilesPayload.builtinProfiles,
                userProfiles: response.state.userProfiles,
            });
            setStatusMessage(`Deleted "${activeProfile.name}". Active profile reset.`);
            setRequestState("success");
        } catch (error) {
            setStatusMessage(messageFromError(error, "Could not delete profile."));
            setRequestState("error");
        }
    }

    return (
        <section className="tool-window plugins-marketplace">
            <div className="plugins-heading">
                <div>
                    <h2>Plugins</h2>
                    <p>
                        Core extensions and trusted local plugins. Switch profiles to
                        tune the engine for the experience you want.
                    </p>
                </div>
                <div className="plugins-heading-actions">
                    <button
                        type="button"
                        disabled={requestState === "loading"}
                        onClick={() => setMarketplaceOpen(true)}
                    >
                        <Store size={16} />
                        Explore plugins
                    </button>
                    <button
                        type="button"
                        disabled={requestState === "loading"}
                        onClick={() => void refreshAll()}
                    >
                        <RefreshCw size={16} />
                        Refresh
                    </button>
                </div>
            </div>

            <ProfileBar
                profiles={allProfiles}
                activeProfile={activeProfile}
                isCustom={isCustom}
                isBusy={requestState === "loading"}
                onApply={applyProfile}
                onReset={resetToActiveProfile}
                onSaveCurrentAs={(name) => void saveCurrentAs(name)}
                onUpdateActive={updateActiveUserProfile}
                onDeleteActive={deleteActiveProfile}
            />

            <div className="marketplace-toolbar">
                <input
                    type="search"
                    className="marketplace-search"
                    value={searchTerm}
                    placeholder="Search extensions..."
                    onInput={(event) =>
                        setSearchTerm(
                            (event.currentTarget as HTMLInputElement).value,
                        )
                    }
                />
                <div className="marketplace-filter-pills">
                    {(
                        [
                            ["all", "All"],
                            ["installed", "Enabled"],
                            ["not-installed", "Disabled"],
                        ] as const
                    ).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            className={
                                installedFilter === value ? "pill pill-active" : "pill"
                            }
                            onClick={() => setInstalledFilter(value)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="marketplace-category-tabs">
                <button
                    type="button"
                    className={
                        categoryFilter === "all"
                            ? "category-tab category-tab-active"
                            : "category-tab"
                    }
                    onClick={() => setCategoryFilter("all")}
                >
                    <Layers size={14} />
                    All
                    <span className="category-tab-count">{plugins.length}</span>
                </button>
                {PLUGIN_CATEGORIES.map((category) => {
                    const Icon = CATEGORY_ICONS[category];
                    const count = categoryCounts.get(category) ?? 0;
                    if (count === 0) return null;
                    return (
                        <button
                            key={category}
                            type="button"
                            className={
                                categoryFilter === category
                                    ? "category-tab category-tab-active"
                                    : "category-tab"
                            }
                            onClick={() => setCategoryFilter(category)}
                        >
                            <Icon size={14} />
                            {PLUGIN_CATEGORY_LABELS[category]}
                            <span className="category-tab-count">{count}</span>
                        </button>
                    );
                })}
            </div>

            <div className="plugins-list">
                {groupedPlugins.map(([category, list]) => (
                    <div className="plugin-category-group" key={category}>
                        {categoryFilter === "all" && (
                            <h3 className="plugin-category-heading">
                                {(() => {
                                    const Icon = CATEGORY_ICONS[category];
                                    return <Icon size={15} />;
                                })()}
                                {PLUGIN_CATEGORY_LABELS[category]}
                                <span>{list.length}</span>
                            </h3>
                        )}
                        {list.map((plugin) => (
                            <PluginCard
                                key={plugin.id}
                                plugin={plugin}
                                loaded={loadedState(plugin)}
                                showConfiguration={openPluginId === plugin.id}
                                settingsPanels={settingsPanelsForPlugin(plugin.id)}
                                pluginSnapshot={pluginSnapshot}
                                requestState={requestState}
                                onToggle={() => void togglePlugin(plugin)}
                                onToggleConfigure={() =>
                                    setOpenPluginId((current) =>
                                        current === plugin.id ? "" : plugin.id,
                                    )
                                }
                            />
                        ))}
                    </div>
                ))}

                {filteredPlugins.length === 0 && plugins.length > 0 && (
                    <div className="empty-plugin-state">
                        <Search size={20} />
                        <p>No extensions match these filters.</p>
                    </div>
                )}

                {plugins.length === 0 && (
                    <div className="empty-plugin-state">
                        <Boxes size={20} />
                        <p>Place local plugins in userData/plugins to install them.</p>
                    </div>
                )}
            </div>

            {statusMessage && (
                <p className={`connection-status ${requestState}`}>{statusMessage}</p>
            )}

            {marketplaceOpen && (
                <MarketplaceModal
                    onClose={() => setMarketplaceOpen(false)}
                    onChange={() => void refreshAll()}
                />
            )}
        </section>
    );
}

type MarketplaceModalProps = {
    onClose: () => void;
    onChange: () => void;
};

function MarketplaceModal({ onClose, onChange }: MarketplaceModalProps) {
    const [listing, setListing] = useState<MarketplaceListing | null>(null);
    const [busyId, setBusyId] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        void refresh();
    }, []);

    async function refresh() {
        try {
            const response = await loadMarketplaceListing();
            setListing(response);
            setError("");
        } catch (caught) {
            setError(messageFromError(caught, "Could not load the marketplace."));
        }
    }

    async function install(entry: MarketplacePluginEntry) {
        setBusyId(entry.id);
        try {
            await installMarketplacePlugin(entry.id);
            await refresh();
            onChange();
        } catch (caught) {
            setError(messageFromError(caught, "Install failed."));
        } finally {
            setBusyId("");
        }
    }

    async function uninstall(entry: MarketplacePluginEntry) {
        setBusyId(entry.id);
        try {
            await uninstallMarketplacePlugin(entry.id);
            await refresh();
            onChange();
        } catch (caught) {
            setError(messageFromError(caught, "Uninstall failed."));
        } finally {
            setBusyId("");
        }
    }

    return (
        <div
            className="marketplace-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Plugin marketplace"
            onClick={onClose}
        >
            <div
                className="marketplace-modal"
                onClick={(event) => event.stopPropagation()}
            >
                <header>
                    <div>
                        <h2>
                            <Store size={18} />
                            Plugin marketplace
                        </h2>
                        {listing && listing.enabled && (
                            <small>Source: {listing.source}</small>
                        )}
                    </div>
                    <button
                        type="button"
                        className="marketplace-close"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </header>

                <div className="marketplace-body">
                    {error && <p className="connection-status error">{error}</p>}

                    {!listing && !error && <p>Loading...</p>}

                    {listing && !listing.enabled && (
                        <p className="connection-status error">{listing.reason}</p>
                    )}

                    {listing && listing.enabled && listing.plugins.length === 0 && (
                        <p>The marketplace is empty.</p>
                    )}

                    {listing && listing.enabled && listing.plugins.length > 0 && (
                        <div className="marketplace-list">
                            {listing.plugins.map((entry) => (
                                <MarketplaceCard
                                    key={entry.id}
                                    entry={entry}
                                    busy={busyId === entry.id}
                                    onInstall={() => void install(entry)}
                                    onUninstall={() => void uninstall(entry)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

type MarketplaceCardProps = {
    entry: MarketplacePluginEntry;
    busy: boolean;
    onInstall: () => void;
    onUninstall: () => void;
};

function MarketplaceCard({ entry, busy, onInstall, onUninstall }: MarketplaceCardProps) {
    const categoryKey = (entry.category as PluginCategory | undefined) ?? "other";
    const CategoryIcon = CATEGORY_ICONS[categoryKey] ?? Boxes;
    const categoryLabel = PLUGIN_CATEGORY_LABELS[categoryKey] ?? "Other";

    return (
        <article className="marketplace-card">
            <header>
                <div className="marketplace-card-title">
                    <Boxes size={18} />
                    <div>
                        <h3>
                            {entry.name}
                            <span className="marketplace-category-badge">
                                <CategoryIcon size={11} />
                                {categoryLabel}
                            </span>
                        </h3>
                        <span className="marketplace-card-id">{entry.id}</span>
                    </div>
                </div>
                {entry.installed ? (
                    <button
                        type="button"
                        className="marketplace-uninstall danger-button"
                        disabled={busy}
                        onClick={onUninstall}
                    >
                        <Trash2 size={14} />
                        Uninstall
                    </button>
                ) : (
                    <button
                        type="button"
                        className="marketplace-install"
                        disabled={busy}
                        onClick={onInstall}
                    >
                        <Download size={14} />
                        {busy ? "Installing..." : "Install"}
                    </button>
                )}
            </header>

            {entry.description && (
                <p className="marketplace-card-description">{entry.description}</p>
            )}

            <dl className="marketplace-card-meta">
                <div>
                    <dt>Version</dt>
                    <dd>{entry.version}</dd>
                </div>
                {entry.author && (
                    <div>
                        <dt>
                            <User size={11} />
                            Author
                        </dt>
                        <dd>{entry.author}</dd>
                    </div>
                )}
            </dl>

            {entry.permissions && entry.permissions.length > 0 && (
                <div className="marketplace-card-permissions">
                    <span>Permissions</span>
                    <div>
                        {entry.permissions.map((permission) => (
                            <code key={permission}>{permission}</code>
                        ))}
                    </div>
                </div>
            )}
        </article>
    );
}

type ProfileBarProps = {
    profiles: PluginProfile[];
    activeProfile: PluginProfile | undefined;
    isCustom: boolean;
    isBusy: boolean;
    onApply: (profile: PluginProfile) => void | Promise<void>;
    onReset: () => void | Promise<void>;
    onSaveCurrentAs: (name: string) => void;
    onUpdateActive: () => void | Promise<void>;
    onDeleteActive: () => void | Promise<void>;
};

function ProfileBar({
    profiles,
    activeProfile,
    isCustom,
    isBusy,
    onApply,
    onReset,
    onSaveCurrentAs,
    onUpdateActive,
    onDeleteActive,
}: ProfileBarProps) {
    const [draftName, setDraftName] = useState("");
    const [showSaveAs, setShowSaveAs] = useState(false);

    return (
        <div className="profile-bar">
            <div className="profile-bar-row">
                <label className="profile-bar-select">
                    <span>
                        <Sparkles size={14} />
                        Plugin Profile
                    </span>
                    <select
                        value={activeProfile?.id ?? ""}
                        disabled={isBusy}
                        onInput={(event) => {
                            const id = (event.currentTarget as HTMLSelectElement).value;
                            const next = profiles.find((profile) => profile.id === id);
                            if (next) void onApply(next);
                        }}
                    >
                        <optgroup label="Built-in">
                            {profiles
                                .filter((profile) => profile.builtin)
                                .map((profile) => (
                                    <option key={profile.id} value={profile.id}>
                                        {profile.name}
                                    </option>
                                ))}
                        </optgroup>
                        {profiles.some((profile) => !profile.builtin) && (
                            <optgroup label="Yours">
                                {profiles
                                    .filter((profile) => !profile.builtin)
                                    .map((profile) => (
                                        <option key={profile.id} value={profile.id}>
                                            {profile.name}
                                        </option>
                                    ))}
                            </optgroup>
                        )}
                    </select>
                </label>

                {isCustom && (
                    <span className="custom-badge" title="State diverges from this profile">
                        Custom
                    </span>
                )}

                <div className="profile-bar-actions">
                    <button
                        type="button"
                        disabled={isBusy || !isCustom}
                        onClick={() => void onReset()}
                        title="Re-apply the active profile"
                    >
                        <RotateCcw size={15} />
                        Reset
                    </button>
                    {activeProfile && !activeProfile.builtin && (
                        <>
                            <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void onUpdateActive()}
                                title="Save current state to this profile"
                            >
                                <Save size={15} />
                                Save
                            </button>
                            <button
                                type="button"
                                className="danger-button"
                                disabled={isBusy}
                                onClick={() => void onDeleteActive()}
                            >
                                <Trash2 size={15} />
                                Delete
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setShowSaveAs((value) => !value)}
                    >
                        <Pencil size={15} />
                        Save as...
                    </button>
                </div>
            </div>

            {activeProfile?.description && (
                <p className="profile-bar-description">{activeProfile.description}</p>
            )}

            {showSaveAs && (
                <div className="profile-bar-save-as">
                    <input
                        type="text"
                        placeholder="Profile name (e.g. My Lite Setup)"
                        value={draftName}
                        onInput={(event) =>
                            setDraftName(
                                (event.currentTarget as HTMLInputElement).value,
                            )
                        }
                    />
                    <button
                        type="button"
                        disabled={isBusy || draftName.trim().length === 0}
                        onClick={() => {
                            onSaveCurrentAs(draftName);
                            setDraftName("");
                            setShowSaveAs(false);
                        }}
                    >
                        <Plus size={15} />
                        Create
                    </button>
                </div>
            )}
        </div>
    );
}

type PluginCardProps = {
    plugin: PluginManifest;
    loaded: ReturnType<typeof getLoadedPlugins>[number] | undefined;
    showConfiguration: boolean;
    settingsPanels: ReturnType<typeof getPluginSettingsPanels>;
    pluginSnapshot: PluginAppSnapshot;
    requestState: RequestState;
    onToggle: () => void;
    onToggleConfigure: () => void;
};

function PluginCard({
    plugin,
    loaded,
    showConfiguration,
    settingsPanels,
    pluginSnapshot,
    requestState,
    onToggle,
    onToggleConfigure,
}: PluginCardProps) {
    const enabled = plugin.enabled !== false;
    const category: PluginCategory = plugin.category ?? "other";
    const CategoryIcon = CATEGORY_ICONS[category];

    return (
        <article className="plugin-card">
            <header>
                <div className="plugin-title">
                    <Boxes size={18} />
                    <div>
                        <h3>
                            {plugin.name}
                            <span
                                className={`plugin-source-badge ${plugin.source === "core" ? "core" : "local"}`}
                            >
                                {plugin.source === "core" ? "Core" : "Local"}
                            </span>
                            <span className="plugin-category-badge">
                                <CategoryIcon size={11} />
                                {PLUGIN_CATEGORY_LABELS[category]}
                            </span>
                        </h3>
                        <span>{plugin.id}</span>
                    </div>
                </div>
                <label className="plugin-toggle">
                    <input
                        type="checkbox"
                        checked={enabled}
                        disabled={requestState === "loading"}
                        onChange={onToggle}
                    />
                    <span className="plugin-toggle-track" aria-hidden="true">
                        <span />
                    </span>
                    <span>{enabled ? "Enabled" : "Disabled"}</span>
                </label>
            </header>

            {plugin.description && <p>{plugin.description}</p>}

            <dl className="plugin-meta-grid">
                <div>
                    <dt>Version</dt>
                    <dd>{plugin.version}</dd>
                </div>
                <div>
                    <dt>Status</dt>
                    <dd
                        className={loaded?.status === "error" ? "plugin-error" : ""}
                    >
                        {plugin.source === "core" &&
                        enabled &&
                        loaded?.status === "loaded" ? (
                            <>
                                <CheckCircle2 size={14} />
                                Built in
                            </>
                        ) : !enabled ? (
                            "Off"
                        ) : loaded ? (
                            loaded.status === "loaded" ? (
                                <>
                                    <CheckCircle2 size={14} />
                                    Loaded
                                </>
                            ) : (
                                <>
                                    <XCircle size={14} />
                                    {loaded.error ?? "Load error"}
                                </>
                            )
                        ) : (
                            <>
                                <Power size={14} />
                                Pending restart
                            </>
                        )}
                    </dd>
                </div>
            </dl>

            {plugin.permissions && plugin.permissions.length > 0 && (
                <div className="plugin-permissions">
                    <span>Permissions</span>
                    <div>
                        {plugin.permissions.map((permission) => (
                            <code key={permission}>{permission}</code>
                        ))}
                    </div>
                </div>
            )}

            <div className="plugin-card-actions">
                <button type="button" onClick={onToggleConfigure}>
                    <Settings size={15} />
                    {showConfiguration ? "Hide configuration" : "Configure"}
                </button>
            </div>

            {showConfiguration && (
                <div className="plugin-config-panel">
                    {settingsPanels.length > 0 ? (
                        settingsPanels.map((panel) => (
                            <section
                                className="plugin-config-section"
                                key={panel.id}
                            >
                                <h4>{panel.label}</h4>
                                {panel.render({
                                    pluginId: plugin.id,
                                    snapshot: pluginSnapshot,
                                    storage: createPluginStorage(plugin.id),
                                })}
                            </section>
                        ))
                    ) : loaded?.status === "loaded" ? (
                        <p>This plugin does not provide custom configuration.</p>
                    ) : enabled ? (
                        <p>Restart SmileyChat to load this plugin's configuration UI.</p>
                    ) : (
                        <p>Enable this plugin and restart SmileyChat to configure it.</p>
                    )}
                </div>
            )}
        </article>
    );
}

function pluginIdFromScopedId(id: string) {
    return id.split(":")[0] || id;
}

function slugify(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
}
