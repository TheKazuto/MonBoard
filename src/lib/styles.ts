/**
 * styles.ts — shared inline style constants.
 *
 * Centralises style objects that were created as new inline objects on
 * every render. Import and use `style={SORA}` instead of writing
 * `style={{ fontFamily: 'Sora, sans-serif' }}` inline.
 *
 * Previously repeated 47 times across pages and components.
 */

/** Stable reference — no new object created per render. */
export const SORA = { fontFamily: 'Sora, sans-serif' } as const
