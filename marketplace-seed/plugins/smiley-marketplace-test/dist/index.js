// Marketplace Test plugin for SmileyChat.
// Registers a {{marketplace-test}} macro that returns a fixed string.
// If you can render this macro inside a chat message, the plugin
// downloaded from the marketplace, was discovered by SmileyChat, and
// activated successfully.

export function activate(api) {
    api.presets.registerMacro("marketplace-test", () => {
        return "[marketplace-test] Hello from a marketplace plugin.";
    });

    return () => {
        // No teardown needed; macro is removed automatically when the
        // plugin is deactivated.
    };
}
