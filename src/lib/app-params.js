// Simplified app params - no longer using Base44 configuration
const isNode = typeof window === 'undefined';
const windowObj = isNode ? { localStorage: new Map() } : window;
const storage = windowObj.localStorage;

export const appParams = {
	// No authentication or Base44-specific configuration needed
	// Add your own app configuration here if needed
}
