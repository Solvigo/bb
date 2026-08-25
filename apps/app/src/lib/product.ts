/**
 * The product's name, wherever the app says it about itself.
 *
 * It lives here because the rename missed three runtime places that overwrite
 * the static ones: the document title has TWO fallbacks and a system message
 * names its own sender. Changing index.html and the install manifest looked
 * complete and was not — a title set at runtime wins over the one in the HTML,
 * so on any route without a better name the tab reverted to the old name.
 *
 * NOT for the CLI binary, package names, storage keys or plugin identifiers.
 * Those are addresses, not branding, and they keep the name they answer to.
 */
export const PRODUCT_NAME = "Solvigo Airways";
