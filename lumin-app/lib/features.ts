// Feature switches, read at build time.
//
// NEXT_PUBLIC_TWIN_ENABLED=true turns on the twin discovery layer: scanning a video for a
// product, the Wanted board, the creator twins inbox/impact page, the timeline pins and the
// merchant Demand tab. Off by default. Turn it on together with TWIN_ENABLED=true on the
// backend (lumin-backend/README.md, "Switching twins off"). Sellers tagging products on their
// own videos (the product pills) is not part of this switch and always works.
export const TWIN_ENABLED = process.env.NEXT_PUBLIC_TWIN_ENABLED === 'true';
